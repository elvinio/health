package com.elvinio.moebridge.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface CaptureDao {
    /** Insert, ignoring duplicates (same content hash) — the dedup mechanism. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIgnore(item: CaptureEntity): Long

    @Query("SELECT * FROM captures WHERE syncedAt IS NULL ORDER BY capturedAt ASC")
    suspend fun pendingUnsynced(): List<CaptureEntity>

    @Query("UPDATE captures SET syncedAt = :ts WHERE id IN (:ids)")
    suspend fun markSynced(ids: List<String>, ts: Long)

    @Query("SELECT * FROM captures ORDER BY capturedAt DESC LIMIT :limit")
    suspend fun recent(limit: Int): List<CaptureEntity>

    @Query("SELECT COUNT(*) FROM captures WHERE syncedAt IS NULL")
    suspend fun pendingCount(): Int

    @Query("SELECT COUNT(*) FROM captures")
    suspend fun total(): Int
}
