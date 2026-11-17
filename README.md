# Salli Manager

A planned open-source, privacy-first Android personal finance and expense tracker, focused on credit cards, budgets and statement reconciliation. It will detect transactions from bank SMS and keep financial processing on the device.

The architecture and roadmap were approved on 17 November 2026. Phase 1 is starting with an Android navigation shell; bank integrations and financial storage are not implemented. The goal is the complete product described in the feature catalogue, delivered through independently testable increments.

## Planned capabilities

- Multiple credit cards, bank and cash accounts; LKR by default with multiple currencies.
- Local SMS detection for Bank of Ceylon, Sampath Bank, HNB and Commercial Bank of Ceylon, plus manual entry and statement imports.
- Personal card budgets independent of credit limits, including calendar-month and billing-cycle periods.
- Repayments recorded as transfers; payments never reset spending budgets.
- SMS/statement duplicate prevention, reconciliation, reports, reminders, savings planning and encrypted backup/restore.
- English, Sinhala and Tamil, accessible interfaces and configurable privacy controls.

## Privacy principles

No backend, mandatory cloud service, registration, ads, analytics, tracking or cloud AI. Financial data stays local and is encrypted with Keystore-protected keys. No banking credentials, full card numbers, PINs, CVVs or OTPs may be stored. The offline release is intended to omit internet permission and bundle all required assets.

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

The supplied `Expense_Tracker_Feature_Catalogue.docx` and `sample-msges.txt` are planning inputs. Source messages are not public test fixtures; independently synthetic inputs will be used for development. No statement samples or sender metadata have been supplied.

## Development status

The initial shell provides the five navigation tabs and a system light/dark theme. It does not collect SMS, request financial permissions or persist financial records. Native encryption, authenticated key access and SMS capture remain subsequent feasibility slices.

Use Node 24.22.2, npm 11.2.0, JDK 17, Android SDK platform 37, build tools 37.0.0 and NDK 27.1.12297006 for the verified toolchain. Install dependencies using `npm ci`. Run `npm run prebuild:development`, then `npm run android` to build/install the development application locally. Use `npm start` to start Metro for a development client. An Android emulator or USB-debugging device is needed to run it. No Expo account or EAS service is required.

Run `npm run typecheck`, `npm run check:config` and `npm run export:android` for the initial shell checks. The configuration check covers declared release settings; it does not prove the final merged manifest, runtime offline behavior or encryption. Financial and native security tests will arrive with those features.

Verified: strict TypeScript, Android bundle export, x86_64 development compilation, Expo Doctor (20/20), zero known npm audit findings and merged release-manifest privacy checks. The user has confirmed that the development shell works. Run `npm run check:manifest -- <merged-release-AndroidManifest.xml>` to check a freshly generated release manifest. See the [recorded build evidence and remaining gates](docs/DEVELOPMENT.md#phase-1-first-slice-status). Encryption and SMS processing are not implemented.

Build scripts explicitly select their variant and disable Expo CLI telemetry. Development uses the separate `org.sallimanager.app.dev` identifier and permits Metro networking. The release identifier is provisionally `org.sallimanager.app`; confirm it before public distribution. Do not reuse development-generated native settings for an offline release: run `npm run prebuild:release` before building and inspect the resulting manifest. Regenerate with `npm run prebuild:development` when switching back. No signed release has been produced.

Proposed financial policies and unresolved platform limits are called out in the architecture. Contributions must keep calculations in integer minor units, preserve transfer and budget semantics, avoid sensitive fixtures/logs and include meaningful tests for financial, parsing and security behavior. Contribution and private vulnerability-reporting procedures will be added before public release. Commits and pushes require the project owner's approval.

## License

[Apache License 2.0](LICENSE).
