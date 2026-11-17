# Incremental development roadmap

Status: approved by the user on 17 November 2026. This roadmap delivers the complete catalogue through small testable features. Incremental initialization and dependency installation are authorized. Commits and pushes require separate approval.

## Working method and review gate

Review `FEATURES.md`, `ARCHITECTURE.md` and `SECURITY.md` first. User approval of the architecture and roadmap is required before initialization or dependency installation. Explain each proposed implementation slice before acting. Commit and push only with explicit user approval; approval to implement is not approval to publish.

After approval, work on one vertical slice at a time. Each slice should have useful behavior, meaningful domain/parser/security tests where applicable, native verification when it crosses Android boundaries, and updated documentation. Do not implement an entire numbered phase as a single unreviewable change. Later phases remain part of the product commitment.

## Phase 1 first slice status

The architecture and roadmap are approved. The initial implementation is limited to five navigation tabs, an accessible scrollable foundation screen, system light/dark styling, strict TypeScript and explicit development/release configuration. It contains no financial database, credentials, demo transactions, SMS receiver or financial permission requests. Development tools have separate networking capabilities. Zustand, SQLCipher, authentication, WorkManager and Jest are added only when their implementation slices need them.

The selected baseline is Expo 58.0.25, React Native 0.88.1, React/React DOM 19.3.0, NativeWind 4.2.7 and Tailwind 3.4.17. Exact direct versions and transitive integrity hashes are pinned in `package.json` and `package-lock.json`. React DOM, Expo Font and Gesture Handler are explicitly pinned to the SDK's native version map to prevent wildcard peer dependencies from choosing another SDK's versions; there is no web target, backend or remote font loading.

The SDK 57 candidate had an unpatched transitive URI-decoding advisory; SDK 58 Router removes that dependency. A targeted `@expo/fingerprint` override selects minimatch 11.0.9 for its preserved `Minimatch` API, addressing [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). Revisit/remove the override when upstream adopts a patched range. The actual fingerprint-generation API has been exercised with this override. Do not use `npm audit fix --force` to bypass SDK compatibility.

Verified on this workspace: clean `npm ci`, zero known npm audit findings, clean top-level dependency tree, strict TypeScript, release configuration assertions, Android Metro/Hermes export with NativeWind, and Expo Doctor (20/20 checks). Direct package license metadata is MIT except TypeScript (Apache-2.0). This is not a complete transitive license or native binary audit.

The native development build passed with `:app:assembleDebug -PreactNativeArchitectures=x86_64`. The release manifest task `:app:processReleaseManifest` also passed, including production JS/asset bundling. Tools used: Node 24.22.2 (recorded in `.node-version`), npm 11.2.0, Temurin JDK 17.0.21, Gradle 9.4.1, AGP 9.2.1, resolved Kotlin 2.2.10, NDK 27.1.12297006 and build tools 37.0.0. The framework catalog declares Kotlin 2.2.0 but the actual plugin selects 2.2.10; the build reports that selection. Android minimum is API 24, target API 36 and compile API 37. Upstream template/dependency deprecations require review on future AGP/Gradle upgrades; no vendor files were patched.

Only x86_64 native compilation has been exercised by the agent. The user confirmed that the development shell works on 17 November 2026; the device/API and individual checks were not recorded. No automated device walkthrough or signed production APK has been produced. Other ABIs, 16 KB page-size behavior, airplane-mode launch, Keystore, encryption, biometrics and background reliability remain open gates. Prebuild recreates native output when switching variants; regenerate the appropriate variant before a build.

Offline configuration checks assert Android-only targeting, disabled updates, disabled automatic backup, no requested runtime permissions and INTERNET blocked in release configuration. The actual merged release manifest passed `check:manifest`: no INTERNET, SMS or other platform permissions; the sole permission is AndroidX's app-private signature-protected receiver permission. Remote updates are disabled, automatic backup is false and the app is not debuggable. Development explicitly enables Metro networking under `org.sallimanager.app.dev`. Generated native projects and bundles are ignored; run the appropriate prebuild script whenever changing build variants. Offline runtime verification remains a gate even after these artifact checks pass.

A regression check injected INTERNET into a copy of the genuine merged release manifest; the manifest guard rejected it with the expected offline-permission error. Temporary regression inputs and build diagnostics remain in ignored `.cache/`, not public fixtures.

Reproduce the manifest check after `npm run prebuild:release` by running `:app:processReleaseManifest` with the Gradle wrapper from `android/` (release environment, Node production mode), then from the repository root:

```text
npm run check:manifest -- android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml
```

The next slice is native SQLCipher/Keystore/authentication feasibility using disposable synthetic data. Do not add financial persistence or SMS capture before those security gates pass. The rest of Phase 1, including CI and locked-inbox feasibility, remains incomplete.

## Phase 2 first slice status

The user requested Phase 2 after confirming that the shell works. At the user's request, the Phase 1 baseline was committed and pushed to `origin/main` as `87659f5`, then `phase-2-money-ledger` was created for new work. Phase 2 changes remain uncommitted pending review. The user confirmation does not close the native encryption/authentication gates; this first slice is pure domain code with no financial persistence or entry screens.

Implemented domain contracts:

- `src/core/money/money.ts`: immutable money values containing a safe integer number of minor units and an explicit currency; LKR default; canonical parsing/formatting, addition, subtraction, negation and summation. BigInt is used only for exact intermediate arithmetic and is never returned as stored/serialized money. Every returned amount remains within JavaScript's safe-integer range. Mixed-currency arithmetic is rejected.
- Initial reviewed currencies are LKR, USD, EUR, GBP, INR and AUD (two decimal places), JPY (zero) and KWD (three). Metadata was verified against [SIX ISO 4217 List One](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml) on 17 November 2026. Unknown codes are rejected; this is an extensible allowlist, not a complete currency catalogue or a runtime data feed.
- Amount parsing accepts a bounded decimal string with an optional minus sign, decimal point and surrounding whitespace. It rejects grouping separators, currency symbols, exponents, incomplete decimals and excess precision; it never silently rounds. Locale and bank-template normalization belong in later input adapters. Formatting produces an exact canonical decimal string, not localized UI text.
- `src/core/dates/calendarDate.ts`: validates complete local Gregorian dates from year 0001 through 9999, including leap-year rules. No Date.parse rollover, timezone conversion, fabricated time or missing-date inference.
- Account domain references contain only ID, kind, currency and archive state. Account creation forms, names, customizations and durable account management remain later slices.
- Manual ledger entries derive positive-amount debit/credit postings from explicit expense, income, transfer or opening-balance intent. Opening balances may be signed, including bank overdrafts and card credit balances; a zero opening has no posting. Manual entries are confirmed. Opening balances and transfers never contribute to income/expense totals.
- Projection calculates account balances, income, expenses and net worth separately per currency. Purchases increase card liabilities; repayments reduce both the paying asset and card liability without changing purchase spending. Full, partial and excess payments follow the same rule. A cash advance is a transfer with any fee recorded separately as an expense.
- New entries reject archived accounts; projection retains archived-account history. Duplicate account/entry IDs and multiple openings for one account are rejected. Equal purchases with different IDs remain separate. This is exact-ID integrity, not SMS/statement economic matching or import idempotency.

Transfers currently require two known accounts and a matching single currency. Cross-currency transfers need explicit settlement/rate/fee handling in a later slice; no rate or missing account is inferred. Projection operates on the entry set supplied by its caller, without date filtering, source reconciliation, balance-completeness claims or persistent edit history. Automatic refund classification and pending/reconciled lifecycle handling remain later features.

Jest tooling is pinned to Jest 30.5.2, jest-expo 58.0.14, @react-native/jest-preset 0.88.1 and @types/jest 30.0.0. Native APIs supplied by the preset are mocks, so these tests establish financial-domain behavior, not native security. Use `npm test`, `npm run test:watch` or `npm run test:coverage`.

The test-tool dependency graph uses patched glob 14.0.6 for [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), and minimatch 11.0.9 for [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). The modern callers use the named APIs retained by these versions. Global pins include an explicit `test-exclude@6.0.0` exception for its legacy glob 7/minimatch 3 callback API. This exception is confined to upstream development tooling, which still emits legacy deprecation warnings; the installed graph has zero known npm audit findings. Review/remove the overrides when upstream adopts patched ranges, and check new consumers before adding packages. Test discovery, coverage and the application bundle were exercised with the resolved versions.

Verified for this slice: 115 tests across three suites pass; coverage of the four domain modules is 100% of lines/functions, 98.23% of statements and 97.38% of branches. Strict TypeScript, Android production bundle export, release public-config assertions, the complete npm dependency tree and Expo's actual fingerprint-generation API pass. The lockfile was regenerated to remove stale override resolution and reinstalled with `npm ci`. No native code or permission changes were introduced, and no new native/device/security validation is claimed.

At the end of that first slice, financial input screens and encrypted repositories were not implemented. The Phase 3 implementation status below records the later encrypted/session integration and development workflows. Complete the remaining native acceptance and Phase 2 exit criteria before treating the broader account/manual-ledger feature set as complete.

## Phase 3 implementation status

Native runtime confirmation: the owner has confirmed that Salli Manager Dev displays its locked screen and successfully unlocks on the API 34 phone, using the working offline development server on port 8107. The foreground screenshot-protection update now runs on Android's UI thread. The project launcher now runs Expo in-process rather than behind spawnSync. No phone database or keys were cleared. Negative-key/cancellation probes and the full budget/session walkthrough remain separate acceptance checks.

The [approved detailed plan](PHASE3_PLAN.md) is implemented through domain calculations, encrypted repositories and development screens. Full device/workflow acceptance is still in progress; do not call the complete phase verified until the [synthetic walkthrough](PHASE3_TESTING.md) passes. Earlier Phase 1/2 first-slice sections above describe historical baseline evidence, not the current feature set.

- Budget engine: monthly/weekly/billing/custom periods; explicit financial timezone; card/category/overall scope; exact allocations; pending reservations, linked refunds and reversals; next-period revisions; integer transition proration; capped rollover; frozen issued allowances and visible correction differences; consolidated, once-per-period/threshold in-app state. Bounded catch-up runs on reads/resume, not background timers.
- Persistence: SQLCipher `expo-sqlite` 58.0.17, schema version 1, canonical validation on reads, bound SQL values, immutable issued snapshots, unique period/threshold/event keys, optimistic budget versions and encrypted change records. Snapshot/threshold/event writes share one transaction. Persistent in-app signals survive a crash between commit and display; dismissal does not rearm their thresholds.
- Session: local `finance-vault` Kotlin module uses platform AES-GCM, an authenticated Android Keystore wrapping key and a no-backup envelope. Strong biometric/device credential unlock on API 30+, credential fallback on API 24–29. Five-second key authorization; a new system prompt is always requested. The database key crosses the Expo SQLite JS/native boundary transiently; no JS memory-zeroization guarantee. Missing/inaccessible keys never trigger a silent database reset.
- UI: Expo Router protected routes, background/manual/three-minute inactivity locking, transient Zustand 5.1.0 state cleared on lock, screenshot/recents protection; account and manual-entry prerequisites; budget overview/create/prospective edit/detail/history/archive, period previews, rollover corrections, per-currency grouping and threshold inbox. Manual expenses are confirmed; imported pending/refund/reversal lifecycle UI remains later work.
- Native privacy: only USE_BIOMETRIC added; release INTERNET stays blocked, updates disabled, automatic backup disabled, explicit legacy/cloud/device-transfer exclusions generated by a CNG plugin. No edits to generated Android sources are relied on. No SMS/notification/storage permission or cloud dependency added.

Compatibility: the installed Expo 58 map specifies SQLite ~58.0.17. Zustand 5.1.0 is MIT and its React >=18 peer range includes React 19.3.0; installed without persistence/devtools middleware. The installed Expo SQLite implementation's `withExclusiveTransactionAsync` opens another unkeyed connection, so the sole authenticated session owner serializes explicit BEGIN IMMEDIATE/COMMIT/ROLLBACK transactions on its keyed connection. No retained JS key is needed to key secondary transaction connections. See [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/) and [Android authentication](https://developer.android.com/identity/sign-in/biometric-auth).

Current evidence: 255 tests in eleven suites pass; strict TypeScript passes; complete npm dependency tree and production Android bundle export pass. ARM64 development native compilation passes. The regenerated release main merged manifest and generated backup XML checks pass (no INTERNET, backup, debuggable or remote updates; only biometric and AndroidX private signature permission). The development probe covers both unlock paths, cancellation, expired key authorization, encrypted header, correct-key reopen, wrong/no-key rejection and ordinary Android SQLite rejection using a fixed synthetic sentinel. The complete probe suite still needs confirmation in the installed native runtime. The updated full workflow build is installed. The owner has now confirmed the locked screen and successful authenticated unlock in Salli Manager Dev on port 8107. The full negative-key/cancellation probe suite and session/budget workflow walkthrough are not yet accepted.

Still open: full workflow/session background/deep-link/relaunch checks on the updated build; native key invalidation/credential changes and recovery; API 24–29 fallback and other devices/ABIs/page sizes; signed release cold-start in airplane mode; OEM backup/device-transfer behavior (including newer cross-platform transfer modes); accessibility and larger-history performance. SMS capture/encrypted inbox/WorkManager, account customization/archival/editing and broader transaction edit/delete/import workflows remain their planned slices. No claim that all original Phase 1/2 exit criteria are complete. No new commits or pushes.

The local `.github/workflows/checks.yml` now runs npm ci, TypeScript, coverage, release-config checks and Android JavaScript export on push/pull requests with read-only permissions and credentials not persisted. Its [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) and [setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0) actions are pinned to the official release commits. YAML/action-pin checks and local equivalents pass; no GitHub run has occurred because no changes were committed/pushed. Native Android security/build checks remain local evidence rather than a claimed CI job.

## Phase 0 Documentation and decisions



Scope: these six Markdown documents; inspect the full feature catalogue and nine SMS bodies without treating samples as production fixtures.

Exit: user reviews the architecture and roadmap. Record decisions on the candidate SDK baseline, locked capture versus foreground processing, secure-device requirement and proposed financial policies. Keep U01-U10 in `ARCHITECTURE.md` open until evidence resolves them. No automated application tests are possible in this phase; check catalogue completeness, links and internal consistency.

## Phase 1 Native feasibility and minimal shell

Depends on: Phase 0 approval. Covers foundations of F10/F13; resolves U01-U04 and U10 early.

Small slices:

1. Verify maintained dependency patches, licenses, advisories and peer compatibility. Record exact Expo/RN/React/Router, NativeWind peers, Zustand, TypeScript/Jest and Android toolchain/WorkManager versions. Initialize the development-build shell with strict TypeScript only after approval; add dependencies as each slice needs them.
2. Add the five-tab accessible shell and basic local theme; verify NativeWind Metro/Babel, fonts and New Architecture/native peers on Android. No financial mock records copied from source samples.
3. Prove SQLCipher and key protection with synthetic disposable data; add connection ownership, a migration and fail-closed startup. Prove biometric and device-credential key access, locking and recovery states.
4. Prototype native bounded SMS capture/encrypted inbox and ID-only WorkManager scheduling. Prove capture while app is locked/process is absent, authenticated foreground drain, replay safety and reboot limitations. If not feasible, stop this design slice and document a reviewed limited fallback before financial ingestion.
5. Build a local offline release with no INTERNET permission/OTA/runtime remote assets. Test SMS permission installer behavior on intended install channels; document Play exception uncertainty and F-Droid eligibility questions.
6. Add initial GitHub Actions checks for typecheck, Jest and native build/tests as they become meaningful. Restrict token permissions, pin actions by reviewed commit SHA and keep signing secrets out of PR jobs.

Exit: actual native APK evidence for cipher presence/absence, wrong key, credential fallback, key invalidation, lock/deep links, queue confidentiality and native integration. Test ABIs/page sizes required by the intended distribution, inspect merged manifest and launch cold in airplane mode without Metro. `expo-doctor` and SDK package compatibility checks pass for the pinned set. A documented API capability is not a substitute for these checks.

## Phase 2 Money accounts and manual ledger

Depends on: encrypted storage/session foundation. Covers F01 and basic F05.

Slices: integer money/currency utilities; explicit date precision and periods; account creation/customization/opening balance/archive/history; manual expenses/income; two-legged transfers and card repayments; transaction list/detail/search/filter/sort; minimal encrypted edit/delete history. Use synthetic seeded data only for development/testing.

Exit: exact decimal parsing, safe-integer overflow rejection, currency separation, balance signs, opening balances and split-free ledger round trips are tested. A manual repayment reduces bank assets and card liability, produces no expense and does not affect any future budget calculation. Archive preserves history. Reopening the encrypted database preserves edits; lock clears sensitive UI state. Manual workflows need no SMS permission.

## Phase 3 Per-card and overall budgets

Depends on: Phase 2. Covers F04 except optional advanced history/policy extensions.

Slices: card limit/settings separated from card budget; calendar-month budget; billing-cycle budget; custom period; overall/category scopes and weekly periods; usage/remaining/daily allowance and persisted history. The approved policies and detailed acceptance criteria, including rollover, thresholds and prospective edits, are recorded in `PHASE3_PLAN.md`.

Exit: test half-open boundaries, leap years, closing days 29-31, prospective cycle changes, timezone handling and delayed app launch. Repayment never resets usage. Card budget changes never change the bank credit limit. Overlapping card/category/overall views do not duplicate underlying expenses. Rollover applies once; historical allowances remain stable. Threshold deduplication is tested before notifications are connected.

## Phase 4 SMS parsers and historical import

Depends on: native capture feasibility and Phase 2; budget integration uses Phase 3. Covers F02 and pending/refund/transfer parts of F05. Resolves U05.

Slices: typed parser results/review queue; one bank and one event type at a time; account mapping/categorization; import provenance/idempotency; foreground drain; optional bounded historical import. Build BoC, Sampath, HNB and Commercial Bank modules separately, each with purchase and repayment tests before claiming that template supported. Add refunds/reversals/declines and unknown template behavior with independently synthetic evidence.

Exit: all sample format families have synthetic equivalents and explicit expected behavior, including absent amount, absent date/year, approximate purchase, card-only payment and malformed balance. Test bank-suffix collisions, multiple genuine equal purchases, OTP/unrelated rejection, sensitive-data stripping, multipart delivery and long/malformed inputs. Replaying live/history/work events creates no duplicate. Denial/revocation/cancellation and unavailable JS have safe behavior; no SMS body in logs/WorkManager. Capture delays and unresolved items are visible.

## Phase 5 Credit card dashboards and settlements

Depends on: ledger and transaction lifecycle. Covers F03 with statement details completed in Phase 6.

Slices: calculated versus reported balances/as-of time; available credit/utilization/unbilled display; card cycle/due rules; partial/full settlement allocation; charges/interest/annual fees; installment schedules and card analytics/history.

Exit: dashboard does not claim completeness without history. Multiple/partial payments are transfers, allocations do not create expenses, fees/interest do. Installment principal is never counted both at purchase and repayment. Charge reversals and linked refunds preserve provenance; no payment resets budgets. Do not present a due date/minimum amount as bank-confirmed without a statement or user entry.

## Phase 6 Statements and reconciliation

Depends on: provenance/idempotency and card model. Covers F06; resolves U06 and matching policy in U08.

Slices: evaluate offline CSV/PDF/password handling with synthetic fixtures; stage/preview imports; ship one bank/format at a time; exact replay protection; unique economic matching; ambiguous-match review and manual merge/unmerge; balance reconciliation; statement payment allocation/history. Add PDF support after its local extraction/security spike, without holding CSV correctness hostage to it.

Exit: test same-file replay, reformatted/overlapping statements, repeated equal purchases, pending-to-posted amount/date changes, refunds, missing SMS, foreign currency and manual corrections. A row matching an SMS attaches evidence to one event; uncertain matches do not silently duplicate expenses. Closing balance formula and payment status are independently verified. Test password failures, malformed/oversized files and temporary cleanup; no passwords/full identifiers retained. Complete four-bank supported format coverage before calling initial bank statement support complete; unsupported/scanned formats receive explicit handling.

## Phase 7 Full transaction workflows

Depends on: ledger; recurrence matching depends on import matching. Completes F05.

Slices: category splits, tags/notes, custom categories/rules, bulk categorization, recurring templates/occurrences and encrypted receipts. Extend edit history to matching and bulk changes; expose understandable pending/confirmed/reconciled states.

Exit: splits sum exactly, bulk operations roll back on failure, user rules/corrections survive reimport, recurring forecasts/occurrences match later observations without duplication, and attachment/thumbnail/temp files remain private and encrypted. Deletion/editing invalidates affected budget/report/reconciliation views accurately.

## Phase 8 Backup restore and data portability

Depends on: stable schema and file encryption; export can ship earlier as small slices when its safety gates pass. Covers F11 and backup/deletion parts of F10. Resolves U09.

Slices: selective CSV and JSON export; versioned full encrypted archive; passphrase/KDF design and benchmarks; fresh-device restore and migration; supported other-tracker imports; PDF reports when reporting data is ready. Finalize portability for later entities as their features arrive.

Exit: export text cells resist formula injection; user sees plaintext disclosure warning and selection preview. Test wrong passphrase, tamper, truncated/oversized archives, path traversal and newer/older schema handling. Interrupted restore leaves original data intact. Restore on another device generates new device keys and preserves all supported records, matching/history and encrypted attachments. Cleanup and full local erasure are tested; provider originals and exported copies are explained as outside app deletion.

## Phase 9 Bills subscriptions and local reminders

Depends on: budgets, card dates, recurrence and installment plans. Covers F08. Resolves U07.

Slices: local notification settings; card due/statement reminders; threshold alerts; bill/subscription detection and user confirmation; installment reminders and obligations calendar. Prefer inexact scheduling; do not request exact alarms for convenience.

Exit: tests cover rescheduling, duplicate suppression, timezone/clock changes, reboot and denied notifications. Messages are masked by default. No network/foreground-service dependency. Show overdue/upcoming items in-app even when scheduling is delayed; do not promise precise background financial alerts when processing awaits unlock.

## Phase 10 Analytics savings and planning

Depends on: validated ledger/budgets/statements and obligations. Covers F07/F09 and PDF financial reports in F11.

Slices: category/merchant/account/card trends; daily through annual/custom/financial-year reports; income/expense and cash flow; budget comparisons/utilization history; net worth by currency; optional explicit manual conversion; savings/emergency goals/contributions/targets; savings rate, upcoming spending and forecasts/available-to-spend.

Exit: reports share tested ledger semantics and expose pending/incomplete records. Internal transfers and goal earmarks never inflate income/expenses/net worth. Currency totals remain separate unless a dated conversion is explicitly chosen. Forecasts show assumptions and avoid double reservation of card purchases, scheduled payments and installments. Generated PDF reports are local and visually checked.

## Phase 11 Personalization accessibility and complete-product release

Depends on: prior slices; accessibility and localization preparation start at the shell. Completes F12/F13 and final F10 hardening.

Slices: English/Sinhala/Tamil strings and formatting; dashboard widgets; themes/icons/colours; scalable type, contrast and screen-reader workflows; hide amounts; permission/data-management screens. Add contribution guidelines, verified private vulnerability reporting, parser extension instructions and synthetic fixture policy. Add dependency scanning, signed APK provenance, practical build reproduction instructions and F-Droid submission/build metadata after eligibility review.

Exit: verify all F01-F13 capabilities and five tabs; test font scaling/TalkBack and Sinhala/Tamil rendering with meaningful review. Test migrations from every released schema, large local histories, battery/storage usage and backups of all later features. Complete `SECURITY.md` evidence, manifest/log/file audits, offline cold-start workflows, signing verification and release notes with known limitations. Keep signing secrets separate from public CI. F-Droid acceptance and byte-for-byte reproducibility are not presumed; document actual results.

## Coverage map

| Catalogue | Main delivery phases |
| --- | --- |
| F01 Accounts | 2 |
| F02 Automated tracking | 1 native feasibility, 4 parsers/import |
| F03 Credit cards | 2 transfers, 5 dashboards, 6 statements |
| F04 Budgets | 3, 9 notifications |
| F05 Transactions | 2, 4 lifecycle, 7 advanced workflows |
| F06 Statements | 6 |
| F07 Analytics | 5 card views, 10 reports |
| F08 Reminders | 9 |
| F09 Planning | 10 |
| F10 Security/privacy | Every phase; 1 foundations, 8 recovery, 11 release audit |
| F11 Import/export | 6 statements, 8 portability, 10 PDF reports |
| F12 Personalization/accessibility | Every UI slice; 11 completion |
| F13 Open source | 1 CI, 4 fixtures/parsers, 11 distribution |

## Verification strategy

- Jest: money, currency scale/rounding/overflow, signs, periods, budgets, refund/repayment/installment policies, parsers, categorization and deterministic matching. Use parameterized edge cases and useful invariants rather than implementation-mirroring tests.
- Repository integration: actual encrypted SQLite behavior on Android, migrations, uniqueness, atomic batches, reconciliation and recovery. Plain SQLite or mocked Expo tests are useful but cannot prove SQLCipher integration.
- Kotlin/native tests: receiver filtering/multipart boundaries, bridge validation, encrypted queue, key authorization, WorkManager retries and ciphertext-only job payloads. Real devices supplement emulators for Keystore/biometrics/OEM behavior.
- UI/integration: user-visible workflows, protected routing, permission denial, ambiguity review, accessibility and offline operation. Choose maintained Android UI tooling when this phase needs it; do not install a test framework speculatively.
- CI: strict typechecking, linting, meaningful Jest tests, compatible native tests/build checks, dependency/license scanning and manifest/privacy checks as each becomes available. Run locally equivalent commands where practical; record checks that cannot run.
- Record test evidence per slice, including build versions and tested device/API levels. Broaden tests for unresolved risk rather than repeatedly running passing suites without new changes.

Current authorized work is the approved Phase 4 implementation. Approval does not resolve unrun native feasibility gates or authorize implementing the entire product at once.

## Phase 4 implementation status

The owner accepted Phase 3 functional workflows and approved PHASE4_PLAN.md. No new commit/push is authorized. The owner runs Metro and Android builds. No Phase 4 native build/device pass is claimed; earlier evidence above is historical.

Implemented for development validation:

- Canonical pending/confirmed/reconciled transactions, voids, linked refunds and pending budget reservations. Atomic schema v2 migration preserves legacy IDs/financial fields and issued budget history, creates manual provenance, then removes the old writable ledger. Corrupt/future schemas fail closed.
- Four independent purchase/repayment parsers, bounded sanitization, OTP rejection, number redaction, exact money and explicit date precision. Missing fields and unsupported financial formats go to review. No verified reference format exists, so economic similarity never auto-merges.
- Exact source replay, changed-source review, confirmed sender/account mappings, conservative duplicate candidates and audited create/link/dismiss/reverse/correction actions. Repayments need both accounts. Refunds require posted originals and cumulative limits.
- Date-range history scans, fixed provider high-water IDs, encrypted staging, savepoint previews, ledger-revision checks and atomic 50-item commits. Unlock pauses unfinished imports and invalidates previews. Backfill thresholds are baselined quietly. Seven-day source retention also covers staging; discarded/expired counts remain visible.
- Kotlin FinanceSmsModule shares the finance-vault Android library/session. Handles activate after authenticated schema/record validation. Background/lock invalidates handles and releases native secrets; workers cannot decrypt/open the ledger. RSA-3072 OAEP SHA-256/MGF1-SHA-256 wraps fresh AES-256-GCM envelope keys. A separate auth-required Keystore AES key protects private RSA/correlation material; metadata uses a Keystore HMAC key.
- Protected SMS receiver, Android multipart decoding, 20-part/8-KiB bounds, bounded receiver executor and 1,000-file/16-MiB no-backup ciphertext queue. Capacity rejects new captures with gap counts. WorkManager does ciphertext housekeeping only, with empty work data and no network constraints/foreground service.
- More → Bank SMS provides encryption/auth probes, sender/masked mappings, review, corrections, history and retry. Capture starts disabled and needs cipher checks, expired SMS-wrap authorization rejection and RECEIVE_SMS consent. READ_SMS is separate. Debug-only fixed HNB fixtures test inbox flow without real messages; they do not prove OS broadcast delivery.

New dependency: AndroidX work-runtime/work-testing 2.12.0, Apache-2.0, reviewed against [official release notes](https://developer.android.com/jetpack/androidx/releases/work). MinSdk 24 matches the app; compileSdk 37 exceeds its minimum. Native integration still requires compilation. JVM checks use standard JUnit 4.13.2. No new npm runtime package. CI definitions cover JS checks and native compilation/JVM/manifest checks; no remote run has occurred.

See PHASE4_TESTING.md for local evidence/counts and the owner's commands. Open gates include Kotlin/APK compilation, real authorization/ciphertext and log audits, multipart/system delivery, installer permission behavior, process death/reboot/force-stop, queue corruption/limits/expiry, session races, the new merged release manifest and offline cold-start. Use synthetic data and leave real capture disabled until acceptance passes. Backups/recovery, statements, notifications and advanced categorization remain later work.
