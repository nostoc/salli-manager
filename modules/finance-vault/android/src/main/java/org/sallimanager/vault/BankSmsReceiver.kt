package org.sallimanager.vault

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Telephony
import java.io.ByteArrayOutputStream
import java.util.Locale
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.RejectedExecutionException

class BankSmsReceiver : BroadcastReceiver() {
  companion object { private val executor = ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(16)) }
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION || context.checkSelfPermission(Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) return
    if (!SmsInbox.prefs(context).getBoolean("enabled", false) || !SmsInbox.isVerified(context)) return
    val result = goAsync()
    try { executor.execute {
      try {
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        require(messages.isNotEmpty() && messages.size <= 20)
        val sender = messages[0].originatingAddress?.trim()?.uppercase(Locale.ROOT) ?: return@execute
        if (sender !in SmsBoundary.senders || messages.any { it.originatingAddress?.trim()?.uppercase(Locale.ROOT) != sender }) return@execute
        val body = StringBuilder()
        val transport = ByteArrayOutputStream()
        messages.forEach { message ->
          val part = message.messageBody ?: throw IllegalArgumentException()
          require(body.length + part.length <= 8192)
          body.append(part)
          val pdu = message.pdu; require(pdu.size <= 2048)
          transport.write(java.nio.ByteBuffer.allocate(4).putInt(pdu.size).array()); transport.write(pdu)
        }
        SmsInbox.capture(context, sender, body.toString(), System.currentTimeMillis(), messages[0].timestampMillis, transport.toByteArray())
        SmsEvents.changed?.invoke()
        SmsHousekeeping.schedule(context)
      } catch (_: Exception) { SmsInbox.gap(context) }
      finally { result.finish() }
    } } catch (_: RejectedExecutionException) { SmsInbox.gap(context); result.finish() }
  }
}

object SmsEvents { @Volatile var changed: (() -> Unit)? = null }
