# Salli Manager

A planned open-source, privacy-first Android personal finance and expense tracker, focused on credit cards, budgets and statement reconciliation. It will detect transactions from bank SMS and keep financial processing on the device.

The architecture and roadmap were approved on 17 November 2026. Encrypted accounts, manual entries and spending budgets are available in the development build. Phase 4 adds bank parsers, a protected SMS review/import workflow and native encrypted capture code. The new native code still needs compilation and device acceptance; capture starts disabled. The goal is the complete product described in the feature catalogue, delivered through independently testable increments.

## Planned capabilities

- Multiple credit cards, bank and cash accounts; LKR by default with multiple currencies.
- Local SMS detection for Bank of Ceylon, Sampath Bank, HNB and Commercial Bank of Ceylon, plus manual entry and statement imports.
- Personal card budgets independent of credit limits, including calendar-month and billing-cycle periods.
- Repayments recorded as transfers; payments never reset spending budgets.
- SMS/statement duplicate prevention, reconciliation, reports, reminders, savings planning and encrypted backup/restore.
- English, Sinhala and Tamil, accessible interfaces and configurable privacy controls.

## Privacy principles

No backend, mandatory cloud service, registration, ads, analytics, tracking or cloud AI. Financial data stays local in SQLCipher, with an authenticated Android Keystore wrapping key. No banking credentials, full card numbers, PINs, CVVs or OTPs may be stored. The release manifest omits internet permission and remote updates; runtime offline release validation remains outstanding.

SMS access will be opt-in and permission-dependent. Manual entry and file import remain available without it. The proposed secure design captures sanitized encrypted messages while locked and processes them after authentication; background reliability and key access still require native verification. SMS records are not authoritative bank statements.

## Proposed technology

React Native with Expo development builds, strict TypeScript, Expo Router, NativeWind, Zustand, SQLite with SQLCipher, Android Keystore, biometrics/device credentials, a custom Kotlin SMS module, Android WorkManager, Jest and GitHub Actions.

The [architecture compatibility review](docs/ARCHITECTURE.md#compatibility-review-and-evidence) records the SDK baseline, official sources and unresolved native tests. Expo Go cannot validate this app's native SMS and SQLCipher requirements; development builds are required. Local Android builds are used; a mandatory cloud build service is not required.

## Project documents

- [Development instructions](AGENTS.md)
- [Complete feature catalogue](docs/FEATURES.md)
- [Initial architecture and technical uncertainties](docs/ARCHITECTURE.md)
- [Security requirements and threat model](docs/SECURITY.md)
- [Incremental implementation roadmap](docs/DEVELOPMENT.md)
- [Approved Phase 3 plan](docs/PHASE3_PLAN.md)
- [Synthetic Phase 3 device walkthrough](docs/PHASE3_TESTING.md)
- [Phase 4 plan and implementation status](docs/PHASE4_PLAN.md)
- [Phase 4 Android acceptance checks](docs/PHASE4_TESTING.md)

The supplied `Expense_Tracker_Feature_Catalogue.docx` and `sample-msges.txt` are private planning inputs. Tests use independently invented records. The owner supplied sender seeds HNB, COMBANK, SAMPCCTXN and BOC; no statement samples have been supplied.

## Development status

The five-tab development build has a protected unlock screen, encrypted repositories, manual accounts/entries and budget workflows. **More → Bank SMS and import review** opens sender/account mapping, encryption checks, review decisions, corrections and optional historical scan/preview/import. RECEIVE_SMS is requested only for live capture and READ_SMS separately for history. Manual workflows need neither permission. Android installer restrictions may prevent SMS access.

Budget periods include calendar months, Monday weeks, card billing cycles, one-off dates and anchored repeating days. Pending SMS purchases reserve budgets without changing posted balances. Card budgets are independent of credit limits; repayments are balanced transfers and never reset budgets. Missing dates/amounts/accounts and possible duplicates require review. Sampath day/month dates and BoC purchases without dates remain review-only. Refund/reversal/decline templates have no verified automatic classification; users must explicitly resolve them.

Use synthetic records until acceptance is complete. The owner confirmed Phase 3 unlock and functional workflows on the connected phone. Phase 4 native compilation, inbox/Keystore checks, permissions, background/process behavior and the new merged release manifest remain pending. Other Android versions/ABIs, recovery, accessibility and offline cold-start also need their documented checks. Portable encrypted backup is not implemented; lost keys can make local data inaccessible. This is not a production-ready security claim.

Use Node 24.22.2, npm 11.2.0, JDK 17, Android SDK platform 37, build tools 37.0.0 and NDK 27.1.12297006 for the verified toolchain. Install dependencies using `npm ci`. Run `npm run prebuild:development`, then `npm run android` to build/install the development application locally. Use `npm start` to start Metro for a development client. An Android emulator or USB-debugging device is needed to run it. No Expo account or EAS service is required.

Run `npm run typecheck`, `npm run check:config` and `npm run export:android` for the code/build checks. The configuration check covers declared release settings; it does not prove the final merged manifest, runtime offline behavior or encryption. The locked development screen includes synthetic native security checks; broader device acceptance is documented separately.

Open **Salli Manager Dev**, not Expo Go. Expo Go cannot load the local Keystore module or this SQLCipher build. `prebuild:development` only generates Android files; run `npm run android` to compile/install them. `npm start` serves JavaScript to the installed development client. When using a different Metro port, connect that client to the same server; USB testing also needs the corresponding `adb reverse tcp:PORT tcp:PORT`. Do not clear application data to fix a bundler connection problem.

Run `npm test` for the financial, repository and security-boundary tests and `npm run test:coverage` for coverage. Test inputs are independently synthetic. Repository tests use actual in-memory SQLite for atomicity and constraints; Jest mocks do not prove Android encryption. See the [current implementation evidence](docs/DEVELOPMENT.md#phase-3-implementation-status).

Phase 4 checks and native results are recorded in [DEVELOPMENT.md](docs/DEVELOPMENT.md#phase-4-implementation-status). Earlier ARM64 compilation and release-manifest passes do not validate the newly added Kotlin/WorkManager code. Run `npm run check:manifest -- <merged-release-AndroidManifest.xml>` after regenerating a release manifest; it also checks backup exclusions and the SMS receiver boundary.

With an existing Metro terminal on 8107, rebuild native changes in a second PowerShell terminal:

```powershell
npm run prebuild:development
npm run android -- --no-bundler
adb reverse tcp:8107 tcp:8107
adb shell am start -a android.intent.action.VIEW -d "exp+salli-manager://?__expo_url=http%3A%2F%2F127.0.0.1%3A8107" org.sallimanager.app.dev
```

Do not combine `--no-bundler` with `--port`. Start Metro yourself, when needed, using `npm start -- --port 8107 --clear --max-workers 2 --offline`. Do not uninstall or clear app data to fix a server connection. Schema v2 migrates the existing ledger atomically; this development migration has no downgrade path.

Build scripts explicitly select their variant and disable Expo CLI telemetry. Development uses the separate `org.sallimanager.app.dev` identifier and permits Metro networking. The release identifier is provisionally `org.sallimanager.app`; confirm it before public distribution. Do not reuse development-generated native settings for an offline release: run `npm run prebuild:release` before building and inspect the resulting manifest. Regenerate with `npm run prebuild:development` when switching back. No signed release has been produced.

Proposed financial policies and unresolved platform limits are called out in the architecture. Contributions must keep calculations in integer minor units, preserve transfer and budget semantics, avoid sensitive fixtures/logs and include meaningful tests for financial, parsing and security behavior. Contribution and private vulnerability-reporting procedures will be added before public release. Commits and pushes require the project owner's approval.

## License

[Apache License 2.0](LICENSE).
