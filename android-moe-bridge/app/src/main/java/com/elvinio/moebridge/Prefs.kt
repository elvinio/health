package com.elvinio.moebridge

import android.content.Context

/** Thin SharedPreferences wrapper for app config + sync bookkeeping. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("moe-bridge", Context.MODE_PRIVATE)

    /** Comma-separated package names to capture from (when captureAll is off). */
    var targetPackages: String
        get() = sp.getString(KEY_TARGET_PKGS, DEFAULT_TARGET) ?: DEFAULT_TARGET
        set(v) = sp.edit().putString(KEY_TARGET_PKGS, v).apply()

    /** Debug: capture events from ALL apps (used to discover the real MOE package). */
    var captureAll: Boolean
        get() = sp.getBoolean(KEY_CAPTURE_ALL, false)
        set(v) = sp.edit().putBoolean(KEY_CAPTURE_ALL, v).apply()

    /** Cached Drive file id for moe-inbox-incoming.json (null until first upload). */
    var driveFileId: String?
        get() = sp.getString(KEY_DRIVE_FILE_ID, null)
        set(v) = sp.edit().putString(KEY_DRIVE_FILE_ID, v).apply()

    /** Email of the signed-in Google account, for display. */
    var account: String?
        get() = sp.getString(KEY_ACCOUNT, null)
        set(v) = sp.edit().putString(KEY_ACCOUNT, v).apply()

    /** Epoch millis of the last successful Drive sync (0 = never). */
    var lastSync: Long
        get() = sp.getLong(KEY_LAST_SYNC, 0)
        set(v) = sp.edit().putLong(KEY_LAST_SYNC, v).apply()

    /** Returns the set of packages to capture, or null meaning "all". */
    fun packageFilter(): Set<String>? {
        if (captureAll) return null
        return targetPackages.split(",")
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .toSet()
            .ifEmpty { null }
    }

    companion object {
        // Best-known MOE Parents Gateway package; confirm on-device via captureAll.
        const val DEFAULT_TARGET = "sg.gov.tech.parentsgateway"
        private const val KEY_TARGET_PKGS = "target_pkgs"
        private const val KEY_CAPTURE_ALL = "capture_all"
        private const val KEY_DRIVE_FILE_ID = "drive_file_id"
        private const val KEY_ACCOUNT = "account"
        private const val KEY_LAST_SYNC = "last_sync"
    }
}
