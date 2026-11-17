# Phase 4 verification

Use only invented records until acceptance is complete. Never paste message bodies, financial records, keys or credentials into reports. No app uninstall/data clearing is needed. Phase 3 functionality was accepted by the owner; the new native code requires fresh evidence.

## Evidence

| Check | Current evidence |
| --- | --- |
| Strict TypeScript | Passed locally |
| Release public configuration | Passed locally; not merged-manifest proof |
| Android production JS export | Passed locally; stale cache automatically rebuilt |
| Jest | 317 tests across 16 suites passed locally, including stale/malformed native-status rejection |
| Kotlin JVM checks | Added, not run |
| Native APK / WorkManager integration | Owner build pending |
| Cipher/Keystore/session/background probes | New Phase 4 checks pending |
| New merged release manifest / offline runtime | Pending; previous phase's pass does not apply |
| Remote CI | Workflow defined, not pushed/run |

The owner built an intermediate native version and reported a Bank SMS screen crash because newer Metro code expected `blockedIds` from the older APK. The screen now handles the missing field safely, and a versioned native-status guard rejects stale builds before SMS security actions. Rebuild the latest native code; no data clearing is required. Old verification flags do not satisfy the new combined crypto/authorization gate.

Tests use real in-memory ordinary SQLite for migration/transaction behavior. They do not prove SQLCipher or Android reliability. Parser fixtures invent all amounts, identifiers, merchants and dates independently of private samples.

## Build with your own Metro terminal

Keep your existing working Metro on 8107 open. After all native edits are complete, run in a second PowerShell terminal:

```powershell
Set-Location D:\dev\salli-manager
npm run prebuild:development
npm run android -- --no-bundler
adb reverse tcp:8107 tcp:8107
adb shell am start -a android.intent.action.VIEW -d "exp+salli-manager://?__expo_url=http%3A%2F%2F127.0.0.1%3A8107" org.sallimanager.app.dev
```

When Metro needs starting, use a separate terminal:

```powershell
npm start -- --port 8107 --clear --max-workers 2 --offline
```

Use **Salli Manager Dev**, never Expo Go. `--port` and `--no-bundler` cannot be combined. Do not start a second Metro on the same project/port. Gradle may download WorkManager during the first native build; offline runtime is a separate requirement.

Run the native JVM checks without starting Metro:

```powershell
Push-Location android
.\gradlew.bat :finance-vault:testDebugUnitTest
Pop-Location
```

If Gradle/Kotlin fails, share only the first relevant error block. Never include real SMS/logcat message contents. Successful TypeScript export does not resolve a native compiler error.

## First synthetic walkthrough

1. Unlock. Verify existing accounts, transactions and budget history survived schema v2. Do not downgrade this development database to an older app.
2. Create a disposable **Test HNB card**, LKR, opening zero and a monthly LKR 100 spending budget. Open **More → Bank SMS and import review**. Live capture must initially show disabled.
3. Choose **Set up encrypted SMS inbox (authenticate)**. Setup locks/unlocks the vault; navigate back to Bank SMS afterward if authentication returned you to Home. If setup fails because the five-second authorization expired, retry fresh authentication. An existing unavailable key must never be replaced.
4. Run **native inbox encryption checks**. Wait at least six seconds without a new system unlock, then run **Test SMS Keystore lock after 6 seconds**. The combined encryption status must report PASS before capture is available. Cancel an unlock once and confirm that the vault stays locked.
5. Confirm the public sender **HNB** and map bank HNB / last four **4826** to the disposable test card. Leave SMS permissions denied for this fixture-only test.
6. Tap **Queue synthetic HNB purchase** once. The fixed native fixture is Cedar Grocery, LKR 23.75, today. It should become one pending expense, reserve LKR 23.75 / leave LKR 76.25 of the budget, and leave the posted card balance zero.
7. Queue the fixture again. It must enter possible-duplicate review without another financial effect. Dismiss or attach it to the existing expense. To verify genuine repeated purchases, explicitly create a separate transaction from review; both must remain distinguishable.
8. From Transactions, correct the first SMS expense's amount/date/category using invented values and save as confirmed. Posted balance should change once. Original structured SMS evidence and encrypted edit history must remain; replay must not overwrite corrections.
9. Queue a fixture with **in 10 seconds**, then background the app immediately. Reopen after ten seconds and authenticate. The fixed record should drain from the encrypted inbox; while locked, no financial screen must appear. This helper requires the process to remain alive and does not test Android broadcast/force-stop behavior.
10. Test a duplicate suffix mapping, an unconfirmed sender and a currency mismatch: each must require review. Remove extra mappings afterward. For repayment/refund/reversal tests, use synthetic repository fixtures or controlled native test SMS only; never invent a paying account or original purchase automatically.

## History and permission acceptance

- RECEIVE_SMS is optional for live capture; READ_SMS is a separate history action. Deny/cancel/revoke each permission and confirm manual finance still works. A permission dialog can background/lock the vault; authenticate again before enabling. Hard-restricted installer allowlisting must be checked on intended install channels. Do not seek broader permissions or the default-SMS role as a workaround.
- Use an isolated emulator/test inbox with synthetic financial messages for provider tests. Choose explicit dates, scan, and verify no financial effects before preview acceptance. Verify wrong/missing amounts/dates, unknown formats, bank/suffix collisions and currency mismatches remain review-only.
- With more than 50 candidates, commit, pause and resume. Counts must match completed chunks; uncommitted work needs a fresh preview after lock/relaunch. A ledger correction between preview and commit must reject the stale preview. Expired/discarded staging must not erase completed transactions/provenance.
- Import overlapping ranges and replay source IDs. No exact replay may create another expense. Changed provider content must preserve the original decision and create a review item. Similarity across live/provider observations must require review, not erase genuine equal purchases.
- Confirm historical purchases reserve budgets but do not flood old threshold alerts. Repayments do not reset usage; partial refunds cannot exceed the posted original, and reversal must not double-credit a refunded original.

## Native/release gates still required

- On minimum API 24, target API 36 and the connected API 34 phone: authenticated/cancelled/forged/stale handles; correct/wrong/no-key reads; private-key clearing and in-flight lock races; key loss/invalidation fails closed without replacing existing data.
- Inspect synthetic-only native inbox/SQLite sidecars/logs: no source text, identifiers or keys outside encrypted files; WorkManager data/tags contain no financial payload. Check actual GCM ciphertext tampering, malformed/truncated/oversized envelope and queue recovery behavior.
- Verify protected SMS broadcast delivery, multipart ordering/sender consistency, 20-part/8-KiB rejection, OTP/number redaction, capacity/gap accounting, seven-day expiry and permission revocation. Fixed fixture helpers do not establish these.
- Verify OS delivery while locked/process absent, post-unlock drain, commit/ack crash replay, reboot before/after first unlock, force-stop and OEM battery limits. Document capture gaps; do not promise guaranteed background delivery.
- Generate the release native project, compile/process its manifest, and run the privacy guard. Check no INTERNET/OTA, exported receiver permission, default-disabled capture, backup exclusions and no network/foreground-service permissions. Cold-start a release build in airplane mode without Metro. Regenerate the development variant afterward; never reinstall a different package over financial data to bypass a failure.

Report PASS/failure codes and device/API/build identifiers only. Keep all unresolved gates open; this development feature is not production acceptance.
