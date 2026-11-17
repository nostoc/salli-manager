package org.sallimanager.vault

import org.junit.Assert.*
import org.junit.Test

class SmsBoundaryTest {
  @Test fun rejectsAuthenticationAndUnsafeEncoding() {
    listOf("OTP", "PIN", "CVV", "password", "verification code", "one-time", "OTP524109", "OneTimePassword", "ＯＴＰ", "code 524109").forEach { assertNull(SmsBoundary.sanitize("Purchase $it 524109")) }
    assertNull(SmsBoundary.sanitize("Purchase \u202e"))
    assertNull(SmsBoundary.sanitize("Purchase \ud800"))
    assertNull(SmsBoundary.sanitize("界".repeat(3000)))
  }
  @Test fun stripsIdentifiersAndPreservesExactMoneyIdempotently() {
    val text = "Purchase Card 4444 5555 6666 4826 Account 111122223333 LKR 1234567.89 phone +94701234567"
    val safe = "Purchase Card [card:4826] Account [account:3333] LKR 1234567.89 phone [redacted]"
    assertEquals(safe, SmsBoundary.sanitize(text))
    assertEquals(safe, SmsBoundary.sanitize(safe))
    assertNull(SmsBoundary.sanitize("Welcome to our bank"))
    assertNotNull(SmsBoundary.sanitize("HNB SMS Alert VC : XXXX4826 : Cedar Grocery LKR 2,375.40 (12-JUN-2026 09:15)"))
  }
  @Test fun nativeSessionRejectsForgedAndInvalidatedTokens() {
    SmsSession.invalidate()
    try { SmsSession.require("forged"); fail("Unauthenticated token was accepted") } catch (_: IllegalStateException) { }
    try { SmsSession.activate(); fail("Session activated without authentication") } catch (_: IllegalStateException) { }
  }
}
