package com.elvinio.moebridge

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Uploads pending captures to Drive. Triggered debounced on capture + periodically. */
class SyncWorker(appContext: Context, params: WorkerParameters) :
    CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        return try {
            DriveUploader.sync(applicationContext)
            Result.success()
        } catch (e: DriveUploader.NotSignedIn) {
            // Nothing we can do until the user signs in; don't keep retrying.
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val DEBOUNCED = "moe-sync-debounced"
        private const val PERIODIC = "moe-sync-periodic"
        private const val NOW = "moe-sync-now"

        private fun netConstraints() = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED).build()

        /** Coalesce capture bursts into one upload ~15s later. */
        fun enqueueDebounced(context: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(netConstraints())
                .setInitialDelay(15, TimeUnit.SECONDS)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(DEBOUNCED, ExistingWorkPolicy.KEEP, req)
        }

        /** User-initiated immediate sync (Sync now button). */
        fun enqueueNow(context: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(netConstraints())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, req)
        }

        /** Safety net so captures still drain even if the debounced job was missed. */
        fun ensurePeriodic(context: Context) {
            val req = PeriodicWorkRequestBuilder<SyncWorker>(1, TimeUnit.HOURS)
                .setConstraints(netConstraints())
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
        }
    }
}
