package com.wifimapping.app

import android.content.Context
import androidx.security.crypto.EncryptedFile
import androidx.security.crypto.MasterKeys
import org.json.JSONArray
import java.io.File

class Outbox(context: Context) {
    private val file = File(context.filesDir, "outbox.bin")
    private val appContext = context.applicationContext

    fun read(): JSONArray {
        if (!file.exists() || file.length() == 0L) return JSONArray()
        val text = encrypted().openFileInput().bufferedReader().use { it.readText() }
        if (text.isBlank()) return JSONArray()
        return JSONArray(text)
    }

    fun write(items: JSONArray) {
        if (file.exists() && !file.delete()) {
            throw IllegalStateException("could not replace the encrypted outbox")
        }
        encrypted().openFileOutput().bufferedWriter().use { it.write(items.toString()) }
    }

    private fun encrypted(): EncryptedFile {
        val alias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        return EncryptedFile.Builder(
            file,
            appContext,
            alias,
            EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB,
        ).build()
    }
}
