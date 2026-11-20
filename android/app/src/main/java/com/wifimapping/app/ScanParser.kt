package com.wifimapping.app

import android.net.wifi.ScanResult
import android.net.wifi.WifiSsid
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer

fun scanResultJson(result: ScanResult): JSONObject {
    val objectJson = JSONObject()
    objectJson.put("ssid", ssidOf(result))
    objectJson.put("bssid", result.BSSID ?: "")
    objectJson.put("rssi", result.level)
    objectJson.put("frequencyMhz", result.frequency)
    objectJson.put("channel", channelOf(result.frequency))
    objectJson.put("band", bandOf(result.frequency))
    objectJson.put("channelWidthMhz", widthOf(result.channelWidth))
    objectJson.put("centerFreq0", result.centerFreq0)
    objectJson.put("centerFreq1", result.centerFreq1)
    objectJson.put("wifiStandard", standardOf(result))
    objectJson.put("capabilities", result.capabilities ?: "")
    objectJson.put("securityTypes", securityTypes(result))
    objectJson.put("passpoint", result.isPasspointNetwork)
    objectJson.put("responder80211mc", result.is80211mcResponder)
    objectJson.put("responder80211az", if (Build.VERSION.SDK_INT >= 31) result.is80211azNtbResponder else false)
    objectJson.put("twtResponder", if (Build.VERSION.SDK_INT >= 31) result.isTwtResponder else false)
    objectJson.put("secureHeLtf", boolMethod(result, "isSecureHeLtfSupported"))
    objectJson.put("rangingFrameProtection", boolMethod(result, "isRangingFrameProtectionRequired"))
    objectJson.put("operatorName", textOf(result.operatorFriendlyName))
    objectJson.put("venueName", textOf(result.venueName))
    addLinkFields(result, objectJson)
    addInformationElements(result, objectJson)
    return objectJson
}

private fun ssidOf(result: ScanResult): String {
    val raw = if (Build.VERSION.SDK_INT >= 33) {
        wifiSsidText(result.wifiSsid)
    } else {
        result.SSID
    }
    return raw?.trim()?.removeSurrounding("\"") ?: ""
}

private fun wifiSsidText(ssid: WifiSsid?): String {
    return ssid?.toString() ?: ""
}

private fun textOf(value: CharSequence?): String? {
    val text = value?.toString()?.trim().orEmpty()
    return text.ifEmpty { null }
}

private fun channelOf(frequency: Int): Int {
    if (Build.VERSION.SDK_INT >= 31) {
        val converted = ScanResult.convertFrequencyMhzToChannelIfSupported(frequency)
        if (converted != ScanResult.UNSPECIFIED) return converted
    }
    return when {
        frequency == 2484 -> 14
        frequency in 2412..2472 -> (frequency - 2407) / 5
        frequency in 5160..5885 -> (frequency - 5000) / 5
        frequency == 5935 -> 2
        frequency in 5955..7115 -> (frequency - 5950) / 5
        else -> 0
    }
}

private fun bandOf(frequency: Int): String {
    return when (frequency) {
        in 2412..2484 -> "2.4"
        in 5160..5885 -> "5"
        in 5925..7125 -> "6"
        in 58320..70200 -> "60"
        else -> "unknown"
    }
}

private fun widthOf(width: Int): Int {
    return when (width) {
        ScanResult.CHANNEL_WIDTH_20MHZ -> 20
        ScanResult.CHANNEL_WIDTH_40MHZ -> 40
        ScanResult.CHANNEL_WIDTH_80MHZ -> 80
        ScanResult.CHANNEL_WIDTH_160MHZ -> 160
        ScanResult.CHANNEL_WIDTH_80MHZ_PLUS_MHZ -> 160
        ScanResult.CHANNEL_WIDTH_320MHZ -> 320
        else -> 20
    }
}

private fun standardOf(result: ScanResult): String {
    if (Build.VERSION.SDK_INT < 30) return "unknown"
    return when (result.wifiStandard) {
        ScanResult.WIFI_STANDARD_LEGACY -> "legacy"
        ScanResult.WIFI_STANDARD_11N -> "n"
        ScanResult.WIFI_STANDARD_11AC -> "ac"
        ScanResult.WIFI_STANDARD_11AX -> "ax"
        ScanResult.WIFI_STANDARD_11AD -> "ad"
        ScanResult.WIFI_STANDARD_11BE -> "be"
        else -> "unknown"
    }
}

private fun securityTypes(result: ScanResult): JSONArray {
    val names = JSONArray()
    if (Build.VERSION.SDK_INT < 33) return names
    for (type in result.securityTypes) names.put(securityName(type))
    return names
}

private fun securityName(type: Int): String {
    return when (type) {
        0 -> "OPEN"
        1 -> "WEP"
        2 -> "PSK"
        3 -> "EAP"
        4 -> "SAE"
        5 -> "EAP_WPA3_ENTERPRISE_192_BIT"
        6 -> "OWE"
        7 -> "WAPI_PSK"
        8 -> "WAPI_CERT"
        9 -> "EAP_WPA3_ENTERPRISE"
        11 -> "PASSPOINT"
        12 -> "PASSPOINT_R3"
        13 -> "DPP"
        else -> "UNKNOWN"
    }
}

private fun addLinkFields(result: ScanResult, objectJson: JSONObject) {
    val links = JSONArray()
    if (Build.VERSION.SDK_INT >= 33) {
        objectJson.put("apMldMac", result.apMldMacAddress?.toString())
        val linkId = result.apMloLinkId
        objectJson.put("apMloLinkId", if (linkId < 0) JSONObject.NULL else linkId)
        for (link in result.affiliatedMloLinks) {
            val item = JSONObject()
            item.put("linkId", link.linkId)
            item.put("mac", link.apMacAddress?.toString() ?: "")
            val frequency = ScanResult.convertChannelToFrequencyMhzIfSupported(link.channel, link.band)
            item.put("frequencyMhz", if (frequency == ScanResult.UNSPECIFIED) 0 else frequency)
            links.put(item)
        }
    } else {
        objectJson.put("apMldMac", JSONObject.NULL)
        objectJson.put("apMloLinkId", JSONObject.NULL)
    }
    objectJson.put("affiliatedLinks", links)
}

private fun addInformationElements(result: ScanResult, objectJson: JSONObject) {
    var country: String? = null
    var maxRate = 0.0
    var stations: Int? = null
    var utilization: Int? = null
    var admission: Int? = null
    val ouis = JSONArray()
    if (Build.VERSION.SDK_INT >= 30) {
        for (element in result.informationElements) {
            val bytes = bytesOf(element.bytes)
            when (element.id) {
                1, 50 -> maxRate = maxOf(maxRate, maxRateMbps(bytes))
                7 -> if (bytes.size >= 2) country = String(bytes, 0, 2, Charsets.US_ASCII).trim()
                11 -> if (bytes.size >= 5) {
                    stations = u16(bytes, 0)
                    utilization = bytes[2].toInt() and 0xff
                    admission = u16(bytes, 3)
                }
                221 -> if (bytes.size >= 3) {
                    ouis.put("%02X%02X%02X".format(bytes[0].toInt() and 0xff, bytes[1].toInt() and 0xff, bytes[2].toInt() and 0xff))
                }
            }
        }
    }
    objectJson.put("countryCode", country)
    objectJson.put("maxRateMbps", if (maxRate == 0.0) JSONObject.NULL else maxRate)
    objectJson.put("stationCount", stations ?: JSONObject.NULL)
    objectJson.put("channelUtilization", utilization ?: JSONObject.NULL)
    objectJson.put("admissionCapacity", admission ?: JSONObject.NULL)
    objectJson.put("vendorOuis", ouis)
}

private fun bytesOf(buffer: ByteBuffer): ByteArray {
    val copy = buffer.duplicate()
    val bytes = ByteArray(copy.remaining())
    copy.get(bytes)
    return bytes
}

private fun maxRateMbps(bytes: ByteArray): Double {
    var max = 0.0
    for (byte in bytes) {
        val rate = (byte.toInt() and 0x7f) * 0.5
        if (rate > max) max = rate
    }
    return max
}

private fun u16(bytes: ByteArray, offset: Int): Int {
    return ((bytes[offset].toInt() and 0xff) shl 8) or (bytes[offset + 1].toInt() and 0xff)
}

private fun boolMethod(result: ScanResult, name: String): Boolean {
    if (Build.VERSION.SDK_INT < 36) return false
    return try {
        ScanResult::class.java.getMethod(name).invoke(result) as Boolean
    } catch (_: Exception) {
        false
    }
}
