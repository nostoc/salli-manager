package org.sallimanager.vault

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** No body, amount, key, sender, account ID or ledger access in WorkManager. */
class SmsHousekeeping(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
  override fun doWork(): Result = try { SmsInbox.housekeeping(applicationContext); Result.success() }
    catch (_: Exception) { if (runAttemptCount < 3) Result.retry() else Result.failure() }
  companion object {
    fun schedule(context: Context) {
      WorkManager.getInstance(context).enqueueUniquePeriodicWork("sms-ciphertext-housekeeping-v1", ExistingPeriodicWorkPolicy.KEEP,
        PeriodicWorkRequestBuilder<SmsHousekeeping>(12, TimeUnit.HOURS).build())
    }
  }
}
