# Phase 3 device checks

Use disposable synthetic accounts and amounts only. This is a development build; portable encrypted backup/recovery is not implemented. Never enter real identifiers, banking credentials, PINs or OTPs into the app or report them in chat. Android authentication prompts are handled privately on the device.

Use the installed **Salli Manager Dev** application. Expo Go cannot run these tests. `npm run android` builds/installs the native client; `npm start` serves its JavaScript. `npm run prebuild:development` alone does not install a new APK. The current working USB session uses Metro port 8107. The recent-devices cache repair affected only ignored development metadata on the laptop, not the phone's financial database or keys.

## Verified prerequisite

Confirmed by the owner in the installed native app: the locked screen appears and Android authentication successfully unlocks the application. The native foreground callback now dispatches screenshot protection to Android's UI thread. This resolves the earlier `Expected: main Calling: mqt_v_js` startup failure. This confirmation does not establish every negative-key, cancellation, recovery or budget-workflow check below.

For subsequent development sessions, stop the diagnostic server and run the normal launcher without the inspector:

```powershell
npm start -- --port 8107 --clear --max-workers 2 --offline
```

Keep that terminal open. The launcher now runs Expo in the same process so terminal signals are handled directly. Its help/argument dispatch, JavaScript syntax and release-config checks pass; normal start/stop behavior should also be confirmed on the next user-run session. Do not combine `--port` with `--no-bundler` when invoking `npm run android`.

The initial PASS report is provisional because the later troubleshooting session identified an Expo Go launch. Repeat strong biometric/device unlock, explicit credential fallback, correct-key reopen, wrong/no-key rejection, ordinary Android SQLite rejection, encrypted file header, expired key authorization and cancellation in the installed Salli Manager Dev app. Only that native runtime can establish these controls; Expo Go cannot. This is not evidence for other devices, credential-change recovery or a security audit.

The development-only synthetic probe remains accessible from **Development security checks** on the locked screen. It uses `security-probe.db`, not the financial ledger. Its key envelope is protected by an authenticated Android Keystore key in no-backup storage. No tests deliberately remove the real device credential or erase keys.

## Session and persistence

1. Open Salli Manager Dev. It must show the locked screen, including when launched through a budget deep link. Cancel unlock: no account, transaction or budget data should appear.
2. Unlock. Create the synthetic records below. Press Home or switch apps; return: the vault must be locked. Unlock: records should remain unchanged.
3. Choose More → Lock now. Reopening a tab/deep link must not bypass it. Wait three minutes without interaction: it must lock and clear the protected screens.
4. Force-stop and reopen the app, then unlock. Recheck account balances, budget periods and scheduled edits. No new setup, silent reset or duplicate periods/alerts should occur.
5. Rotate/background during unlock and while saving. The UI must conceal data immediately; interrupted transactions must either settle safely before lock or roll back. A cancelled attempt must not unlock later.

## Manual ledger and budget workflows

1. Accounts: create `Test bank` in LKR with opening balance **1000.00** and `Test card` with opening balance **0.00**, optional bank limit **5000.00**, closing day **31**. No full instrument numbers are needed.
2. Budgets: create a calendar-month card budget **100.00**, an overall LKR budget **100.00**, and a groceries category budget **50.00**. Each is a separate guardrail; do not add them together. Current-period dates/full allowances and Asia/Colombo should be shown.
3. Transactions: add a card groceries expense **30.00** today. Card and overall remaining amounts must be **70.00**; groceries remaining must be **20.00**.
4. Add a **20.00** transfer from Test bank to Test card. Budget usage stays **30.00**. The bank balance becomes **980.00** and card liability **10.00**. No repayment expense is created.
5. Edit the card budget to **120.00** for the next period. The current allowance remains **100.00**; history and the scheduled effective date remain visible. Changing a budget must not change the bank credit limit.
6. Set that budget's thresholds to **25,75,100**. Existing 30% usage must not cause a retroactive 25% alert. Add a second expense **50.00**: usage becomes **80.00**; one new 75% crossing appears. Reopen/refresh/dismiss: the same crossing must not be created again. Other guardrails may independently reach their own thresholds.
7. Create a zero-allowance budget. Positive spending must show overspending without a divide-by-zero error. Upcoming/ended periods have no daily allowance.
8. Create a one-off budget with the same start and last included day. Both dates are included, and there is no successor. Try repeating N-day and Monday-week budgets. Billing-cycle closing days 29–31 clamp correctly in short months; the next month does not inherit February's shortened day.
9. Create a repeating **one-day** card budget starting yesterday, amount **10.00**, rollover on. If yesterday has no spending, today's issued allowance is **20.00** (base 10 + capped carry 10). Add a backdated **6.00** expense yesterday. Today's issued allowance must remain **20.00**; history shows the **6.00** usage correction and a **-6.00** recalculated-carry difference.
10. Create a USD account/budget and a USD expense. LKR views must not include it. Archive a budget: its history remains accessible and no new periods are issued.

Amount inputs use exact plain decimals without grouping separators/currency symbols. Invalid dates, excess precision, negative allowances, duplicate/out-of-range thresholds, invalid period lengths, unsafe amounts and full-number-like labels must fail without storing partial changes. Transactions require positive amounts; opening balances may be signed. Current manual UI creates confirmed entries; pending/refund/reversal adapters are tested domain contracts for later import lifecycle work.

## Automated checks

Run `npm run typecheck`, `npm test`, `npm run test:coverage`, `npm run check:config`, and `npm run export:android`. Tests use independently synthetic fixtures. Repository tests use actual in-memory SQLite for constraints/atomicity; they do not establish SQLCipher. Keystore/session tests use mocks for races; they do not replace the device checks above.

After `npm run prebuild:release`, build the merged release manifest and run `npm run check:manifest -- <path>`. It permits only USE_BIOMETRIC and the AndroidX private signature permission, rejects INTERNET/backup/debuggable/remote updates, and does not prove cold offline runtime. Restore the development native variant before the next development build. API 24–29 credential fallback, other ABIs/page sizes, key invalidation and recovery, accessibility review and offline release cold-start remain separate verification work.
