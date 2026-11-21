package com.wifimapping.app

import android.app.ActivityManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings
import android.webkit.WebSettings
import com.getcapacitor.JSObject
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.net.SocketTimeoutException
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

private const val NO_LAN = "Connect to a Wi-Fi or Ethernet network you own to catalog its addresses."

// Address planning matches planSubnet in shared/subnet.ts.
class SubnetCataloger(private val context: Context) {
    fun catalog(): JSObject {
        val lan = localLan() ?: throw IllegalStateException(NO_LAN)
        val plan = planSubnet(lan.address, lan.prefix) ?: throw IllegalStateException(NO_LAN)
        val targets = plan.addresses.filter { it.role == "host" }.map { it.ip }
        val present = pingAll(targets)
        val arp = readArp()
        for (ip in targets) {
            if (arp.containsKey(ip)) present.add(ip)
        }
        val evidence = ConcurrentHashMap<String, Evidence>()
        val announcements = Thread({ listenAnnouncements(evidence) }, "recorder-announce")
        announcements.start()
        probePorts(targets, evidence)
        try {
            announcements.join(5000)
        } catch (_: InterruptedException) {
            announcements.interrupt()
        }
        val hosts = JSONArray()
        for (item in plan.addresses) {
            val endpoint = item.role == "network" || item.role == "broadcast"
            val self = item.role == "device"
            val found = viewOf(if (item.role == "host") evidence[item.ip] else null)
            val announced = found.services.isNotEmpty() || found.ports.isNotEmpty()
            val active = self || (!endpoint && (present.contains(item.ip) || announced))
            val mac = if (!active) null else if (self) lan.mac ?: arp[item.ip] else arp[item.ip]
            val name = if (active && item.role == "host") found.name else null
            val row = JSObject()
            row.put("ip", item.ip)
            row.put("role", item.role)
            row.put("present", active)
            row.put("mac", mac ?: JSONObject.NULL)
            row.put("name", name ?: JSONObject.NULL)
            row.put("services", serviceArray(if (active && item.role == "host") found else null))
            row.put("ports", portArray(if (active && item.role == "host") found else null))
            hosts.put(row)
        }
        val root = JSObject()
        root.put("cidr", plan.cidr)
        root.put("interfacePrefix", plan.interfacePrefix)
        root.put("limited", plan.limited)
        root.put("checked", targets.size)
        root.put("internetRoute", lan.internet)
        root.put("hosts", hosts)
        return root
    }

    fun details(browser: String): JSObject {
        val memory = ActivityManager.MemoryInfo()
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        manager.getMemoryInfo(memory)
        val result = JSObject()
        result.put("os", osLabel().take(200))
        result.put("browser", browserLabel(browser))
        result.put("ramBytes", memory.totalMem)
        result.put("cpu", cpuLabel().take(200))
        result.put("hostname", deviceName().take(200))
        result.put("collectedAt", Instant.now().toString())
        return result
    }

    private fun localLan(): LocalLan? {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        return onTransport(manager, NetworkCapabilities.TRANSPORT_WIFI)
            ?: onTransport(manager, NetworkCapabilities.TRANSPORT_ETHERNET)
    }

    private fun onTransport(manager: ConnectivityManager, transport: Int): LocalLan? {
        for (network in manager.allNetworks) {
            val caps = manager.getNetworkCapabilities(network) ?: continue
            if (!caps.hasTransport(transport) || caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
            val props = manager.getLinkProperties(network) ?: continue
            for (link in props.linkAddresses) {
                val address = link.address
                if (address !is Inet4Address || address.isLoopbackAddress || address.isLinkLocalAddress) continue
                val host = address.hostAddress ?: continue
                if (parseIpv4(host) == null) continue
                val internet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                return LocalLan(host, link.prefixLength, macFor(address), internet)
            }
        }
        return null
    }

    private fun macFor(address: InetAddress): String? {
        return try {
            val hardware = NetworkInterface.getByInetAddress(address)?.hardwareAddress ?: return null
            if (hardware.size != 6) return null
            normalizeMac(hardware.joinToString(":") { byte -> "%02x".format(byte.toInt() and 0xff) })
        } catch (_: Exception) {
            null
        }
    }

    private fun pingAll(hosts: List<String>): MutableSet<String> {
        val present = ConcurrentHashMap.newKeySet<String>()
        if (hosts.isEmpty()) return present
        val pool = Executors.newFixedThreadPool(minOf(16, hosts.size))
        try {
            for (ip in hosts) {
                pool.submit {
                    if (ping(ip)) present.add(ip)
                }
            }
            pool.shutdown()
            if (!pool.awaitTermination(90, TimeUnit.SECONDS)) pool.shutdownNow()
        } catch (_: Exception) {
            pool.shutdownNow()
        }
        return present
    }

    private fun ping(ip: String): Boolean {
        if (parseIpv4(ip) == null) return false
        var process: Process? = null
        return try {
            process = ProcessBuilder("ping", "-c", "1", "-W", "1", ip)
                .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                .redirectError(ProcessBuilder.Redirect.DISCARD)
                .start()
            if (!process.waitFor(2, TimeUnit.SECONDS)) {
                process.destroy()
                false
            } else {
                process.exitValue() == 0
            }
        } catch (_: Exception) {
            false
        } finally {
            process?.destroy()
        }
    }

    private fun readArp(): Map<String, String> {
        val found = linkedMapOf<String, String>()
        val text = try {
            File("/proc/net/arp").readText()
        } catch (_: Exception) {
            return found
        }
        val pattern = Regex("""^(\d+\.\d+\.\d+\.\d+)\s+\S+\s+0x([0-9a-fA-F]+)\s+(\S+)""")
        for (line in text.lineSequence()) {
            val match = pattern.find(line) ?: continue
            val flags = match.groupValues[2].toIntOrNull(16) ?: continue
            if (flags and 0x2 == 0) continue
            val mac = normalizeMac(match.groupValues[3]) ?: continue
            if (parseIpv4(match.groupValues[1]) == null) continue
            found[match.groupValues[1]] = mac
        }
        return found
    }

    private fun osLabel(): String {
        return "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}), ${Build.MANUFACTURER} ${Build.MODEL}"
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    private fun browserLabel(browser: String): String {
        val supplied = browser.trim()
        if (supplied.isNotEmpty()) return supplied.take(300)
        return try {
            WebSettings.getDefaultUserAgent(context).take(300)
        } catch (_: Exception) {
            "Android WebView"
        }
    }

    private fun cpuLabel(): String {
        val cores = Runtime.getRuntime().availableProcessors()
        val model = readCpuModel()
        return if (model.isNullOrBlank()) "$cores cores" else "$model x $cores"
    }

    private fun readCpuModel(): String? {
        return try {
            var hardware: String? = null
            var model: String? = null
            File("/proc/cpuinfo").useLines { lines ->
                for (line in lines) {
                    val parts = line.split(":", limit = 2)
                    if (parts.size != 2) continue
                    val key = parts[0].trim()
                    val value = parts[1].trim()
                    if (key.equals("Hardware", true) && value.isNotEmpty()) hardware = value
                    if (key.equals("model name", true) && value.isNotEmpty() && model == null) model = value
                }
            }
            hardware ?: model
        } catch (_: Exception) {
            null
        }
    }

    private fun deviceName(): String {
        return try {
            val global = Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)
            if (!global.isNullOrBlank()) return global.trim()
            "${Build.MANUFACTURER} ${Build.MODEL}".trim()
        } catch (_: Exception) {
            "${Build.MANUFACTURER} ${Build.MODEL}".trim()
        }
    }

    private data class LocalLan(val address: String, val prefix: Int, val mac: String?, val internet: Boolean)

    private class Evidence {
        var name: String? = null
        val services = linkedSetOf<String>()
        val ports = linkedSetOf<Int>()
    }

    private data class EvidenceView(val name: String?, val services: List<String>, val ports: List<Int>)
    private data class PlannedAddress(val ip: String, val role: String)
    private data class SubnetPlan(
        val cidr: String,
        val interfacePrefix: Int,
        val limited: Boolean,
        val device: String,
        val addresses: List<PlannedAddress>,
    )

    private fun parseIpv4(text: String): Long? {
            val parts = text.split('.')
            if (parts.size != 4) return null
            var value = 0L
            for (part in parts) {
                if (part.isEmpty() || part.length > 3 || (part.length > 1 && part.startsWith("0"))) return null
                val octet = part.toIntOrNull() ?: return null
                if (octet !in 0..255) return null
                value = (value shl 8) or octet.toLong()
            }
            return value
        }

    private fun formatIpv4(value: Long): String {
            val ip = value and 0xffffffffL
            return "${(ip shr 24) and 255}.${(ip shr 16) and 255}.${(ip shr 8) and 255}.${ip and 255}"
        }

    private fun normalizeMac(value: String?): String? {
            if (value.isNullOrBlank()) return null
            val parts = value.trim().lowercase().split(':')
            if (parts.size != 6) return null
            val octets = parts.map { part ->
                if (!part.matches(Regex("^[0-9a-f]{1,2}$"))) return null
                part.toInt(16)
            }
            val mac = octets.joinToString(":") { octet -> "%02x".format(octet) }
            if (mac == "00:00:00:00:00:00" || mac == "02:00:00:00:00:00") return null
            return mac
        }

    private fun planSubnet(address: String, prefixLength: Int): SubnetPlan? {
            val ip = parseIpv4(address) ?: return null
            if (prefixLength !in 0..32) return null
            if (ip == 0L || ip == 0xffffffffL) return null
            if ((ip and 0xf0000000L) == 0xe0000000L) return null
            val limited = prefixLength < 24
            val prefix = if (limited) 24 else prefixLength
            val mask = if (prefix == 0) 0L else ((-1L shl (32 - prefix)) and 0xffffffffL)
            val network = ip and mask
            val broadcast = network or (mask.inv() and 0xffffffffL)
            if (broadcast < network || broadcast - network > 255) return null
            val device = formatIpv4(ip)
            val addresses = mutableListOf<PlannedAddress>()
            var value = network
            while (addresses.size < 256) {
                val host = formatIpv4(value)
                val role = when {
                    host == device -> "device"
                    prefix <= 30 && value == network -> "network"
                    prefix <= 30 && value == broadcast -> "broadcast"
                    else -> "host"
                }
                addresses.add(PlannedAddress(host, role))
                if (value == broadcast) break
                value += 1
            }
        return SubnetPlan("${formatIpv4(network)}/$prefix", prefixLength, limited, device, addresses)
    }

    private fun listenAnnouncements(found: ConcurrentHashMap<String, Evidence>) {
        val nsd = context.getSystemService(Context.NSD_SERVICE) as? NsdManager
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val lock = try {
            wifi?.createMulticastLock("wifi-mapping-recorders")
        } catch (_: Exception) {
            null
        }
        lock?.setReferenceCounted(false)
        try {
            lock?.acquire()
        } catch (_: Exception) {
            // SSDP can still send without the lock.
        }
        val listeners = mutableListOf<NsdManager.DiscoveryListener>()
        try {
            if (nsd != null) {
                listeners.add(startDiscovery(nsd, found, "_rtsp._tcp", "rtsp"))
                listeners.add(startDiscovery(nsd, found, "_onvif._tcp", "onvif"))
            }
            collectSsdp(found)
        } finally {
            for (listener in listeners) {
                try {
                    nsd?.stopServiceDiscovery(listener)
                } catch (_: Exception) {
                    // Discovery may already be stopped.
                }
            }
            try {
                if (lock?.isHeld == true) lock.release()
            } catch (_: Exception) {
                // The lock is already released.
            }
        }
    }

    private fun startDiscovery(
        nsd: NsdManager,
        found: ConcurrentHashMap<String, Evidence>,
        type: String,
        service: String,
    ): NsdManager.DiscoveryListener {
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
            override fun onServiceFound(info: NsdServiceInfo) {
                try {
                    @Suppress("DEPRECATION")
                    nsd.resolveService(info, object : NsdManager.ResolveListener {
                        override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
                        override fun onServiceResolved(resolved: NsdServiceInfo) {
                            val host = ipv4Of(resolved) ?: return
                            if (parseIpv4(host) == null) return
                            merge(found, host, resolved.serviceName, service, emptyList())
                        }
                    })
                } catch (_: Exception) {
                    // Another resolve may already be in progress.
                }
            }
        }
        try {
            nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (_: Exception) {
            // The port check still covers hosts that do not announce.
        }
        return listener
    }

    private fun ipv4Of(info: NsdServiceInfo): String? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return info.hostAddresses.firstOrNull { it is Inet4Address }?.hostAddress
        }
        @Suppress("DEPRECATION")
        val host = info.host
        return if (host is Inet4Address) host.hostAddress else null
    }

    private fun collectSsdp(found: ConcurrentHashMap<String, Evidence>) {
        var socket: DatagramSocket? = null
        try {
            socket = DatagramSocket(null)
            socket.reuseAddress = true
            socket.broadcast = true
            socket.soTimeout = 200
            socket.bind(InetSocketAddress(0))
            val payload = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n"
            val data = payload.toByteArray(Charsets.UTF_8)
            socket.send(DatagramPacket(data, data.size, InetAddress.getByName("239.255.255.250"), 1900))
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
            val buffer = ByteArray(4096)
            while (System.nanoTime() < deadline) {
                val incoming = DatagramPacket(buffer, buffer.size)
                try {
                    socket.receive(incoming)
                } catch (_: SocketTimeoutException) {
                    continue
                }
                val message = String(incoming.data, 0, incoming.length, Charsets.UTF_8)
                readSsdp(found, message, incoming.address?.hostAddress)
            }
        } catch (_: Exception) {
            // Announcements are optional.
        } finally {
            socket?.close()
        }
    }

    private fun readSsdp(found: ConcurrentHashMap<String, Evidence>, message: String, sourceIp: String?) {
        if (message.length > 8000) return
        val response = message.startsWith("HTTP/1.1 200") || message.startsWith("HTTP/1.0 200") || message.startsWith("NOTIFY ")
        if (!response || !CAMERA_HINT.containsMatchIn(message)) return
        val location = LOCATION.find(message)?.groupValues?.get(1)
        val located = location?.let { IPV4.find(it)?.value }
        val ip = when {
            located != null && parseIpv4(located) != null -> located
            sourceIp != null && parseIpv4(sourceIp) != null -> sourceIp
            else -> return
        }
        val services = mutableListOf<String>()
        if (Regex("(?i)\\brtsp\\b").containsMatchIn(message)) services.add("rtsp")
        if (Regex("(?i)\\bonvif\\b").containsMatchIn(message)) services.add("onvif")
        val server = SERVER.find(message)?.groupValues?.get(1)?.trim()
        merge(found, ip, server, null, emptyList())
        for (service in services) merge(found, ip, null, service, emptyList())
    }

    private fun probePorts(hosts: List<String>, found: ConcurrentHashMap<String, Evidence>) {
        if (hosts.isEmpty()) return
        val pool = Executors.newFixedThreadPool(minOf(32, hosts.size))
        try {
            for (ip in hosts) {
                pool.submit {
                    val open = mutableListOf<Int>()
                    for (port in listOf(554, 8554, 37777)) {
                        if (connectPort(ip, port)) open.add(port)
                    }
                    if (open.isNotEmpty()) merge(found, ip, null, null, open)
                }
            }
            pool.shutdown()
            if (!pool.awaitTermination(90, TimeUnit.SECONDS)) pool.shutdownNow()
        } catch (_: Exception) {
            pool.shutdownNow()
        }
    }

    private fun connectPort(ip: String, port: Int): Boolean {
        if (parseIpv4(ip) == null) return false
        return try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(ip, port), 400)
                true
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun merge(
        found: ConcurrentHashMap<String, Evidence>,
        ip: String,
        name: String?,
        service: String?,
        ports: List<Int>,
    ) {
        val clean = name?.replace(Regex("\\s+"), " ")?.trim()?.take(120)
        found.compute(ip) { _, current ->
            val evidence = current ?: Evidence()
            synchronized(evidence) {
                if (evidence.name.isNullOrBlank() && !clean.isNullOrBlank()) evidence.name = clean
                if (service == "rtsp" || service == "onvif") evidence.services.add(service)
                for (port in ports) {
                    if (port == 554 || port == 8554 || port == 37777) evidence.ports.add(port)
                }
            }
            evidence
        }
    }

    private fun viewOf(found: Evidence?): EvidenceView {
        if (found == null) return EvidenceView(null, emptyList(), emptyList())
        return synchronized(found) { EvidenceView(found.name, found.services.toList(), found.ports.toList()) }
    }

    private fun serviceArray(found: EvidenceView?): JSONArray {
        val array = JSONArray()
        if (found?.services?.contains("rtsp") == true) array.put("rtsp")
        if (found?.services?.contains("onvif") == true) array.put("onvif")
        return array
    }

    private fun portArray(found: EvidenceView?): JSONArray {
        val array = JSONArray()
        for (port in listOf(554, 8554, 37777)) {
            if (found?.ports?.contains(port) == true) array.put(port)
        }
        return array
    }

    companion object {
        private val CAMERA_HINT = Regex("""(?i)\b(rtsp|onvif|hikvision|dahua|ezviz|uniview|amcrest|wyze|reolink|lorex|swann|foscam|imou|annke|tapo|eufy|arlo|blink|instar|ipcam|doorbell|nvr|dvr|camera)\b""")
        private val LOCATION = Regex("""(?im)^location:\s*(\S+)""")
        private val IPV4 = Regex("""(\d{1,3}(?:\.\d{1,3}){3})""")
        private val SERVER = Regex("""(?im)^server:\s*(.+)${'$'}""")
    }
}
