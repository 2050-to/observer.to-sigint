package com.wifimapping.app

import android.content.Context
import androidx.security.crypto.EncryptedFile
import androidx.security.crypto.MasterKeys
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class Outbox(context: Context) {
    private val journalFile = File(context.filesDir, "outbox.bin")
    private val catalogFile = File(context.filesDir, "catalog.bin")
    private val appContext = context.applicationContext

    fun append(body: JSONObject) {
        synchronized(lock) {
            val queued = readJournal()
            queued.put(body)
            writeJournal(queued)
        }
    }

    fun readJournalText(): String {
        synchronized(lock) {
            val text = readText(journalFile)
            return if (text.isBlank()) "[]" else text
        }
    }

    fun readCatalogText(): String {
        synchronized(lock) {
            return readText(catalogFile)
        }
    }

    fun writeCatalog(text: String) {
        synchronized(lock) {
            val incoming = if (text.isBlank()) JSONObject() else JSONObject(text)
            val existing = readCatalogObject()
            incoming.put("syncedBssids", union(existing.optJSONArray("syncedBssids"), incoming.optJSONArray("syncedBssids")))
            incoming.put("foldedScanIds", union(existing.optJSONArray("foldedScanIds"), incoming.optJSONArray("foldedScanIds")))
            writeText(catalogFile, incoming.toString())
            compact()
        }
    }

    fun markUploaded(scanIds: Set<String>) {
        synchronized(lock) {
            if (scanIds.isEmpty()) return
            val queued = readJournal()
            for (index in 0 until queued.length()) {
                val item = queued.getJSONObject(index)
                if (scanIds.contains(item.optString("scanId"))) item.put("uploaded", true)
            }
            writeJournal(queued)
            compact()
        }
    }

    fun addSyncedBssids(bssids: Collection<String>) {
        synchronized(lock) {
            val json = readCatalogObject()
            val merged = linkedSetOf<String>()
            collect(json.optJSONArray("syncedBssids"), merged)
            for (bssid in bssids) {
                val normalized = bssid.trim().lowercase()
                if (normalized.isNotEmpty()) merged += normalized
            }
            json.put("syncedBssids", JSONArray(merged.toList()))
            writeText(catalogFile, json.toString())
        }
    }

    fun syncedBssids(): Set<String> {
        synchronized(lock) {
            val saved = linkedSetOf<String>()
            collect(readCatalogObject().optJSONArray("syncedBssids"), saved)
            return saved.map { it.lowercase() }.toSet()
        }
    }

    fun countUnuploaded(): Int {
        synchronized(lock) {
            val queued = readJournal()
            var count = 0
            for (index in 0 until queued.length()) {
                if (!queued.getJSONObject(index).optBoolean("uploaded", false)) count += 1
            }
            return count
        }
    }

    fun unuploaded(): List<JSONObject> {
        synchronized(lock) {
            val queued = readJournal()
            val pending = mutableListOf<JSONObject>()
            for (index in 0 until queued.length()) {
                val item = queued.getJSONObject(index)
                if (!item.optBoolean("uploaded", false)) pending += JSONObject(item.toString())
            }
            return pending
        }
    }

    private fun compact() {
        val folded = linkedSetOf<String>()
        collect(readCatalogObject().optJSONArray("foldedScanIds"), folded)
        val queued = readJournal()
        val kept = JSONArray()
        for (index in 0 until queued.length()) {
            val item = queued.getJSONObject(index)
            val uploaded = item.optBoolean("uploaded", false)
            val scanId = item.optString("scanId")
            if (uploaded && folded.contains(scanId)) continue
            kept.put(item)
        }
        if (kept.length() != queued.length()) writeJournal(kept)
    }

    private fun readJournal(): JSONArray {
        val text = readText(journalFile)
        if (text.isBlank()) return JSONArray()
        return JSONArray(text)
    }

    private fun writeJournal(items: JSONArray) {
        writeText(journalFile, items.toString())
    }

    private fun readCatalogObject(): JSONObject {
        val text = readText(catalogFile)
        if (text.isBlank()) return JSONObject()
        return JSONObject(text)
    }

    private fun readText(file: File): String {
        if (!file.exists() || file.length() == 0L) return ""
        return encrypted(file).openFileInput().bufferedReader().use { it.readText() }
    }

    private fun writeText(file: File, text: String) {
        if (file.exists() && !file.delete()) {
            throw IllegalStateException("could not replace the encrypted file")
        }
        encrypted(file).openFileOutput().bufferedWriter().use { it.write(text) }
    }

    private fun encrypted(file: File): EncryptedFile {
        val alias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        return EncryptedFile.Builder(
            file,
            appContext,
            alias,
            EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB,
        ).build()
    }

    companion object {
        val lock = Any()

        private fun collect(array: JSONArray?, into: MutableSet<String>) {
            if (array == null) return
            for (index in 0 until array.length()) {
                val value = array.optString(index).trim()
                if (value.isNotEmpty()) into += value
            }
        }

        private fun union(left: JSONArray?, right: JSONArray?): JSONArray {
            val merged = linkedSetOf<String>()
            collect(left, merged)
            collect(right, merged)
            return JSONArray(merged.toList())
        }
    }
}
