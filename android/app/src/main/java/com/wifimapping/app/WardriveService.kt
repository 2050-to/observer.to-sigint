package com.wifimapping.app

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.ArrayDeque
import java.util.UUID
import javax.net.ssl.HttpsURLConnection
import kotlin.math.max

class WardriveService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val scanTimes = ArrayDeque<Long>()
    private var wakeLock: PowerManager.WakeLock? = null
    private var apiUrl = ""
    private var token = ""
    private var radiusM = 91.4
    private var speedMps: Double? = null
    private var periodMs = 30_000L
    private var lastFingerprint = ""
    private var flushing = false
    private var flushAgain = false
    private var locationCallback: LocationCallback? = null
    private var sensorManager: SensorManager? = null
    private var pressureListener: SensorEventListener? = null
    private var referencePressure: Float? = null
    private var altitudeM: Double? = null
    private var verticalAccuracyM: Double? = null
    private var relativeM: Double? = null
    private lateinit var outbox: Outbox
    private lateinit var wifiManager: WifiManager

    private val scanTask = Runnable { requestScan() }
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val updated = intent.getBooleanExtra(WifiManager.EXTRA_RESULTS_UPDATED, false)
            if (!updated) {
                updateStatus("Android throttled the scan")
                return
            }
            @Suppress("DEPRECATION")
            publish(wifiManager.scanResults ?: emptyList())
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        apiUrl = intent?.getStringExtra(EXTRA_API_URL) ?: apiUrl
        token = intent?.getStringExtra(EXTRA_TOKEN) ?: token
        if (apiUrl.isBlank() || token.isBlank()) {
            stopSelf()
            return START_NOT_STICKY
        }
        startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        if (!::outbox.isInitialized) {
            outbox = Outbox(this)
            wifiManager = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
            val lock = (getSystemService(POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "wifi-mapping:drive")
            lock.setReferenceCounted(false)
            lock.acquire()
            wakeLock = lock
            val filter = IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION)
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(receiver, filter, RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(receiver, filter)
            }
            startLocation()
            startBarometer()
            running = true
            updateStatus("Drive is running")
            requestScan()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(scanTask)
        locationCallback?.let {
            LocationServices.getFusedLocationProviderClient(this).removeLocationUpdates(it)
        }
        try {
            unregisterReceiver(receiver)
        } catch (_: IllegalArgumentException) {
            // The receiver was not registered.
        }
        pressureListener?.let { sensorManager?.unregisterListener(it) }
        pressureListener = null
        wakeLock?.release()
        running = false
        updateStatus("Drive is stopped.")
        super.onDestroy()
    }

    @SuppressLint("MissingPermission")
    private fun startLocation() {
        val client = LocationServices.getFusedLocationProviderClient(this)
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5_000L)
            .setMinUpdateIntervalMillis(2_000L)
            .build()
        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { onLocation(it) }
            }
        }
        locationCallback = callback
        client.requestLocationUpdates(request, callback, mainLooper)
    }

    private fun startBarometer() {
        val manager = getSystemService(SensorManager::class.java)
        val sensor = manager.getDefaultSensor(Sensor.TYPE_PRESSURE) ?: return
        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                val pressure = event.values.firstOrNull() ?: return
                val reference = referencePressure ?: pressure.also { referencePressure = it }
                relativeM = SensorManager.getAltitude(reference, pressure).toDouble()
            }

            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
        }
        sensorManager = manager
        pressureListener = listener
        manager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)
    }

    private fun onLocation(location: Location) {
        lastLat = location.latitude
        lastLon = location.longitude
        lastAccuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null
        altitudeM = if (location.hasAltitude()) location.altitude else null
        verticalAccuracyM = if (location.hasVerticalAccuracy()) location.verticalAccuracyMeters.toDouble() else null
        if (!location.hasSpeed()) return
        val previous = periodMs
        speedMps = location.speed.toDouble()
        val next = periodFor(radiusM, speedMps)
        if (next + 1_000 < previous) {
            periodMs = next
            schedule(next)
            updateStatus("Speed changed. Next scan in ${next / 1000}s")
        } else {
            periodMs = next
        }
    }

    private fun requestScan() {
        val now = System.currentTimeMillis()
        while (scanTimes.isNotEmpty() && now - scanTimes.first() > 120_000) scanTimes.removeFirst()
        if (scanTimes.size >= 4) {
            updateStatus("Android throttled the scan")
            schedule(periodMs)
            return
        }
        @Suppress("DEPRECATION")
        val started = wifiManager.startScan()
        if (started) {
            scanTimes.addLast(now)
        } else {
            updateStatus("Android throttled the scan")
        }
        schedule(periodFor(radiusM, speedMps))
    }

    private fun schedule(delayMs: Long) {
        periodMs = delayMs
        handler.removeCallbacks(scanTask)
        handler.postDelayed(scanTask, delayMs)
    }

    private fun publish(results: List<android.net.wifi.ScanResult>) {
        val fingerprint = results.joinToString("|") { "${it.BSSID}:${it.level}:${it.timestamp}" }
        if (fingerprint.isEmpty() || fingerprint == lastFingerprint) return
        lastFingerprint = fingerprint
        val networks = JSONArray()
        for (result in results) {
            if (result.BSSID.isNullOrBlank()) continue
            networks.put(scanResultJson(result))
        }
        val body = JSONObject()
        body.put("scanId", UUID.randomUUID().toString())
        body.put("observedAt", java.time.Instant.now().toString())
        body.put("lat", lastLat ?: JSONObject.NULL)
        body.put("lon", lastLon ?: JSONObject.NULL)
        body.put("accuracy", lastAccuracy ?: JSONObject.NULL)
        body.put("altitudeM", altitudeM ?: JSONObject.NULL)
        body.put("verticalAccuracyM", verticalAccuracyM ?: JSONObject.NULL)
        body.put("relativeM", relativeM ?: JSONObject.NULL)
        body.put("speedMps", speedMps ?: JSONObject.NULL)
        body.put("networks", networks)
        outbox.append(body)
        WardrivePlugin.emitScanQueued()
        if (hearsSaved(networks)) {
            Thread { flush() }.start()
        } else {
            updateStatus(waitingStatus())
        }
    }

    private fun hearsSaved(networks: JSONArray): Boolean {
        val saved = outbox.syncedBssids()
        if (saved.isEmpty()) return false
        for (index in 0 until networks.length()) {
            val bssid = networks.getJSONObject(index).optString("bssid").trim().lowercase()
            if (bssid.isNotEmpty() && saved.contains(bssid)) return true
        }
        return false
    }

    private fun flush() {
        synchronized(this) {
            if (flushing) {
                flushAgain = true
                return
            }
            flushing = true
        }
        var accepted = 0
        try {
            var again = true
            while (again) {
                synchronized(this) { flushAgain = false }
                val pending = outbox.unuploaded()
                val uploadedIds = mutableListOf<String>()
                val synced = mutableListOf<String>()
                var failed = false
                for (body in pending) {
                    val response = postScan(body)
                    if (response == null) {
                        failed = true
                        break
                    }
                    uploadedIds += body.getString("scanId")
                    val networks = body.optJSONArray("networks")
                    if (networks != null) {
                        for (index in 0 until networks.length()) {
                            val bssid = networks.getJSONObject(index).optString("bssid").trim().lowercase()
                            if (bssid.isNotEmpty()) synced += bssid
                        }
                    }
                    response.optDouble("radiusM").takeIf { it.isFinite() && it > 0 }?.let { radiusM = it }
                    response.optDouble("scanPeriodSeconds").takeIf { it.isFinite() && it > 0 }?.let {
                        periodMs = (it * 1000).toLong()
                    }
                }
                if (uploadedIds.isNotEmpty()) {
                    outbox.markUploaded(uploadedIds.toSet())
                    outbox.addSyncedBssids(synced)
                    accepted += uploadedIds.size
                }
                if (failed) break
                again = synchronized(this) { flushAgain }
            }
        } finally {
            synchronized(this) { flushing = false }
        }
        if (accepted > 0) {
            val noun = if (accepted == 1) "scan" else "scans"
            updateStatus("Synced $accepted $noun.")
            WardrivePlugin.emitScansSynced(accepted)
        } else if (outbox.countUnuploaded() > 0) {
            updateStatus(waitingStatus())
        }
    }

    private fun waitingStatus(): String {
        val count = outbox.countUnuploaded()
        val noun = if (count == 1) "scan" else "scans"
        val pronoun = if (count == 1) "It" else "They"
        return "$count $noun on this phone. $pronoun will sync when a saved network is in range."
    }

    private fun postScan(body: JSONObject): JSONObject? {
        val connection = (URL("${apiUrl.trimEnd('/')}/api/scans").openConnection() as HttpsURLConnection)
        return try {
            connection.requestMethod = "POST"
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code == HttpURLConnection.HTTP_OK) JSONObject(text) else null
        } catch (_: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }

    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(CHANNEL_ID, "Wardrive", NotificationManager.IMPORTANCE_LOW)
        manager.createNotificationChannel(channel)
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Wi-Fi mapping")
            .setContentText("Collecting networks while the phone is on")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build()
    }

    private fun updateStatus(text: String) {
        message = text
    }

    companion object {
        const val EXTRA_API_URL = "apiUrl"
        const val EXTRA_TOKEN = "token"
        private const val CHANNEL_ID = "wardrive"
        private const val NOTIFICATION_ID = 41
        private const val V_SLOW = 0.82
        private const val V_MAX = 44.704

        @Volatile var running = false
        @Volatile var message = "Drive is stopped."
        @Volatile var lastLat: Double? = null
        @Volatile var lastLon: Double? = null
        @Volatile var lastAccuracy: Double? = null

        fun periodFor(radiusM: Double, speedMps: Double?): Long {
            val speed = when {
                speedMps == null -> V_MAX
                speedMps < V_SLOW -> V_SLOW
                speedMps > V_MAX -> V_MAX
                else -> speedMps
            }
            val dwellMs = (2 * radiusM / speed) * 1000
            return max(dwellMs.toLong(), 30_000L)
        }
    }
}

private fun Double.isFinite(): Boolean = !this.isNaN() && !this.isInfinite()
