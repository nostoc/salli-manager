# Security requirements and initial threat model

Status: requirements and initial threat model approved on 17 November 2026. These requirements are not a security audit or a claim that all controls are implemented. See `ARCHITECTURE.md` for the system design and `DEVELOPMENT.md` for implementation evidence and remaining verification gates.

## Security requirements

1. All transaction parsing, categorization, matching, reports and financial calculations run locally. No backend, registration, mandatory cloud service, cloud AI, analytics, ads or tracking SDKs.
2. The offline release must have no INTERNET permission, remote updates, remote fonts/assets or runtime network dependency. Development networking is confined to development builds. Inspect the final merged manifest and APK rather than relying on application configuration alone.
3. Never persist banking credentials, full card numbers, PINs, CVVs or OTPs, including in encrypted queues, source files retained by the app, backups, logs, crash traces or audit history. Persist only minimum masked instrument identifiers; last four digits are still sensitive and not globally unique.
4. Encrypt sensitive database content with SQLCipher and protect its random key with Android Keystore. Authenticate access using biometrics or device credentials. Protect external sensitive files and inbox envelopes separately with authenticated encryption.
5. Treat SMS, imported documents, metadata, backup archives and native bridge payloads as untrusted input. Authentication of the app user does not authenticate the bank sender or statement content.
6. Request only necessary permissions at the point of use; explain scope and revocation. Manual entry, account management and file import must work without SMS access.
7. No real customer/financial records in source code, tests, CI artifacts or logs. Supplied anonymized messages are context, not automatically safe public fixtures. Create independently synthetic test records and review metadata/content before publication.
8. Keep dependencies maintained, minimal and compatible; review licenses, transitive packages, native binaries and security advisories. Do not implement custom cryptographic primitives.
9. Provide automatic locking, amount hiding, configurable screenshot protection, private notifications, complete local deletion and secure, portable encrypted backup/restore.

## Assets and trust boundaries

Current development controls: SQLCipher verified before any schema access; authenticated Keystore AES-GCM key envelope in no-backup storage; isolated keyed connection without Expo database inspection; protected routes and transient cache clearing; serialized transactions rolled back on interrupted sessions; bound SQL parameters and validated financial reads. The owner confirmed the locked screen and authenticated unlock in the installed native app on one API 34 device; the full negative-key/cancellation probe suite is still pending. Full session/workflow, invalidation/recovery, other-device and offline-release checks remain open in `DEVELOPMENT.md`. These controls do not constitute a security audit or production-release approval.

The Keystore key permits strong biometric/device credential authorization for five seconds; the application still requests a fresh prompt per unlock and enforces its own session boundary. The database key transiently crosses Expo SQLite's JS/native boundary, and JavaScript strings cannot guarantee memory zeroization. It is not stored in Zustand, navigation, preferences, files or logs. No financial content is registered with Expo SQLite devtools. Backup XML excludes standard legacy/cloud/device-transfer domains, and allowBackup is false; actual vendor and newer cross-platform transfer behavior still needs verification. See [Android backup rules](https://developer.android.com/identity/data/autobackup).

Assets include account identities, transactions, balances, budgets, merchants, dates, notes, receipts, statements, savings plans, source metadata, categorization rules, encrypted backups, database keys and signing keys. Source identifiers/fingerprints and financial filenames can also reveal private information.

Trust boundaries:

- Android SMS provider/system broadcast into the Kotlin receiver; sender/content are untrusted even when delivered by Android.
- Native encrypted inbox into the TypeScript parser and native module bridge.
- Domain use cases into the SQLCipher connection and encrypted file store.
- User authentication into Keystore key authorization; an unlocked screen alone is insufficient evidence.
- Document picker/import parser into staged records; encrypted or password-protected input is still hostile input.
- Private data into notification, screenshot, clipboard, export/share, system backup and CI/logging surfaces.
- Developer dependency sources and CI into signed distribution artifacts.

Assumptions: an uncompromised Android OS enforces sandbox/Keystore access and the user controls their device credential. Hardware-backed keys are preferred when available, but are not guaranteed on every device. Root, malicious OS/firmware, an instrumented unlocked process and coercion are outside the protection guarantee. The app does not verify bank authenticity, initiate payments or provide authoritative bank balances. Offline SMS records may be incomplete or spoofed.

## Threats and planned mitigations

| Threat | Entry or impact | Planned control | Residual risk / verification |
| --- | --- | --- | --- |
| Lost/stolen locked phone | Financial database and files extracted | SQLCipher, Keystore-protected key, authenticated unlock, encrypted attachments/inbox, auto-lock | Compromised OS may use keys; inspect copied files and verify wrong-key rejection on native builds. |
| Someone using an unlocked phone | Read history or export data | Session timeout, lifecycle lock, reauthentication for export/backup/destructive restore, hide amounts | Shoulder surfing remains possible; test all routes and deep links while locked. |
| Plaintext database accidentally created | Missing native SQLCipher or misconfigured connection | Check cipher availability before schema/migrations; fail closed; no plaintext fallback | A PRAGMA alone is not proof. Verify the actual release file with ordinary SQLite and correct/wrong keys. |
| Key theft or invalidation | Logs/config leaks, biometric changes or reinstall | Platform random key, Keystore wrapping, short key lifetime, no logging; explicit recovery state | JS memory cannot promise zeroization; native handoff is an open gate. Never replace an inaccessible key and overwrite data. |
| Background worker bypasses authentication | Worker opens ledger while locked | Separate encrypted inbox; no worker ledger access; financial processing after unlock | Deferred updates/alerts while locked; prove capture/decrypt separation or expose a limited fallback. |
| Spoofed/malformed SMS | Fake expenses, OTP retention, parser denial of service | System-only delivery validation, bounded multipart assembly, sensitive-content rejection, strict parsing, review for ambiguity | Sender strings are spoofable; no bank-authentication guarantee. Fuzz/test malformed and long messages. |
| Duplicate or inconsistent imports | Replayed work or overlapping statements inflate spending | Source idempotency, unique IDs, transactional matching, review ambiguity and provenance | Equal purchases can be genuine; test replay, overlap, crash after commit and manual unmerge. |
| Corrupt financial calculations | Wrong budgets, transfers counted as expenses | Safe integer arithmetic, currency separation, centrally tested signs/date periods, validated splits | Product policy choices affect results; display uncertainty and preserve user corrections. |
| Hostile PDF/CSV or backup | Path traversal, archive bombs, formula injection, parser exploit | Size/page/row/decompression/time limits, allowed formats, offline parser, no scripts/URLs; parameterized SQL; validate schema and paths | Native parser vulnerabilities remain possible; benchmark and sandbox where practical. |
| Sensitive plaintext files escape | Receipts, PDF passwords, caches and temp files | Private app storage, authenticated file encryption, minimum retention, bounded temporary processing, cleanup on failure/startup | Provider originals remain outside app control; fail import or document limitations if safe temp handling cannot be achieved. |
| Logs, screenshots or notifications leak data | Android logs/recents, notification history, debug tools | Nonsensitive error codes, no console content, mask notifications by default, screenshot/recents protection, production devtools disabled | User can opt into screenshots or explicit exports; external captures and privileged tools remain possible. |
| Automatic backup exposes data or restores unusable ciphertext | Android/cloud/device transfer | Exclude financial DB/files/inbox and key preferences from OS backup/device transfer; use explicit encrypted export | Vendor behavior differs; test backup and transfer rules on supported Android versions. |
| Backup theft/tampering | Offline guessing, injected records or destructive restore | Passphrase-derived key using maintained KDF, authenticated archive, bounded validation, new destination keys, staged atomic restore | Weak/lost passphrases cannot be recovered by a server; test wrong password and tamper without modifying live data. |
| Malicious dependency/build pipeline | Exfiltration or substituted APK | Lockfile, minimal dependencies, license/advisory scans, pinned CI actions, restricted CI permissions, signed release provenance | Scanning is incomplete; review changes and investigate reproducibility differences. |
| Deletion incomplete | Copies in queues, sidecars, backups or audit history | Stop workers, close DB, delete private data/aliases, clear notifications and caches, remove references | Flash wear leveling prevents guaranteed physical overwrite; exported/provider/OS copies need separate user deletion. |

## Key lifecycle and app sessions

- Setup generates a strong random ledger key using a platform CSPRNG. Store only its Keystore-protected representation. Never derive this key from a card suffix or device identifier, embed it in code, or reuse it as a backup password.
- Candidate APIs are Expo SecureStore for small secrets and a native Keystore boundary for authentication and inbox needs. A separate biometric prompt does not automatically authorize a Keystore cryptographic operation. Prove device-credential fallback, authentication duration and cancellation semantics together before accepting the design. [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [Android Keystore](https://developer.android.com/privacy-and-security/keystore).
- Require a secure device credential for protected setup; biometrics are optional convenience. If no credential is enrolled, explain how to set one and do not create an unprotected financial store. No application-managed banking PIN or weak bypass.
- Unlock authorizes key access, opens the verified encrypted database and admits access to protected screens. Cancelled/failed authentication keeps it closed. Lock must block new operations, settle or roll back in-flight work, close connections, release key references, clear sensitive Zustand/query caches and conceal app previews.
- Proposed default: lock when backgrounded and after a short configurable inactivity period. Test pause/resume races, screen lock, process restart, external document-picker flows and deep links. Do not unlock merely because a persisted boolean says the user was authenticated.
- For the locked SMS inbox, evaluate per-envelope authenticated encryption and public-key wrapping, with Keystore-protected authenticated private-key decryption. Reject prohibited content before encryption. Keep ciphertext filenames/WorkManager data nonsensitive; limit queue size/age, clean up stale entries and show capture gaps. No ledger key in worker storage.
- Biometric enrollment changes, removal of the device credential, key invalidation and reinstall may make data inaccessible. Provide a clear recovery screen with encrypted-backup restore or deliberate reset; do not silently bypass authentication or replace keys. Migration/rotation must preserve recoverability and be interrupt-safe.
- Device Keystore keys are not portable backups. Restore requires a separate encrypted archive with an independently protected portable key, followed by new device keys. Full-format crypto/KDF decisions are open until the backup phase.

## Input minimization and file policy

Receiver code sees SMS transiently because Android delivers it, but must reject OTP/authentication messages and redact prohibited identifiers before any durable write. Restrict processing to candidate financial templates. A rejection should retain only an aggregate/code if needed, not rejected text or arbitrary excerpts. Do not try to collect all personal SMS for future analysis.

Only bounded, sanitized financial envelopes may enter the encrypted queue. After parsing, retain structured observations and minimal provenance; delete the text when processing is acknowledged, or when its bounded retention expires. Unknown financial templates may be reviewed only if their content passes the same minimization rules. Consent to historical import is separate from live detection and must support a date range, cancellation and revocation.

Imports can contain full card/account numbers, OTP-like text and unrelated customer data. Extract in memory where possible, sanitize before persistence and never retain an original document containing prohibited fields, even encrypted. Receipt/statement retention must satisfy this rule. PDF passwords must not be persisted, logged or put in worker payloads. Parsing failures must not include the input excerpt in an exception message.

Use prepared statements/bound values for untrusted fields. If SQLCipher key setup requires a PRAGMA literal, use only the validated generated key format through a dedicated helper; never interpolate user text. Do not auto-open merchant links or run imported expressions. Guard CSV exports against spreadsheet formula injection for all text cells; preserve actual numeric amounts separately.

## Permissions and runtime surfaces

| Permission / surface | Rule |
| --- | --- |
| RECEIVE_SMS | Request only when live detection is enabled, with disclosure. It is hard-restricted and installer-dependent. |
| READ_SMS | Separate optional historical import consent; not required merely to receive future SMS. |
| USE_BIOMETRIC | Authentication only; device credential fallback must be verified. |
| POST_NOTIFICATIONS | Request when reminders are enabled on Android versions requiring it; denial preserves in-app reminders. |
| INTERNET | Absent from offline release, including library-added permissions. Disable OTA/remote runtime features. |
| Storage | Use the system document picker and scoped URIs; no MANAGE_EXTERNAL_STORAGE or blanket media access. Release URI grants when no longer needed. |
| Other permissions | No SEND_SMS, contacts, phone state, location, camera, exact alarms or foreground service by default. Review a concrete need before any addition. WorkManager infrastructure permissions must be justified from its merged manifest. |

Protect exported Android components, validate broadcast actions/permissions and use safe explicit pending intents where needed. Do not expose the inbox or ledger through a content provider. Keep data out of clipboard by default. Notifications contain generic text until an explicit user preference allows more detail. Screenshot protection should default on and remain configurable; document its limits.

Google Play lists SMS-based money management as an exception requiring review; it is not blanket authorization. Android installer allowlisting is a separate condition. A denied permission must not prompt the app to seek broader unrelated access. [Play SMS policy](https://support.google.com/googleplay/android-developer/answer/10208820), [Android RECEIVE_SMS](https://developer.android.com/reference/android/Manifest.permission#RECEIVE_SMS).

## Phase 4 implementation boundary

The new Kotlin capture implementation is unverified on Android until PHASE4_TESTING.md passes. The receiver defaults disabled. Enabling capture requires native correct/wrong-key and tamper probes plus Keystore rejection after the SMS wrapping key's five-second authorization window, followed by RECEIVE_SMS consent. READ_SMS is requested separately for history. Manual finance needs neither.

RSA-3072 OAEP explicitly uses SHA-256/MGF1-SHA-256; fresh AES-256-GCM keys encrypt each envelope. A separate authenticated Keystore AES key wraps the software RSA private key and correlation secret. Public/wrapped metadata is authenticated with a non-auth Keystore HMAC key, which cannot decrypt messages. Native session handles activate after database validation, are generation-bound and are invalidated on lock/background. Private RSA material never enters JS. [Android crypto guidance](https://developer.android.com/privacy-and-security/cryptography), [Keystore](https://developer.android.com/privacy-and-security/keystore).

The software RSA private key is not a non-exportable hardware RSA key; its Keystore wrapping key is non-exportable. Lock releases native references and wipes owned secret arrays, while in-flight crypto/provider objects can retain references until completion/GC. Do not claim physical memory zeroization. The transient JS ledger-key limitation still applies.

Known senders remain untrusted. Protected broadcasts require BROADCAST_SMS, matching action and explicit opt-in. Sanitization precedes persistence; JS revalidates decrypted inputs. OTPs/credentials are discarded and full identifier patterns reduced/redacted. The no-backup queue uses opaque keyed transport identities, bounded ciphertext and visible rejected/expired gap counts. Similar financial fields only suggest duplicates for review.

WorkManager receives empty data and a generic work name. WAKE_LOCK finishes durable ciphertext housekeeping; RECEIVE_BOOT_COMPLETED reschedules it after reboot. Neither permits financial decryption. ACCESS_NETWORK_STATE and foreground-service permissions/service are removed; there are no network constraints. The updated release manifest guard still rejects INTERNET, but its new merged-manifest pass remains pending.

Source text expires seven days after first intake, is removed on resolution and is not renewed by retries. Resolved replay text is not re-retained in SQLite. Structured observations/corrections remain encrypted. Device shutdown, deferred scheduling and wall-clock rollback can delay physical cleanup; no trusted offline wall clock is assumed. Capture before the first device unlock and after force-stop is not guaranteed.

Unavailable/tampered SMS keys disable capture on detection; existing inbox keys are never replaced automatically. Manual finance can remain available. Debug-only fixed synthetic capture helpers need authenticated verified sessions and reject release calls. Their delayed capture is an in-process test, not durable background delivery. Full erasure/portable recovery remains later work; do not recommend data clearing/uninstall as repair.

## Backup deletion and vulnerability reporting

Configure OS backup and device-transfer exclusions for all financial artifacts, including database sidecars, keys, queues and files. Expo's SecureStore exclusions alone do not cover the rest of the application. [SecureStore backup behavior](https://docs.expo.dev/versions/latest/sdk/securestore/).

Explicit full deletion requires a clear confirmation, cancellation of workers/notifications, closure of stores, deletion of database/sidecars, files, inbox and Keystore aliases, and clearing of in-memory/history state. Ordinary transaction deletion may retain a minimal encrypted change record for history; provide an explicit erasure path. Full deletion must remove that history too. Do not promise physical overwrite on flash storage. Explain that the app cannot erase the SMS provider, original imported files or previously exported/shared backups.

Keep signing keys outside the repository and untrusted PR jobs. Add contribution/security reporting instructions before public release; use repository private vulnerability reporting if enabled, with a verified route. No reporting address is configured yet, so do not invent one. Reports must omit financial data and keys. Publish fixes and advisories without exposing user records.

## Required evidence before release

- Native correct/wrong/missing key and cipher tests, file/sidecar inspection, lock/deep-link/cancellation tests and key-invalidation recovery tests.
- Parser malformed/OTP/full-number tests; inspect logs, inbox and WorkManager storage for prohibited content.
- Idempotent imports, concurrent/replayed events, transactional rollback, overflow and financial/date-boundary tests.
- Permission denial/revocation, Doze/process death/reboot, queue limits and recovery; do not promise receipt during force-stop.
- Tampered/wrong-password/oversized backup tests and interrupt-safe restore/migration/deletion tests.
- Release-manifest inspection, production logging/devtools review and airplane-mode cold-start workflows with bundled assets and no development server.
- Dependency/license/advisory review and signed artifact verification. Record remaining risks and device coverage; passing Jest alone does not establish these properties.
