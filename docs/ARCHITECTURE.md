# Initial architecture

Status: approved by the user on 17 November 2026. This is a design, not an implemented system. Approval authorizes incremental implementation; technical uncertainties still require the documented verification gates. Commits and pushes require separate approval.

## System boundary and stack

Implementation update: the owner accepted Phase 3 functional workflows. Phase 4 adds canonical transaction lifecycle/provenance, schema v2, four parser modules, review/history repositories and protected screens. `FinanceSmsModule` shares the existing local `finance-vault` Android library and native session with `FinanceVaultModule`; this avoids a circular native-module dependency. SMS encryption, receiver and WorkManager code require a native rebuild and device acceptance. See `DEVELOPMENT.md`, `PHASE4_PLAN.md` and `PHASE4_TESTING.md`; the rest of this document retains the complete product architecture.

One Android app owns local data and processing. There is no backend, registration, remote inference, telemetry or mandatory cloud service. Releases bundle all application code and assets, omit INTERNET permission and disable remote updates. Development builds may use Metro; build-time downloads are distinct from offline runtime operation.

Use React Native, strict TypeScript, Expo Router, NativeWind and Zustand. Use `expo-sqlite` compiled with SQLCipher, Android Keystore for key protection, and biometric/device authentication. Implement SMS capture and WorkManager coordination in a local Kotlin Expo module. Use Jest for TypeScript behavior, Android native tests for platform behavior and GitHub Actions for CI.

## Module organization

Target layout; create folders as their features arrive:

```text
src/app/                    Expo Router routes and layouts only
src/features/
  accounts/                 Accounts, opening balances, card settings
  transactions/             Ledger, transfers, splits, categorization
  sms/                      Parser registry, normalized candidates, review
  budgets/                  Periods, utilization, rollover
  statements/               Import adapters, matching, reconciliation
  reports/                  Aggregates and report presentation
  reminders/                Bills, subscriptions, local notifications
  planning/                 Savings goals and forecasts
  data-transfer/            Exports, encrypted backup and restore
  settings/                 Privacy, locale, appearance, accessibility
src/core/
  money/                    Integer arithmetic and currency metadata
  dates/                    Explicit date, zone and period rules
  database/                 Encrypted connection, migrations, transactions
  security/                 Session and native key access boundary
src/ui/                     Shared accessible UI primitives
modules/finance-vault/       Kotlin vault/SMS Expo modules, session, inbox, WorkManager
tests/fixtures/              Independently synthetic, reviewed inputs
```

Within each feature, add domain functions, use cases, repositories and UI files as needed. Do not create empty layers or a generic framework. Routes call feature use cases; use cases call focused repositories; SQL stays in persistence code. Pure financial functions and bank parsers import neither React nor Android APIs. Cross-feature calls use explicit functions/types, not access to another feature's store internals.

SQLite is the durable source of truth. Zustand holds transient selections, filters and session state; clear sensitive caches on lock. Do not persist financial stores to AsyncStorage or expose them through development tools. Navigation parameters contain opaque local IDs, never amounts, keys or SMS text. The authentication gate protects deep links and restored navigation as well as initial startup.

## Initial data model

Use stable local IDs, versioned schema migrations, foreign keys, uniqueness constraints and explicit database transactions. Do not introduce an ORM initially. Suggested entities:

| Entity | Responsibility |
| --- | --- |
| Account | Bank/cash/card type, currency, name, archive state, masked identifier |
| CardProfile | Account reference, credit limit, statement closing/due rules |
| Transaction | Economic event type, lifecycle status, dates, provenance links |
| Posting | Account, positive minor-unit amount, currency and debit/credit direction |
| Split | Category allocation; sum equals its expense/income amount |
| Category, MerchantRule, Tag | Local categorization and user preferences |
| SourceObservation | Sanitized source identity, parsed fields, precision, parser version and transaction link |
| ImportBatch, ReviewItem | Retry state, ambiguity, validation issues and user decisions |
| BudgetDefinition, BudgetPeriod | Scope, currency, period rule, immutable period boundaries/allowances |
| Statement, StatementRow | Account, currency, period, totals and row matching state |
| SettlementAllocation | Transfer allocation to statements; never another expense |
| ChangeRecord | Minimal encrypted history of edits, merges and deletions |
| Attachment | Encrypted private file reference and bounded metadata |
| Recurrence, Obligation, Goal | Later reminders, forecasts and savings |

Opening balances are explicit non-expense adjustments, not income. A bank/cash debit decreases an asset; a posted card purchase increases a liability. A repayment decreases both the paying asset and card liability. Card-only payment SMS stays in review without financial effects until both accounts are known. Create one balanced transfer or attach evidence to an existing transfer; never invent an external payer or income.

Balances calculated from the ledger and bank-reported balance observations remain distinct, each with an as-of time and confidence. Missing history means a calculated outstanding balance may be incomplete. Available credit in an authorization SMS is not a spending budget, opening balance or reliable proof of posted outstanding debt.

## Money and dates

- Store positive integer minor units plus explicit ISO currency and posting direction. Validate every parse, calculation, aggregate and database read against the JavaScript safe-integer range; SQLite's wider integer range does not make JS numbers safe. Reject overflow.
- Parse decimal strings digit by digit using currency-specific scale; LKR uses two decimal places. Do not parse money through floating-point multiplication. Apply documented integer rounding for rates, allocations and percentages; split remainders deterministically so totals remain exact.
- Keep original and account settlement currency/amount distinct. Default reports group by currency. Converted net worth/reports require a user-entered, dated rational exchange rate and disclosed rounding; no automatic internet rate feed.
- Store observed UTC instants separately from bank-local transaction dates, optional posting dates and received timestamps. Default financial timezone is Asia/Colombo; a display-zone change must not rewrite historical budget boundaries.
- Missing year/time/date is a precision state, not fabricated midnight/current date. Any receive-time-based inference is flagged and reviewable. Two-digit years require a documented bounded rule. Never discard original date precision when matching statements.

## Approved financial semantics

- Recognized purchase authorizations are pending expenses and reserve budget capacity. Reports distinguish reserved from confirmed totals; a statement confirmation changes status on the existing event. Pending entries do not silently expire on an arbitrary timer.
- Transfers and repayments never contribute to expense budgets. Fees and interest are separate expenses. Linking a refund/reversal avoids representing it as income; a matched reversal releases the original reservation. An unmatched credit requires classification review.
- Refund policy: reduce spending in the refund's effective period, retaining the original purchase link; do not silently reopen a closed historical period. Show gross purchases and refunds separately.
- Card, overall and category budgets are separate views over eligible postings/splits; do not add their overlapping totals together. Each budget has one currency and a separate amount from the card credit limit.
- Budget windows are half-open `[start, end)` intervals. Calendar months and billing cycles use explicit zone/date rules; clamp closing days to month end. Define weekly start day and custom duration explicitly. Changing a card closing day applies prospectively, preserving prior periods.
- A reset creates the next period; it never clears transactions. Derive current-period usage on read so delayed background jobs cannot prevent a reset. Optional rollover uses finalized eligible unused allowance once, with an explicit cap/policy; no default debt rollover.
- Remaining budget may be negative. Remaining daily allowance uses inclusive remaining calendar days and integer division; display overspending separately rather than suggesting negative safe spending. Installment plans must not count both the original purchase and each principal repayment as expenses; recognize the original purchase once and use the schedule for obligations. Actual financing fees/interest remain expenses.
- Recurring templates create linked occurrences; a subsequent SMS/statement must match or be reviewed against that occurrence. Forecast reservations and savings goal earmarks do not themselves create spending or alter ledger balances.

## SMS capture and processing

1. With informed opt-in and RECEIVE_SMS granted, Kotlin receives system SMS broadcasts, reconstructs multipart messages and applies size limits, sender/template filters and sensitive-content rejection. Sender labels are hints, not authenticated bank identities.
2. Reject OTP/authentication and unrelated messages before persistence. Strip full card/account numbers to minimum identifiers; never retain PINs, CVVs or credentials. On uncertain sanitization, discard content and record only a nonsensitive failure code.
3. Persist a bounded, encrypted, sanitized financial envelope in the native inbox and enqueue work using only its opaque ID. Do not put SMS bodies or financial fields in WorkManager's own database, tags or logs.
4. WorkManager performs durable retry/housekeeping on encrypted envelopes without needing React Native alive or opening the ledger. Sensitive parsing, matching and ledger writes run after authenticated foreground unlock in TypeScript. Background capture therefore does not guarantee immediate expense/budget updates or alerts while locked.
5. A bank parser returns a discriminated result: recognized candidate, financial input needing review, unrelated/rejected input or malformed input. Include bank, masked instrument, kind, amount/currency, date precision, merchant, optional balance observation, parser version and warnings. Unknown fields remain unknown.
6. Resolve the account explicitly. Bank plus last four digits may be ambiguous across accounts; never assume a globally unique card suffix. Use user mapping/review. Apply local categorization rules, then persist observation, transaction/postings and processed state atomically.
7. Acknowledge/delete the native envelope after ledger commit. A crash before acknowledgment is safe because replay uses the same source ID. Failed work has bounded retries and a visible recovery path.

No headless-JS guarantee is assumed. WorkManager scheduling is deferrable and device-dependent; force-stop, reboot before unlock and vendor restrictions can interrupt capture. Optional historical import can recover some gaps with separate READ_SMS consent; without it, explain potential gaps and offer statement/manual import. Historical import reads bounded batches locally, passes through the same sanitization and parser pipeline, and can be cancelled.

### Locked capture and key policy

Proposed baseline: ledger decryption requires an authenticated session; locked capture uses a separate inbox encryption design. Evaluate a native envelope scheme with per-message authenticated encryption, public-key wrapping available to the receiver and a Keystore-protected, authentication-required private key for foreground decryption. WorkManager only handles ciphertext and housekeeping. This is a design candidate, not a verified Keystore implementation; algorithms, authentication window, device-credential fallback and reboot behavior are Phase 1 gates.

Do not silently relax ledger key authentication to enable background processing. If the inbox design cannot be proven on supported devices, use explicitly documented capture-after-unlock/history recovery until a reviewed alternative exists. Full financial processing while locked would require a separate security decision and threat-model revision.

## Supplied SMS findings

`sample-msges.txt` contains nine bodies: a purchase and repayment for each initial bank, plus a Commercial Bank debit-side bill-payment notice. It contains no sender metadata, real receiver timestamps or statement samples; headings are not evidence of production sender IDs. None of the raw bodies or identifiers should be copied into test fixtures.

| Sample family | Required interpretation |
| --- | --- |
| HNB authorization | Approximate amount, card suffix, merchant, timestamp and available-credit observation; not proof of settlement |
| HNB repayment | Transfer; no paying account is established by the card acknowledgment |
| Commercial card purchase/payment | Authorization is pending; settlement acknowledgment is a transfer |
| Commercial debit notice | No amount or reliable account identity; review-only, never a fabricated zero-value transaction |
| Sampath purchase/payment | Day/month without year and missing time need metadata/precision handling; credited PAYMENT RECEIVED is a transfer |
| BoC purchase/payment | Masked numbers must be reduced to suffixes; purchase lacks date; malformed trailing balance must not be silently repaired |

All four parsers need synthetic variants for declines, refunds, reversals, OTPs, unrelated texts and template drift, which the source does not supply. Initial four-bank coverage is a target, not a claim that these nine samples establish production completeness.

## Import idempotency and reconciliation

Use two distinct mechanisms:

1. Exact source replay protection: namespaced native inbox IDs, historical SMS provider IDs scoped to the source/device, and statement import fingerprint plus row identity/ordinal. Use keyed fingerprints over normalized sensitive input where necessary; a hash is not anonymization. File hashes alone do not catch a reformatted statement.
2. Economic matching: account, currency, type, exact settlement amount, reference if present, date precision/window and normalized merchant are evidence. Approximate/foreign authorization amounts may differ from final settlement. Never make `(amount, date, merchant)` globally unique: two genuine purchases can be identical.

Only a unique high-confidence match attaches another observation automatically. Conflicts, one-to-many candidates and uncertain dates go to review with budget impact explained. For ambiguous statement rows, defer ledger promotion rather than insert a second expense. Confirmed statement evidence can update pending status/settlement amount while preserving original authorization and user corrections. Merge/unmerge operations are transactional and auditable.

Preview PDF/CSV extraction in staging, validate currency/account/period and totals, then commit accepted rows in an atomic batch. Preserve distinct purchase, posting and value dates. Compute closing balance from opening balance, charges, interest, fees, payments and credits using explicit statement signs. Reconciliation status is separate from payment status; never force a mismatch to zero or infer a payment merely because a statement was imported.

## Persistence and file safety

Generate a random ledger key with a platform CSPRNG, wrap/protect it through Android Keystore and keep it out of logs/configuration. Verify SQLCipher is present before any schema access and fail closed if absent. Apply the key before migrations and validate reopening with the correct key, rejection with a wrong key and unreadability by ordinary SQLite. A lock closes database connections and releases key references; JavaScript cannot guarantee zeroization, so minimize key lifetime and evaluate native key handoff.

Serialize all database operations through a single connection owner initially. Avoid the exclusive-transaction helper until its separate connection is proven to receive encryption and foreign-key configuration; prevent unrelated async work from interleaving ordinary transactions. Keep schema/ledger changes atomic and test migration interruption and rollback. Database sidecars, caches and file temp areas are part of the encryption audit.

Receipts, retained statements and thumbnails require separate authenticated file encryption; SQLCipher does not encrypt external files. PDF passwords exist only for the import session. Use Android's document picker for file access, bounded local parsers and no embedded links/scripts. No broad storage permission. Retain original documents only with explicit choice; imports may contain full account/card numbers, so do not persist prohibited source documents, even encrypted. Securely discard temporary extraction data; explain platform limitations if a parser requires plaintext temporary files.

Encrypted backup is a versioned authenticated archive with a portable passphrase-derived key, independent of the device's non-exportable Keystore key. Select a maintained KDF/AEAD implementation only after review and device benchmarking. Restore into staging, authenticate/validate sizes and schema, create new device keys and replace live data atomically only after validation. CSV/JSON/PDF exports are deliberate disclosure to a user-selected destination; warn, preview and clean up temporary files.

## Compatibility review and evidence

Reviewed official documentation and npm metadata on 17 November 2026. Documented capabilities are distinct from executed compatibility tests. Phase 1 starts with the package pins in `package.json`; its verification evidence is recorded in `DEVELOPMENT.md`. The initial SDK 57 candidate was superseded by stable SDK 58 after its Router dependency audit exposed an unpatched URI-decoding dependency. Exact native toolchain pins and remaining compatibility gates still require build evidence.

| Component | Finding and initial decision | Evidence |
| --- | --- | --- |
| Expo / React Native / React | Initial pins: Expo 58.0.25, RN 0.88.1 and React 19.3.0, selected from the official SDK 58 package/template metadata. Use an SDK-supported Node release; local Node 24.22.2 satisfies Expo's declared range. Do not mix SDK package versions. | [SDK 58 reference](https://docs.expo.dev/versions/v58.0.0/) |
| Router / strict TypeScript | SDK-aligned Router 58.0.31 removes the vulnerable query-string dependency found in the SDK 57 candidate. Enable strict mode and validate native boundary data at runtime. Do not add server routes or server components. | [Router](https://docs.expo.dev/versions/v58.0.0/sdk/router/), [URI-decoding advisory](https://github.com/advisories/GHSA-qr28-fpjm-wq7f) |
| NativeWind | Stable v4.2.7 documents SDK 57 support; SDK 58 compatibility must be demonstrated by this foundation's bundle and native checks. Keep Tailwind 3.4 and SDK-aligned Reanimated/Worklets/safe-area peers. V5 is prerelease and not the production baseline. | [v4 installation](https://www.nativewind.dev/docs/getting-started/installation), [v5 status](https://www.nativewind.dev/v5/getting-started/installation) |
| Zustand | React Native and TypeScript supported; use transient state without financial persistence middleware. Check chosen React peer range. | [Zustand](https://zustand.docs.pmnd.rs/) |
| expo-sqlite / SQLCipher | Built-in SQLCipher config requires a native rebuild; Expo Go cannot validate it. Probe cipher availability. Connection-specific settings and transaction helpers require integration tests. Add the SDK 58-compatible package only in the encryption slice. | [SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/) |
| SecureStore / Keystore | SecureStore offers Keystore-backed encrypted values; authentication changes can invalidate access. Candidate for small secrets, but no assumption that Kotlin workers can use its internal storage format. Native key/session integration remains open. | [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [Keystore](https://developer.android.com/privacy-and-security/keystore) |
| Biometrics | expo-local-authentication provides an authentication prompt; UI authentication alone does not cryptographically gate the database key. Prove credential fallback and key authorization together. | [LocalAuthentication](https://docs.expo.dev/versions/latest/sdk/local-authentication/) |
| Kotlin module | Local Expo modules are supported. Keep native code in the module and manifest/build changes in config plugins so prebuild does not erase them. | [Expo Modules API](https://docs.expo.dev/modules/get-started/) |
| WorkManager | Pin work-runtime/work-testing 2.12.0, stable 23 September 2026, minSdk 24 (matches the app), compileSdk requirement 33+ (app 37). No work-analytics artifact. Native build/manifest/runtime integration remains pending. | [Release notes](https://developer.android.com/jetpack/androidx/releases/work), [Work requests](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work) |
| Jest | Use SDK-aligned jest-expo; Router tests use its testing library and current compatible React Native Testing Library. Native security needs separate Android tests. | [Jest](https://docs.expo.dev/develop/unit-testing/), [Router testing](https://docs.expo.dev/router/reference/testing/) |
| Local releases / CI | Local Gradle releases are supported; EAS is optional. Audit merged permissions and pin CI actions/toolchains when CI is added. | [Local production builds](https://docs.expo.dev/guides/local-app-production/), [Expo permissions](https://docs.expo.dev/guides/permissions/) |

## Technical uncertainties and resolution gates

| ID | Uncertainty | Resolution before shipping the affected feature |
| --- | --- | --- |
| U01 | Exact SDK/native toolchain and ABI/16 KB page-size compatibility | Pin supported patches and JDK/AGP/Kotlin/NDK versions; build target ABIs and test bundled SQLCipher on supported devices/page sizes. |
| U02 | Authenticated key access, device credentials, invalidation and locked capture | Prove native inbox encryption and ledger unlock/lock in Phase 1, including process death/reboot; otherwise choose a reviewed fallback with visible limitations. |
| U03 | SQLCipher connections, migrations and key lifetime | Test correct/wrong keys, missing cipher, sidecars, transactions, concurrency and native key handoff. |
| U04 | SMS permission and distribution | RECEIVE_SMS/READ_SMS are hard-restricted permissions, affected by installer allowlisting. Play lists SMS money management as an exception subject to review; no approval is assumed. Test actual sideload/F-Droid/install paths and keep manual/import workflows. [Android permission reference](https://developer.android.com/reference/android/Manifest.permission#RECEIVE_SMS), [Play policy](https://support.google.com/googleplay/android-developer/answer/10208820) |
| U05 | Sender IDs, bank templates and date semantics | Obtain consented, safely sanitized examples/metadata; build independently synthetic fixtures and per-template coverage. No statements are supplied. |
| U06 | PDF extraction, encrypted PDFs, CSV dialects and scanned pages | Evaluate maintained offline parsers/licenses on Android for each bank; bound memory/time/temp files and prototype password handling. OCR is an unresolved on-device extension, not promised by text extraction. Unsupported documents receive an explicit error/manual path. |
| U07 | Notification timing and OEM background limits | Test notification denial, Doze, reboot, force-stop and battery restrictions. Use inexact reminders; no exact-alarm permission initially. |
| U08 | Financial policy | Approve pending/refund policy, rollover caps, installment recognition, cycle-date changes, reconciliation tolerances and cross-currency transfers before their phases. |
| U09 | File crypto and portable backups | Select maintained AEAD/KDF, benchmark, version formats, test tamper/wrong password/large inputs, restore interruption and lost-device recovery. |
| U10 | Offline release and open-source supply chain | Verify merged manifest lacks INTERNET, no OTA/remote assets/telemetry, airplane-mode cold start and full workflows; review dependency licenses and F-Droid build eligibility. |

Implementation acceptance gates and complete feature sequencing are in `DEVELOPMENT.md`; security properties and residual risks are in `SECURITY.md`.
