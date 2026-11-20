package com.wifimapping.app

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanResult
import android.content.Context
import android.os.Build
import android.telephony.CellInfo
import android.telephony.CellInfoGsm
import android.telephony.CellInfoLte
import android.telephony.CellInfoNr
import android.telephony.CellInfoWcdma
import android.telephony.CellSignalStrengthNr
import android.telephony.TelephonyManager
import org.json.JSONArray
import org.json.JSONObject

private val MAC = Regex("^[0-9a-f]{2}(:[0-9a-f]{2}){5}$")

fun bluetoothEnabled(context: Context): Boolean {
    val manager = context.getSystemService(BluetoothManager::class.java) ?: return false
    return manager.adapter?.isEnabled == true
}

@SuppressLint("MissingPermission")
fun advertJson(result: ScanResult): JSONObject? {
    val address = result.device?.address?.trim()?.lowercase() ?: return null
    if (!MAC.matches(address)) return null
    val record = result.scanRecord
    val tx = record?.txPowerLevel ?: Int.MIN_VALUE
    val uuids = JSONArray()
    record?.serviceUuids?.forEach { uuid -> uuids.put(uuid.uuid.toString()) }
    val json = JSONObject()
    json.put("address", address)
    json.put("addressType", if (locallyAdministered(address)) "random" else "public")
    json.put("name", record?.deviceName ?: JSONObject.NULL)
    json.put("rssi", result.rssi)
    json.put("txPower", if (tx == Int.MIN_VALUE || tx == 127) JSONObject.NULL else tx)
    json.put("serviceUuids", uuids)
    return json
}

fun cellTowers(context: Context): JSONArray {
    val telephony = context.getSystemService(TelephonyManager::class.java) ?: return JSONArray()
    val infos = try {
        telephony.allCellInfo
    } catch (_: SecurityException) {
        null
    } ?: return JSONArray()
    val towers = JSONArray()
    for (info in infos) {
        towerJson(info)?.let { towers.put(it) }
    }
    return towers
}

private fun locallyAdministered(address: String): Boolean {
    val first = address.substringBefore(':').toIntOrNull(16) ?: return true
    return first and 0x02 != 0
}

private fun towerJson(info: CellInfo): JSONObject? {
    return when (info) {
        is CellInfoLte -> lte(info)
        is CellInfoNr -> nr(info)
        is CellInfoWcdma -> wcdma(info)
        is CellInfoGsm -> gsm(info)
        else -> null
    }
}

private fun lte(info: CellInfoLte): JSONObject? {
    val identity = info.cellIdentity
    val strength = info.cellSignalStrength
    val mcc = identity.mccString ?: return null
    val mnc = identity.mncString ?: return null
    if (identity.ci == CellInfo.UNAVAILABLE || identity.tac == CellInfo.UNAVAILABLE) return null
    val rssi = signal(strength.rsrp, strength.dbm) ?: return null
    val timing = strength.timingAdvance
    val timingM = if (timing == CellInfo.UNAVAILABLE || timing < 0 || timing > 1282) null else timing * 78.12
    return tower(
        radio = "lte",
        registered = info.isRegistered,
        mcc = mcc,
        mnc = mnc,
        area = identity.tac.toString(),
        cellId = identity.ci.toString(),
        pci = if (identity.pci == CellInfo.UNAVAILABLE) null else identity.pci,
        rssi = rssi,
        timingAdvanceM = timingM,
    )
}

private fun nr(info: CellInfoNr): JSONObject? {
    val identity = info.cellIdentity as? android.telephony.CellIdentityNr ?: return null
    val strength = info.cellSignalStrength as? CellSignalStrengthNr ?: return null
    val mcc = identity.mccString ?: return null
    val mnc = identity.mncString ?: return null
    if (identity.nci == CellInfo.UNAVAILABLE.toLong() || identity.nci < 0) return null
    if (identity.tac == CellInfo.UNAVAILABLE) return null
    val rssi = signal(strength.ssRsrp, strength.dbm) ?: return null
    val timingM = nrTimingMeters(strength)
    return tower(
        radio = "nr",
        registered = info.isRegistered,
        mcc = mcc,
        mnc = mnc,
        area = identity.tac.toString(),
        cellId = identity.nci.toString(),
        pci = if (identity.pci == CellInfo.UNAVAILABLE) null else identity.pci,
        rssi = rssi,
        timingAdvanceM = timingM,
    )
}

private fun nrTimingMeters(strength: CellSignalStrengthNr): Double? {
    if (Build.VERSION.SDK_INT < 34) return null
    val micros = strength.timingAdvanceMicros
    if (micros == CellInfo.UNAVAILABLE || micros <= 0) return null
    val meters = micros * 299_792_458.0 / 2.0 / 1_000_000.0
    if (meters <= 0 || meters > 100_000) return null
    return meters
}

private fun wcdma(info: CellInfoWcdma): JSONObject? {
    val identity = info.cellIdentity
    val mcc = identity.mccString ?: return null
    val mnc = identity.mncString ?: return null
    if (identity.cid == CellInfo.UNAVAILABLE || identity.lac == CellInfo.UNAVAILABLE) return null
    val rssi = signal(info.cellSignalStrength.dbm, CellInfo.UNAVAILABLE) ?: return null
    return tower(
        radio = "wcdma",
        registered = info.isRegistered,
        mcc = mcc,
        mnc = mnc,
        area = identity.lac.toString(),
        cellId = identity.cid.toString(),
        pci = if (identity.psc == CellInfo.UNAVAILABLE) null else identity.psc,
        rssi = rssi,
        timingAdvanceM = null,
    )
}

private fun gsm(info: CellInfoGsm): JSONObject? {
    val identity = info.cellIdentity
    val mcc = identity.mccString ?: return null
    val mnc = identity.mncString ?: return null
    if (identity.cid == CellInfo.UNAVAILABLE || identity.lac == CellInfo.UNAVAILABLE) return null
    val rssi = signal(info.cellSignalStrength.dbm, CellInfo.UNAVAILABLE) ?: return null
    return tower(
        radio = "gsm",
        registered = info.isRegistered,
        mcc = mcc,
        mnc = mnc,
        area = identity.lac.toString(),
        cellId = identity.cid.toString(),
        pci = null,
        rssi = rssi,
        timingAdvanceM = null,
    )
}

private fun signal(primary: Int, fallback: Int): Int? {
    if (primary != CellInfo.UNAVAILABLE) return primary
    if (fallback != CellInfo.UNAVAILABLE) return fallback
    return null
}

private fun tower(
    radio: String,
    registered: Boolean,
    mcc: String,
    mnc: String,
    area: String,
    cellId: String,
    pci: Int?,
    rssi: Int,
    timingAdvanceM: Double?,
): JSONObject {
    val json = JSONObject()
    json.put("radio", radio)
    json.put("registered", registered)
    json.put("mcc", mcc)
    json.put("mnc", mnc)
    json.put("area", area)
    json.put("cellId", cellId)
    json.put("pci", pci ?: JSONObject.NULL)
    json.put("rssi", rssi)
    json.put("timingAdvanceM", timingAdvanceM ?: JSONObject.NULL)
    return json
}
