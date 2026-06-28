package com.elvinio.moebridge

import android.accessibilityservice.AccessibilityService
import android.app.Notification
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.elvinio.moebridge.db.AppDatabase
import com.elvinio.moebridge.db.CaptureEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Captures MOE Parents Gateway content via accessibility events:
 *  - TYPE_NOTIFICATION_STATE_CHANGED: reads the posted Notification's title/text.
 *  - TYPE_WINDOW_STATE/CONTENT_CHANGED: walks the on-screen node tree for visible text.
 *
 * Filtered to the configured package(s) (or all, in debug "capture all" mode),
 * deduped by a content hash, persisted to Room, then a Drive sync is kicked.
 */
class MoeAccessibilityService : AccessibilityService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefs by lazy { Prefs(this) }
    private val dao by lazy { AppDatabase.get(this).captureDao() }

    // Debounce noisy window-content events per package.
    private var lastScrapeAt = 0L

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString() ?: return
        val filter = prefs.packageFilter()
        if (filter != null && pkg !in filter) return

        when (event.eventType) {
            AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED ->
                handleNotification(event, pkg)

            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ->
                scrapeWindow(event, pkg)

            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                val now = System.currentTimeMillis()
                if (now - lastScrapeAt < 1500) return
                lastScrapeAt = now
                scrapeWindow(event, pkg)
            }
        }
    }

    private fun handleNotification(event: AccessibilityEvent, pkg: String) {
        val notif = event.parcelableData as? Notification
        var title = ""
        var text = ""
        if (notif != null) {
            val ex = notif.extras
            title = (ex.getCharSequence(Notification.EXTRA_TITLE) ?: "").toString()
            text = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT)
                ?: ex.getCharSequence(Notification.EXTRA_TEXT) ?: "").toString()
        }
        if (text.isBlank()) {
            // Some notifications only expose text via event.text.
            text = event.text.joinToString(" ").trim()
        }
        if (title.isBlank() && text.isBlank()) return
        persist(pkg, screen = "notification", title = title, text = text)
    }

    private fun scrapeWindow(event: AccessibilityEvent, pkg: String) {
        val root = rootInActiveWindow ?: return
        val screen = event.className?.toString()?.substringAfterLast('.') ?: "screen"
        val lines = LinkedHashSet<String>()
        try {
            collectText(root, lines)
        } finally {
            root.recycle()
        }
        if (lines.isEmpty()) return
        val title = lines.firstOrNull().orEmpty()
        val text = lines.joinToString("\n")
        persist(pkg, screen = screen, title = title, text = text)
    }

    private fun collectText(node: AccessibilityNodeInfo?, out: MutableSet<String>, depth: Int = 0) {
        if (node == null || depth > 40) return
        val t = node.text?.toString()?.trim()
        if (!t.isNullOrBlank() && t.length in 2..400) out.add(t)
        val cd = node.contentDescription?.toString()?.trim()
        if (!cd.isNullOrBlank() && cd.length in 2..400) out.add(cd)
        for (i in 0 until node.childCount) collectText(node.getChild(i), out, depth + 1)
    }

    private fun persist(pkg: String, screen: String, title: String, text: String) {
        val capturedAt = System.currentTimeMillis()
        // 5-minute bucket collapses event bursts while still allowing the same
        // content to be re-captured if it reappears much later.
        val bucket = capturedAt / (5 * 60_000L)
        val id = sha256("$pkg|$screen|$title|$text|$bucket")
        val raw = JSONObject()
            .put("pkg", pkg).put("screen", screen)
            .put("title", title).put("text", text)
            .put("capturedAt", capturedAt)
            .toString()
        val entity = CaptureEntity(
            id = id, pkg = pkg, screen = screen, title = title.take(500),
            text = text.take(8000), rawJson = raw, capturedAt = capturedAt,
        )
        scope.launch {
            val inserted = dao.insertIgnore(entity)
            if (inserted != -1L) SyncWorker.enqueueDebounced(applicationContext)
        }
    }

    private fun sha256(s: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        return md.digest(s.toByteArray()).joinToString("") { "%02x".format(it) }.take(40)
    }

    override fun onInterrupt() {}

    companion object {
        // Marker the activity reads via AccessibilityManager to show running state.
        @JvmStatic
        fun jsonItem(e: CaptureEntity): JSONObject = JSONObject()
            .put("id", e.id)
            .put("capturedAt", e.capturedAt)
            .put("pkg", e.pkg)
            .put("screen", e.screen)
            .put("title", e.title)
            .put("text", e.text)

        @JvmStatic
        fun jsonArray(items: List<CaptureEntity>): JSONArray {
            val arr = JSONArray()
            items.forEach { arr.put(jsonItem(it)) }
            return arr
        }
    }
}
