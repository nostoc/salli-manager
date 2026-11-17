package org.sallimanager.vault

import android.Manifest
import android.content.ComponentName
import android.content.pm.PackageManager
import android.provider.Telephony
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

class FinanceSmsModule : Module() {
  private fun context() = checkNotNull(appContext.reactContext)
  override fun definition() = ModuleDefinition {
    Name("FinanceSms")
    Events("onInboxChanged")
    OnCreate { SmsEvents.changed = { sendEvent("onInboxChanged") } }
    OnDestroy { SmsEvents.changed = null }
    AsyncFunction("statusAsync") { token: String ->
      SmsSession.require(token)
      val context = context()
      mapOf("apiVersion" to 1, "ready" to SmsSession.ready(token), "configured" to SmsInbox.configured(context), "verified" to SmsInbox.isVerified(context),
        "enabled" to SmsInbox.prefs(context).getBoolean("enabled", false), "gaps" to SmsInbox.prefs(context).getLong("gaps", 0),
        "blockedIds" to SmsInbox.blockedIds(),
        "queued" to SmsInbox.directory(context).listFiles().orEmpty().count { it.name.endsWith(".sms") })
    }
    AsyncFunction("setupAsync") { token: String -> SmsInbox.setup(context(), token) }
    AsyncFunction("verifyAsync") { token: String -> SmsInbox.verify(context(), token) }
    AsyncFunction("checkAuthorizationAsync") { token: String -> SmsInbox.checkAuthorization(context(), token) }
    AsyncFunction("queueSyntheticAsync") { token: String, delayed: Boolean ->
      check(BuildConfig.DEBUG)
      SmsSession.require(token)
      val context = context().applicationContext
      check(SmsSession.ready(token) && SmsInbox.isVerified(context))
      val capture = Runnable {
        try {
          val date = java.text.SimpleDateFormat("dd-MMM-yyyy", Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("Asia/Colombo") }.format(java.util.Date())
          val now = System.currentTimeMillis()
          SmsInbox.capture(context, "HNB", "HNB SMS Alert VC : XXXX4826 : Cedar Grocery LKR 23.75 ($date 09:15)", now, now, java.util.UUID.randomUUID().toString().toByteArray())
          SmsEvents.changed?.invoke()
        } catch (_: Exception) { SmsInbox.gap(context) }
      }
      if (delayed) android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ java.util.concurrent.Executors.newSingleThreadExecutor().apply { execute(capture); shutdown() } }, 10000)
      else capture.run()
    }
    AsyncFunction("enableAsync") { token: String, enabled: Boolean ->
      SmsSession.require(token)
      val context = context()
      if (enabled) {
        check(SmsSession.ready(token) && SmsInbox.isVerified(context))
        check(context.checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED)
        SmsHousekeeping.schedule(context)
      }
      SmsInbox.prefs(context).edit().putBoolean("enabled", enabled).commit()
      context.packageManager.setComponentEnabledSetting(ComponentName(context, BankSmsReceiver::class.java),
        if (enabled) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
    }
    AsyncFunction("drainAsync") { token: String -> SmsInbox.drain(context(), token) }
    AsyncFunction("ackAsync") { token: String, ids: List<String> -> SmsInbox.ack(context(), token, ids) }
    AsyncFunction("retryBlockedAsync") { token: String -> SmsInbox.retryBlocked(token) }
    AsyncFunction("discardBlockedAsync") { token: String, id: String -> SmsInbox.discardBlocked(context(), token, id) }
    AsyncFunction("historyAsync") { token: String, start: Double, end: Double, after: Double, highWater: Double ->
      val generation = SmsSession.require(token); val context = context()
      check(context.checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED)
      require(listOf(start, end, after, highWater).all { it.isFinite() && it >= 0 && it <= 9007199254740991.0 && it % 1.0 == 0.0 })
      require(start < end && end <= System.currentTimeMillis() + 60000)
      val max = if (highWater == 0.0) context.contentResolver.query(Telephony.Sms.Inbox.CONTENT_URI, arrayOf("_id"), null, null, "_id DESC LIMIT 1")?.use { if (it.moveToFirst()) it.getLong(0) else 0L } ?: 0L else highWater.toLong()
      val secrets = SmsSession.secrets(token)
      try {
        val rows = mutableListOf<Map<String, Any?>>()
        var cursorId = after.toLong(); var scanned = 0
        // Provider IDs paginate a fixed high-water snapshot. Bound scanned rows,
        // not only accepted messages, so unrelated inboxes cannot freeze the UI.
        context.contentResolver.query(Telephony.Sms.Inbox.CONTENT_URI, arrayOf("_id", "address", "body", "date", "date_sent"),
          "_id>? AND _id<=? AND date>=? AND date<? AND length(body)<=8192 AND address COLLATE NOCASE IN (?,?,?,?)", arrayOf(after.toLong().toString(), max.toString(), start.toLong().toString(), end.toLong().toString(), "HNB", "COMBANK", "SAMPCCTXN", "BOC"), "_id ASC LIMIT 50")?.use { cursor ->
          while (cursor.moveToNext()) {
            scanned++; cursorId = cursor.getLong(0)
            val sender = cursor.getString(1)?.trim()?.uppercase(Locale.ROOT) ?: continue
            if (sender !in SmsBoundary.senders) continue
            val raw = cursor.getString(2) ?: continue
            val text = SmsBoundary.sanitize(raw) ?: continue
            val id = SmsInbox.providerSourceKey(context, cursorId)
            rows.add(mapOf("id" to id, "sourceKey" to id, "sender" to sender, "body" to text, "receivedAt" to cursor.getLong(3),
              "sentAt" to cursor.getLong(4).takeIf { it > 0 }, "intakeAt" to System.currentTimeMillis(), "fingerprint" to SmsInbox.fingerprint(secrets.second, sender, text)))
          }
        }
        SmsSession.check(token, generation)
        mapOf("envelopes" to rows, "after" to cursorId, "highWater" to max, "done" to (scanned < 50))
      } finally { secrets.second.fill(0) }
    }
  }
}
