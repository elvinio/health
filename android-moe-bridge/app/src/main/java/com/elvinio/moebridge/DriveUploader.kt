package com.elvinio.moebridge

import android.content.Context
import com.google.android.gms.auth.GoogleAuthUtil
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.elvinio.moebridge.db.AppDatabase
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/**
 * Writes captured items to a single plain-JSON Drive file `moe-inbox-incoming.json`
 * that the Finance PWA reads on its normal sync. Android is the SOLE writer of this
 * file: it merges new rows into the existing content (by id), caps growth, and
 * rewrites. Uses the OAuth `drive.file` scope (the file is a normal user-owned Drive
 * file, so the PWA's full-`drive` session can find & read it by name).
 */
object DriveUploader {

    const val FILE_NAME = "moe-inbox-incoming.json"
    const val SCOPE = "https://www.googleapis.com/auth/drive.file"
    private const val MAX_ITEMS = 200
    private const val MAX_AGE_MS = 60L * 24 * 60 * 60 * 1000 // 60 days

    private val http = OkHttpClient()
    private val JSON = "application/json".toMediaType()

    data class Result(val uploaded: Int, val total: Int)

    class NotSignedIn : Exception("Not signed in to Google Drive")

    /** Push all unsynced captures to Drive. Returns counts; no-op if nothing pending. */
    suspend fun sync(context: Context): Result {
        val dao = AppDatabase.get(context).captureDao()
        val prefs = Prefs(context)
        val pending = dao.pendingUnsynced()
        if (pending.isEmpty()) return Result(0, dao.total())

        val token = freshToken(context)

        var fileId = prefs.driveFileId ?: findFile(token)
        val existing = if (fileId != null) downloadItems(token, fileId) else JSONArray()

        // Merge by id (incoming wins), cap by age + count, newest first.
        val byId = LinkedHashMap<String, JSONObject>()
        for (i in 0 until existing.length()) {
            val o = existing.optJSONObject(i) ?: continue
            o.optString("id").takeIf { it.isNotEmpty() }?.let { byId[it] = o }
        }
        pending.forEach { byId[it.id] = MoeAccessibilityService.jsonItem(it) }

        val now = System.currentTimeMillis()
        val cutoff = now - MAX_AGE_MS
        val merged = byId.values
            .filter { it.optLong("capturedAt") >= cutoff }
            .sortedByDescending { it.optLong("capturedAt") }
            .take(MAX_ITEMS)

        val payload = JSONObject().apply {
            put("items", JSONArray(merged))
            put("_updatedAt", now)
        }.toString()

        if (fileId == null) {
            fileId = createFile(token)
            prefs.driveFileId = fileId
        }
        uploadContent(token, fileId, payload)

        dao.markSynced(pending.map { it.id }, now)
        prefs.driveFileId = fileId
        prefs.lastSync = now
        GoogleSignIn.getLastSignedInAccount(context)?.email?.let { prefs.account = it }
        return Result(pending.size, dao.total())
    }

    private fun freshToken(context: Context): String {
        val acct = GoogleSignIn.getLastSignedInAccount(context) ?: throw NotSignedIn()
        val account = acct.account ?: throw NotSignedIn()
        // Clear any cached token first to avoid using a stale/expired one.
        return GoogleAuthUtil.getToken(context, account, "oauth2:$SCOPE")
    }

    private fun findFile(token: String): String? {
        val q = "name='$FILE_NAME' and trashed=false"
        val url = "https://www.googleapis.com/drive/v3/files?spaces=drive" +
            "&fields=files(id,name)&q=" + java.net.URLEncoder.encode(q, "UTF-8")
        http.newCall(Request.Builder().url(url).header("Authorization", "Bearer $token").build())
            .execute().use { resp ->
                if (!resp.isSuccessful) throw httpError("find", resp.code, resp.body?.string())
                val files = JSONObject(resp.body!!.string()).optJSONArray("files") ?: return null
                return if (files.length() > 0) files.getJSONObject(0).optString("id") else null
            }
    }

    private fun downloadItems(token: String, fileId: String): JSONArray {
        val url = "https://www.googleapis.com/drive/v3/files/$fileId?alt=media"
        http.newCall(Request.Builder().url(url).header("Authorization", "Bearer $token").build())
            .execute().use { resp ->
                if (resp.code == 404) return JSONArray()
                if (!resp.isSuccessful) throw httpError("download", resp.code, resp.body?.string())
                val body = resp.body?.string().orEmpty()
                if (body.isBlank()) return JSONArray()
                return JSONObject(body).optJSONArray("items") ?: JSONArray()
            }
    }

    private fun createFile(token: String): String {
        val meta = JSONObject().put("name", FILE_NAME).put("mimeType", "application/json")
        val req = Request.Builder()
            .url("https://www.googleapis.com/drive/v3/files?fields=id")
            .header("Authorization", "Bearer $token")
            .post(meta.toString().toRequestBody(JSON))
            .build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw httpError("create", resp.code, resp.body?.string())
            return JSONObject(resp.body!!.string()).getString("id")
        }
    }

    private fun uploadContent(token: String, fileId: String, content: String) {
        val req = Request.Builder()
            .url("https://www.googleapis.com/upload/drive/v3/files/$fileId?uploadType=media")
            .header("Authorization", "Bearer $token")
            .patch(content.toRequestBody(JSON))
            .build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw httpError("upload", resp.code, resp.body?.string())
        }
    }

    private fun httpError(op: String, code: Int, body: String?) =
        Exception("Drive $op failed (HTTP $code): ${body?.take(200)}")
}
