package com.elvinio.moebridge.db

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * One captured MOE item. [id] is a content hash (pkg + screen + normalized text +
 * coarse timestamp) so the accessibility event bursts dedupe naturally via the PK.
 * [syncedAt] is null until the row has been uploaded to Drive.
 */
@Entity(tableName = "captures")
data class CaptureEntity(
    @PrimaryKey val id: String,
    val pkg: String,
    val screen: String,
    val title: String,
    val text: String,
    val rawJson: String,
    val capturedAt: Long,
    val syncedAt: Long? = null,
)
