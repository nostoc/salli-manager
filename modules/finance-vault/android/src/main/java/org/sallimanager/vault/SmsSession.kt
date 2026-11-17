package org.sallimanager.vault

import android.content.Context
import java.security.PrivateKey
import java.util.UUID

/** Process-local authorization, independent of JavaScript UI state. */
object SmsSession {
  private var generation = 0L
  private var pending = false
  private var token: String? = null
  private var privateKey: PrivateKey? = null
  private var correlation: ByteArray? = null
  private var foreground = false
  @Synchronized fun foreground() { foreground = true }
  @Synchronized fun invalidate() {
    generation++; pending = false; token = null; privateKey = null
    correlation?.fill(0); correlation = null
  }
  @Synchronized fun background() { foreground = false; invalidate() }
  fun authenticated(context: Context) {
    val expected = synchronized(this) { check(foreground); invalidate(); pending = true; generation }
    // A damaged SMS key must never replace data or prevent manual ledger access.
    val unwrapped = try { SmsInbox.unlock(context) } catch (_: Exception) {
      SmsInbox.prefs(context).edit().putBoolean("enabled", false).commit(); null
    }
    synchronized(this) {
      if (expected == generation && pending && foreground) { privateKey = unwrapped?.first; correlation = unwrapped?.second }
      else unwrapped?.second?.fill(0)
    }
  }
  @Synchronized fun activate(): String {
    check(pending && foreground); pending = false
    return UUID.randomUUID().toString().also { token = it }
  }
  @Synchronized fun require(token: String): Long { check(foreground && this.token == token); return generation }
  @Synchronized fun check(token: String, expected: Long) { check(require(token) == expected) }
  @Synchronized fun install(token: String, expected: Long, key: PrivateKey, hmac: ByteArray) {
    check(token, expected); privateKey = key; correlation?.fill(0); correlation = hmac
  }
  @Synchronized fun secrets(token: String): Pair<PrivateKey, ByteArray> {
    require(token); return Pair(checkNotNull(privateKey), checkNotNull(correlation).copyOf())
  }
  @Synchronized fun ready(token: String): Boolean { require(token); return privateKey != null && correlation != null }
}
