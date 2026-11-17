package org.sallimanager.vault

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import android.util.AtomicFile
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.spec.MGF1ParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/** Only ciphertext and authenticated key metadata enter no-backup storage. */
object SmsInbox {
  const val TTL = 7L * 86400000L
  private const val WRAP = "salli.sms.wrap.v1"
  private const val META = "salli.sms.metadata.v1"
  private const val VERIFICATION_VERSION = 1
  private val preparing = java.util.concurrent.atomic.AtomicBoolean(false)
  private val blocked = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
  fun blockedIds() = blocked.toList().take(50)
  fun retryBlocked(token: String) { SmsSession.require(token); blocked.clear() }
  @Synchronized fun discardBlocked(context: Context, token: String, id: String) {
    SmsSession.require(token); require(id.matches(Regex("[a-f0-9-]{36}")) && id in blocked)
    AtomicFile(File(directory(context), "$id.sms")).delete(); blocked.remove(id); gap(context)
  }
  private val random = SecureRandom()
  private val oaep = OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT)
  fun prefs(context: Context) = context.getSharedPreferences("sms-controls", Context.MODE_PRIVATE)
  fun isVerified(context: Context): Boolean {
    val state = prefs(context)
    return state.getInt("cryptoVerificationVersion", 0) == VERIFICATION_VERSION && state.getInt("authorizationVerificationVersion", 0) == VERIFICATION_VERSION && state.getBoolean("cryptoVerified", false) && state.getBoolean("authorizationVerified", false)
  }
  fun directory(context: Context) = File(context.noBackupFilesDir, "sms-inbox-v1").apply { check(isDirectory || mkdirs()) }
  private fun keyFile(context: Context) = File(context.noBackupFilesDir, "sms-key.v1")
  fun configured(context: Context) = prefs(context).getBoolean("configured", false) || keyFile(context).exists() || File(keyFile(context).path + ".bak").exists() || directory(context).listFiles().orEmpty().isNotEmpty()
  fun providerSourceKey(context: Context, id: Long): String {
    val namespace = MessageDigest.getInstance("SHA-256").digest(bundle(context).getString("public").toByteArray(Charsets.US_ASCII))
      .take(12).joinToString("") { "%02x".format(it.toInt() and 255) }
    return "provider:$namespace:$id"
  }
  private fun store() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)
  private fun bytes(value: String, max: Int): ByteArray { require(value.length <= max * 2); return Base64.decode(value, Base64.NO_WRAP).also { require(it.size <= max) } }
  private fun read(file: File, max: Int): ByteArray = AtomicFile(file).openRead().use { input ->
    val data = input.readBytesBounded(max); require(data.size <= max); data
  }
  private fun java.io.InputStream.readBytesBounded(max: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(2048)
    while (true) { val n = read(buffer); if (n < 0) break; require(output.size() + n <= max); output.write(buffer, 0, n) }
    return output.toByteArray()
  }
  private fun write(file: File, data: ByteArray) {
    val box = AtomicFile(file); val stream = box.startWrite()
    try { stream.write(data); box.finishWrite(stream) } catch (failure: Exception) { box.failWrite(stream); throw failure }
  }
  private fun wrapKey(create: Boolean): SecretKey {
    val store = store()
    if (store.containsAlias(WRAP)) return (store.getEntry(WRAP, null) as KeyStore.SecretKeyEntry).secretKey
    check(create)
    val builder = KeyGenParameterSpec.Builder(WRAP, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256).setUserAuthenticationRequired(true)
    if (Build.VERSION.SDK_INT >= 30) builder.setUserAuthenticationParameters(5, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
    else { @Suppress("DEPRECATION") builder.setUserAuthenticationValidityDurationSeconds(5) }
    return KeyGenerator.getInstance("AES", "AndroidKeyStore").apply { init(builder.build()) }.generateKey()
  }
  private fun metadataKey(create: Boolean): SecretKey {
    val store = store()
    if (store.containsAlias(META)) return (store.getEntry(META, null) as KeyStore.SecretKeyEntry).secretKey
    check(create)
    return KeyGenerator.getInstance("HmacSHA256", "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(META, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY).setDigests(KeyProperties.DIGEST_SHA256).build())
    }.generateKey()
  }
  private fun metadataMac(text: String, create: Boolean = false): ByteArray = Mac.getInstance("HmacSHA256").run { init(metadataKey(create)); doFinal(text.toByteArray(Charsets.UTF_8)) }
  private fun bundle(context: Context): JSONObject {
    val item = JSONObject(String(read(keyFile(context), 16384), Charsets.UTF_8)); require(item.getInt("v") == 1)
    val authenticated = listOf("public", "iv", "wrapped").joinToString("|") { item.getString(it) }
    check(MessageDigest.isEqual(metadataMac(authenticated), bytes(item.getString("mac"), 32)))
    return item
  }
  fun setup(context: Context, token: String) {
    check(preparing.compareAndSet(false, true))
    try { prepare(context, token) } finally { preparing.set(false) }
  }
  private fun prepare(context: Context, token: String) {
    val generation = SmsSession.require(token)
    check(!configured(context))
    check(directory(context).listFiles().orEmpty().isEmpty())
    // Initialize the authenticated cipher before RSA generation; a slow keypair
    // must not cause expensive main-thread work or stretch the authorization window.
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, wrapKey(true)) }
    val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(3072, random) }.generateKeyPair()
    val correlation = ByteArray(32).also(random::nextBytes)
    val encoded = pair.private.encoded
    val plain = ByteArray(4 + encoded.size + 32)
    java.nio.ByteBuffer.wrap(plain).putInt(encoded.size).put(encoded).put(correlation)
    try {
      val public = b64(pair.public.encoded); cipher.updateAAD(public.toByteArray(Charsets.US_ASCII))
      val item = JSONObject().put("v", 1).put("public", public).put("iv", b64(cipher.iv)).put("wrapped", b64(cipher.doFinal(plain)))
      val authenticated = listOf("public", "iv", "wrapped").joinToString("|") { item.getString(it) }
      item.put("mac", b64(metadataMac(authenticated, true)))
      SmsSession.check(token, generation)
      write(keyFile(context), item.toString().toByteArray(Charsets.UTF_8))
      SmsSession.install(token, generation, pair.private, correlation.copyOf())
      prefs(context).edit().putBoolean("configured", true).putInt("cryptoVerificationVersion", 0).putInt("authorizationVerificationVersion", 0).putBoolean("cryptoVerified", false).putBoolean("authorizationVerified", false).putBoolean("enabled", false).commit()
    } finally { encoded.fill(0); plain.fill(0); correlation.fill(0) }
  }
  @Synchronized fun unlock(context: Context): Pair<PrivateKey, ByteArray>? {
    if (!keyFile(context).exists() && !File(keyFile(context).path + ".bak").exists()) return null
    val item = bundle(context)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
      init(Cipher.DECRYPT_MODE, wrapKey(false), GCMParameterSpec(128, bytes(item.getString("iv"), 12)))
      updateAAD(item.getString("public").toByteArray(Charsets.US_ASCII))
    }
    val plain = cipher.doFinal(bytes(item.getString("wrapped"), 8192))
    try {
      val buffer = java.nio.ByteBuffer.wrap(plain); val size = buffer.int
      require(size in 1000..4096 && buffer.remaining() == size + 32)
      val encoded = ByteArray(size); buffer.get(encoded)
      val correlation = ByteArray(32); buffer.get(correlation)
      try { return Pair(KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(encoded)), correlation) }
      finally { encoded.fill(0) }
    } finally { plain.fill(0) }
  }
  private fun encrypt(context: Context, id: String, payload: ByteArray): ByteArray {
    val key = ByteArray(32).also(random::nextBytes)
    try {
      val public = bundle(context).getString("public")
      val rsa = Cipher.getInstance("RSA/ECB/OAEPPadding").apply { init(Cipher.ENCRYPT_MODE, KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(bytes(public, 1024))), oaep) }
      val nonce = ByteArray(12).also(random::nextBytes)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce)); updateAAD("salli-sms-v1:$id:$public".toByteArray(Charsets.US_ASCII)) }
      return JSONObject().put("v", 1).put("id", id).put("key", b64(rsa.doFinal(key))).put("iv", b64(cipher.iv)).put("ciphertext", b64(cipher.doFinal(payload))).toString().toByteArray(Charsets.UTF_8)
    } finally { key.fill(0) }
  }
  private fun decrypt(context: Context, id: String, data: ByteArray, privateKey: PrivateKey): ByteArray {
    require(data.size <= 32768)
    val item = JSONObject(String(data, Charsets.UTF_8)); require(item.getInt("v") == 1 && item.getString("id") == id)
    val rsa = Cipher.getInstance("RSA/ECB/OAEPPadding").apply { init(Cipher.DECRYPT_MODE, privateKey, oaep) }
    val key = rsa.doFinal(bytes(item.getString("key"), 384)); require(key.size == 32)
    try {
      val public = bundle(context).getString("public")
      return Cipher.getInstance("AES/GCM/NoPadding").run {
        init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, bytes(item.getString("iv"), 12)))
        updateAAD("salli-sms-v1:$id:$public".toByteArray(Charsets.US_ASCII)); doFinal(bytes(item.getString("ciphertext"), 20000))
      }
    } finally { key.fill(0) }
  }
  @Synchronized fun capture(context: Context, sender: String, body: String, receivedAt: Long, sentAt: Long, transport: ByteArray): Boolean {
    val text = SmsBoundary.sanitize(body) ?: return false
    if (sender !in SmsBoundary.senders) return false
    val digest = Mac.getInstance("HmacSHA256").run { init(metadataKey(false)); doFinal(transport) }.take(16).joinToString("") { "%02x".format(it.toInt() and 255) }
    val id = "${digest.take(8)}-${digest.substring(8, 12)}-${digest.substring(12, 16)}-${digest.substring(16, 20)}-${digest.substring(20)}"
    if (File(directory(context), "$id.sms").exists()) return true
    val files = directory(context).listFiles().orEmpty().toList()
    if (files.size >= 1000 || files.sumOf { it.length() } + 32768 > 16L * 1024 * 1024) { gap(context); return false }
    val payload = JSONObject().put("id", id).put("sourceKey", "live:$id").put("sender", sender).put("body", text)
      .put("receivedAt", receivedAt).put("sentAt", if (sentAt > 0) sentAt else JSONObject.NULL).put("intakeAt", System.currentTimeMillis())
    val plain = payload.toString().toByteArray(Charsets.UTF_8)
    try { write(File(directory(context), "$id.sms"), encrypt(context, id, plain)); return true }
    finally { plain.fill(0) }
  }
  fun fingerprint(secret: ByteArray, sender: String, body: String): String = Mac.getInstance("HmacSHA256").run {
    init(SecretKeySpec(secret, "HmacSHA256")); doFinal("$sender\n$body".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
  }
  @Synchronized fun drain(context: Context, token: String): List<Map<String, Any?>> {
    val generation = SmsSession.require(token); val secrets = SmsSession.secrets(token)
    housekeeping(context)
    try { return directory(context).listFiles().orEmpty().filter { it.name.matches(Regex("[a-f0-9-]{36}\\.sms")) && it.name.removeSuffix(".sms") !in blocked }.sortedBy { it.lastModified() }.take(50).mapNotNull { file ->
      try {
      val plain = decrypt(context, file.name.removeSuffix(".sms"), read(file, 32768), secrets.first)
      try {
        val item = JSONObject(String(plain, Charsets.UTF_8))
        if (item.getLong("intakeAt") <= System.currentTimeMillis() - TTL) { AtomicFile(file).delete(); gap(context); return@mapNotNull null }
        val text = checkNotNull(SmsBoundary.sanitize(item.getString("body")))
        val sender = item.getString("sender"); check(sender in SmsBoundary.senders)
        SmsSession.check(token, generation)
        mapOf("id" to item.getString("id"), "sourceKey" to item.getString("sourceKey"), "sender" to sender, "body" to text,
          "receivedAt" to item.getLong("receivedAt"), "sentAt" to item.optLong("sentAt", 0).takeIf { it > 0 }, "intakeAt" to item.getLong("intakeAt"), "fingerprint" to fingerprint(secrets.second, sender, text))
      } finally { plain.fill(0) }
      } catch (_: Exception) {
        SmsSession.check(token, generation)
        blocked.add(file.name.removeSuffix(".sms")); null
      }
    } } finally { secrets.second.fill(0) }
  }
  @Synchronized fun ack(context: Context, token: String, ids: List<String>) {
    SmsSession.require(token); require(ids.size <= 50)
    ids.forEach { id -> require(id.matches(Regex("[a-f0-9-]{36}"))); AtomicFile(File(directory(context), "$id.sms")).delete(); blocked.remove(id) }
  }
  @Synchronized fun housekeeping(context: Context) {
    val now = System.currentTimeMillis()
    directory(context).listFiles().orEmpty().filter { it.name.endsWith(".sms") && it.lastModified() <= now - TTL }.forEach { AtomicFile(it).delete(); gap(context) }
  }
  @Synchronized fun gap(context: Context) { val prefs = prefs(context); prefs.edit().putLong("gaps", (prefs.getLong("gaps", 0) + 1).coerceAtMost(1_000_000)).commit() }
  fun verify(context: Context, token: String): Map<String, Boolean> {
    val generation = SmsSession.require(token); val secrets = SmsSession.secrets(token)
    val id = UUID.randomUUID().toString(); val plain = "SYNTHETIC-INBOX-PROBE".toByteArray(Charsets.US_ASCII)
    try {
      val box = encrypt(context, id, plain)
      val recovered = decrypt(context, id, box, secrets.first)
      val roundTrip = recovered.contentEquals(plain); recovered.fill(0)
      val modified = JSONObject(String(box, Charsets.UTF_8))
      val ciphertext = bytes(modified.getString("ciphertext"), 20000)
      ciphertext[ciphertext.lastIndex] = (ciphertext.last().toInt() xor 1).toByte()
      modified.put("ciphertext", b64(ciphertext))
      val tamperRejected = try { decrypt(context, id, modified.toString().toByteArray(Charsets.UTF_8), secrets.first).fill(0); false } catch (_: javax.crypto.AEADBadTagException) { true }
      val identityBound = try { decrypt(context, UUID.randomUUID().toString(), box, secrets.first).fill(0); false } catch (_: Exception) { true }
      val wrong = KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }.generateKeyPair()
      val wrongKeyRejected = try { decrypt(context, id, box, wrong.private).fill(0); false } catch (_: Exception) { true }
      val noPlaintext = !String(box, Charsets.UTF_8).contains("SYNTHETIC-INBOX-PROBE")
      SmsSession.check(token, generation)
      val passed = roundTrip && tamperRejected && wrongKeyRejected && noPlaintext && identityBound
      prefs(context).edit().putInt("cryptoVerificationVersion", VERIFICATION_VERSION).putBoolean("cryptoVerified", passed).commit()
      return mapOf("roundTrip" to roundTrip, "tamperRejected" to tamperRejected, "wrongKeyRejected" to wrongKeyRejected, "noPlaintext" to noPlaintext, "identityBound" to identityBound)
    } finally { plain.fill(0); secrets.second.fill(0) }
  }
  @Synchronized fun checkAuthorization(context: Context, token: String): Boolean {
    val generation = SmsSession.require(token)
    val refused = try { unlock(context)?.second?.fill(0); false } catch (_: UserNotAuthenticatedException) { true }
    SmsSession.check(token, generation)
    prefs(context).edit().putInt("authorizationVerificationVersion", VERIFICATION_VERSION).putBoolean("authorizationVerified", refused).commit()
    return refused
  }
}
