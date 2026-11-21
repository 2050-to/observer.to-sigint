package com.wifimapping.app

import android.app.ActivityManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.provider.Settings
import android.webkit.WebSettings
import com.getcapacitor.JSObject
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
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
        val hosts = JSONArray()
        for (item in plan.addresses) {
            val endpoint = item.role == "network" || item.role == "broadcast"
            val self = item.role == "device"
            val active = self || (!endpoint && present.contains(item.ip))
            val mac = if (!active) null else if (self) lan.mac ?: arp[item.ip] else arp[item.ip]
            val row = JSObject()
            row.put("ip", item.ip)
            row.put("role", item.role)
            row.put("present", active)
            row.put("mac", mac ?: JSONObject.NULL)
            row.put("name", JSONObject.NULL)
            hosts.put(row)
        }
        val root = JSObject()
        root.put("cidr", plan.cidr)
        root.put("interfacePrefix", plan.interfacePrefix)
        root.put("limited", plan.limited)
        root.put("checked", targets.size)
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
                return LocalLan(host, link.prefixLength, macFor(address))
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

    private data class LocalLan(val address: String, val prefix: Int, val mac: String?)
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
}
