package org.sallimanager.vault

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import android.util.AtomicFile
import android.view.WindowManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Small Android-only security boundary. No banking secrets and no logging. */
class FinanceVaultModule : Module() {
  private val alias = "salli.ledger.wrap.v1"
  private val requestCode = 41821
  private var pending: Promise? = null
  private var cancellation: CancellationSignal? = null
  private val aad = "salli-ledger-key-v1".toByteArray(Charsets.US_ASCII)

  override fun definition() = ModuleDefinition {
    Name("FinanceVault")
    Events("onLock")
    Function("newId") { java.util.UUID.randomUUID().toString() }

    OnActivityEntersForeground {
      SmsSession.foreground()
      // Expo can replay foreground state on the JS thread during module loading.
      // Window mutations must always run on Android's UI thread.
      val activity = appContext.currentActivity
      activity?.runOnUiThread {
        if (!activity.isDestroyed) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
    }
    OnActivityEntersBackground { SmsSession.background(); sendEvent("onLock") }
    OnUserLeavesActivity { cancelAuthentication() }
    OnActivityDestroys { cancelAuthentication() }
    OnDestroy { cancelAuthentication() }

    AsyncFunction("unlockAsync") { credentialOnly: Boolean, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null || pending != null) {
        promise.reject("VAULT_BUSY", "Authentication is unavailable.", null)
      } else {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val keyguard = activity.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        if (!keyguard.isDeviceSecure) {
          promise.reject("DEVICE_NOT_SECURE", "Set a secure Android screen lock first.", null)
        } else {
          pending = promise
          try {
            if (Build.VERSION.SDK_INT >= 30) {
              val signal = CancellationSignal()
              cancellation = signal
              val allowed = if (credentialOnly) BiometricManager.Authenticators.DEVICE_CREDENTIAL
                else BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
              BiometricPrompt.Builder(activity)
                .setTitle("Unlock Salli Manager")
                .setSubtitle("Authorize access to local encrypted data")
                .setAllowedAuthenticators(allowed)
                .build().authenticate(signal, activity.mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
                  override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { finishUnlock(promise) }
                  override fun onAuthenticationError(code: Int, message: CharSequence) { rejectPending(promise, "AUTH_CANCELLED") }
                })
            } else {
              @Suppress("DEPRECATION")
              val intent = keyguard.createConfirmDeviceCredentialIntent("Unlock Salli Manager", "Authorize local encrypted data access")
              if (intent == null) rejectPending(promise, "AUTH_UNAVAILABLE")
              else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NO_USER_ACTION)
                @Suppress("DEPRECATION")
                activity.startActivityForResult(intent, requestCode)
              }
            }
          } catch (_: Exception) { rejectPending(promise, "AUTH_UNAVAILABLE") }
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("cancelAsync") { cancelAuthentication() }.runOnQueue(Queues.MAIN)
    AsyncFunction("activateSessionAsync") { SmsSession.activate() }

    AsyncFunction("inspectProbeAsync") {
      val context = requireNotNull(appContext.reactContext)
      val file = File(context.filesDir, "SQLite/security-probe.db")
      require(file.isFile)
      val header = ByteArray(16)
      file.inputStream().use { require(it.read(header) == 16) }
      var ordinarySQLiteRejected = false
      try {
        val plain = android.database.sqlite.SQLiteDatabase.openDatabase(file.path, null,
          android.database.sqlite.SQLiteDatabase.OPEN_READONLY or android.database.sqlite.SQLiteDatabase.NO_LOCALIZED_COLLATORS,
          android.database.DatabaseErrorHandler { _ -> /* Never delete the encrypted probe as "corrupt" plaintext. */ })
        try { plain.rawQuery("SELECT count(*) FROM sqlite_master", null).use { it.moveToFirst() } }
        finally { plain.close() }
      } catch (_: android.database.sqlite.SQLiteException) { ordinarySQLiteRejected = true }
      mapOf("plaintextHeader" to header.contentEquals("SQLite format 3\u0000".toByteArray(Charsets.US_ASCII)),
        "ordinarySQLiteRejected" to ordinarySQLiteRejected)
    }

    AsyncFunction("checkAuthorizationAsync") {
      val context = requireNotNull(appContext.reactContext)
      val box = AtomicFile(File(context.noBackupFilesDir, "ledger-key.v1"))
      val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      val key = (store.getEntry(alias, null) as KeyStore.SecretKeyEntry).secretKey
      try { decrypt(box, key).fill(0); false }
      catch (_: UserNotAuthenticatedException) { true }
    }

    OnActivityResult { _, result ->
      if (result.requestCode == requestCode) {
        val promise = pending
        if (promise != null) {
          if (result.resultCode == Activity.RESULT_OK) finishUnlock(promise)
          else rejectPending(promise, "AUTH_CANCELLED")
        }
      }
    }
  }

  private fun rejectPending(promise: Promise, code: String) {
    if (pending !== promise) return
    pending = null
    cancellation = null
    promise.reject(code, "The local vault remains locked.", null)
  }

  private fun cancelAuthentication() {
    SmsSession.invalidate()
    val promise = pending
    val signal = cancellation
    pending = null
    cancellation = null
    signal?.cancel()
    promise?.reject("AUTH_CANCELLED", "The local vault remains locked.", null)
  }

  private fun finishUnlock(promise: Promise) {
    if (pending !== promise) return
    try {
      val context = requireNotNull(appContext.reactContext)
      val box = AtomicFile(File(context.noBackupFilesDir, "ledger-key.v1"))
      val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      val exists = box.baseFile.exists() || File(box.baseFile.path + ".bak").exists()
      // Never replace an unavailable wrapping key for existing ciphertext.
      if (exists && !keyStore.containsAlias(alias)) throw IllegalStateException()
      val wrappingKey = if (keyStore.containsAlias(alias)) {
        (keyStore.getEntry(alias, null) as KeyStore.SecretKeyEntry).secretKey
      } else {
        val builder = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setUserAuthenticationRequired(true)
        if (Build.VERSION.SDK_INT >= 30) {
          builder.setUserAuthenticationParameters(5, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
        } else {
          @Suppress("DEPRECATION")
          builder.setUserAuthenticationValidityDurationSeconds(5)
        }
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(builder.build()) }.generateKey()
      }
      val raw = if (exists) decrypt(box, wrappingKey) else {
        // An existing ledger without its key envelope is a recovery state, not setup.
        if (File(context.filesDir, "SQLite/ledger.db").exists()) throw IllegalStateException()
        val fresh = ByteArray(32).also { SecureRandom().nextBytes(it) }
        try {
          val cipher = Cipher.getInstance("AES/GCM/NoPadding")
          cipher.init(Cipher.ENCRYPT_MODE, wrappingKey)
          cipher.updateAAD(aad)
          val encrypted = cipher.doFinal(fresh)
          val stream = box.startWrite()
          try {
            stream.write(byteArrayOf(1)); stream.write(cipher.iv); stream.write(encrypted)
            box.finishWrite(stream)
          } catch (failure: Exception) { box.failWrite(stream); throw failure }
          fresh
        } catch (failure: Exception) { fresh.fill(0); throw failure }
      }
      try {
        require(raw.size == 32)
        // expo-sqlite requires a key at its JS/native boundary. It is never
        // persisted or logged in JS; JS strings cannot promise zeroization.
        val hex = raw.joinToString("") { "%02x".format(it.toInt() and 255) }
        SmsSession.authenticated(context)
        pending = null
        cancellation = null
        promise.resolve(hex)
      } finally { raw.fill(0) }
    } catch (_: Exception) { rejectPending(promise, "VAULT_UNAVAILABLE") }
  }

  private fun decrypt(box: AtomicFile, key: SecretKey): ByteArray {
    // Bounded read, including recovery of an interrupted AtomicFile write.
    val buffer = ByteArray(62)
    var count = 0
    box.openRead().use { stream ->
      while (count < buffer.size) {
        val read = stream.read(buffer, count, buffer.size - count)
        if (read < 0) break
        count += read
      }
    }
    require(count == 61)
    val bytes = buffer.copyOf(count)
    require(bytes.size == 61 && bytes[0].toInt() == 1)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
    cipher.updateAAD(aad)
    return cipher.doFinal(bytes.copyOfRange(13, bytes.size))
  }
}
