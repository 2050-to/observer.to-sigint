package com.wifimapping.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONArray

@CapacitorPlugin(
    name = "Wardrive",
    permissions = [
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = "location"),
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
        Permission(strings = [Manifest.permission.NEARBY_WIFI_DEVICES], alias = "nearby"),
        Permission(strings = [Manifest.permission.BLUETOOTH_SCAN], alias = "bluetoothScan"),
        Permission(strings = [Manifest.permission.BLUETOOTH_CONNECT], alias = "bluetoothConnect"),
    ],
)
class WardrivePlugin : Plugin() {
    override fun load() {
        instance = this
        super.load()
    }

    override fun handleOnDestroy() {
        if (instance === this) instance = null
        super.handleOnDestroy()
    }

    @PluginMethod
    fun startDrive(call: PluginCall) {
        val missing = requiredPermissions().filter { permission ->
            ContextCompat.checkSelfPermission(context, permission) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            requestPermissionForAliases(aliasesFor(missing), call, "startPermitted")
            return
        }
        launch(call)
    }

    @PermissionCallback
    fun startPermitted(call: PluginCall) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Location permission is required to scan Wi-Fi")
            return
        }
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            call.reject("Notifications are required so the drive can keep running")
            return
        }
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("nearby") != PermissionState.GRANTED) {
            call.reject("Nearby Wi-Fi permission is required to read scan results")
            return
        }
        if (Build.VERSION.SDK_INT >= 31 && getPermissionState("bluetoothScan") != PermissionState.GRANTED) {
            call.reject("Bluetooth scan permission is required to map nearby advertisements")
            return
        }
        if (Build.VERSION.SDK_INT >= 31 && getPermissionState("bluetoothConnect") != PermissionState.GRANTED) {
            call.reject("Bluetooth permission is required to read advertisement addresses")
            return
        }
        launch(call)
    }

    @PluginMethod
    fun stopDrive(call: PluginCall) {
        context.stopService(Intent(context, WardriveService::class.java))
        call.resolve()
    }

    @PluginMethod
    fun clearLocal(call: PluginCall) {
        WardriveService.uploadsOpen = false
        context.stopService(Intent(context, WardriveService::class.java))
        while (WardriveService.flushActive) Thread.sleep(25)
        Outbox(context).clear()
        call.resolve()
    }

    @PluginMethod
    fun replaceLocal(call: PluginCall) {
        Outbox(context).replace(call.getString("catalog") ?: "", call.getString("journal") ?: "[]")
        call.resolve()
    }

    @PluginMethod
    fun catalogSubnet(call: PluginCall) {
        if (call.getBoolean("consent", false) != true) {
            call.reject("Cataloging IP addresses stays off until you allow it for a network you own")
            return
        }
        try {
            call.resolve(SubnetCataloger(context).catalog())
        } catch (error: Exception) {
            call.reject(error.message ?: "The subnet could not be cataloged")
        }
    }

    @PluginMethod
    fun deviceDetails(call: PluginCall) {
        if (call.getBoolean("consent", false) != true) {
            call.reject("Device details stay off until you allow them for a network you own")
            return
        }
        try {
            call.resolve(SubnetCataloger(context).details(call.getString("browser") ?: ""))
        } catch (error: Exception) {
            call.reject(error.message ?: "Device details could not be read")
        }
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val status = JSObject()
        status.put("running", WardriveService.running)
        status.put("message", WardriveService.message)
        call.resolve(status)
    }

    @PluginMethod
    fun getLocalCatalog(call: PluginCall) {
        val store = Outbox(context)
        val result = JSObject()
        result.put("catalog", store.readCatalogText())
        result.put("journal", store.readJournalText())
        call.resolve(result)
    }

    @PluginMethod
    fun saveLocalCatalog(call: PluginCall) {
        val catalog = call.getString("catalog") ?: ""
        Outbox(context).writeCatalog(catalog)
        call.resolve()
    }

    @PluginMethod
    fun markUploaded(call: PluginCall) {
        val raw = call.getString("scanIds") ?: "[]"
        val ids = JSONArray(raw)
        val saved = mutableSetOf<String>()
        for (index in 0 until ids.length()) {
            val id = ids.optString(index)
            if (id.isNotEmpty()) saved += id
        }
        Outbox(context).markUploaded(saved)
        call.resolve()
    }

    companion object {
        @Volatile
        private var instance: WardrivePlugin? = null

        fun emitScanQueued() {
            val plugin = instance ?: return
            Handler(Looper.getMainLooper()).post {
                plugin.notifyListeners("scanQueued", JSObject())
            }
        }

        fun emitScansSynced(count: Int) {
            val plugin = instance ?: return
            Handler(Looper.getMainLooper()).post {
                val data = JSObject()
                data.put("count", count)
                plugin.notifyListeners("scansSynced", data)
            }
        }
    }

    private fun launch(call: PluginCall) {
        val apiUrl = call.getString("apiUrl")
        val token = call.getString("token")
        if (apiUrl.isNullOrBlank() || !apiUrl.startsWith("https://")) {
            call.reject("apiUrl must be https")
            return
        }
        if (token.isNullOrBlank()) {
            call.reject("token is required")
            return
        }
        WardriveService.uploadsOpen = true
        val intent = Intent(context, WardriveService::class.java)
        intent.putExtra(WardriveService.EXTRA_API_URL, apiUrl)
        intent.putExtra(WardriveService.EXTRA_TOKEN, token)
        ContextCompat.startForegroundService(context, intent)
        call.resolve()
    }

    private fun requiredPermissions(): List<String> {
        val permissions = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION)
        if (Build.VERSION.SDK_INT >= 33) {
            permissions += Manifest.permission.POST_NOTIFICATIONS
            permissions += Manifest.permission.NEARBY_WIFI_DEVICES
        }
        if (Build.VERSION.SDK_INT >= 31) {
            permissions += Manifest.permission.BLUETOOTH_SCAN
            permissions += Manifest.permission.BLUETOOTH_CONNECT
        }
        return permissions
    }

    private fun aliasesFor(permissions: List<String>): Array<String> {
        return permissions.map { permission ->
            when (permission) {
                Manifest.permission.POST_NOTIFICATIONS -> "notifications"
                Manifest.permission.NEARBY_WIFI_DEVICES -> "nearby"
                Manifest.permission.BLUETOOTH_SCAN -> "bluetoothScan"
                Manifest.permission.BLUETOOTH_CONNECT -> "bluetoothConnect"
                else -> "location"
            }
        }.toTypedArray()
    }
}
