# Phase 3: spending budgets

Approved scope: implement the complete feature incrementally, beginning with pure domain behavior. Financial entry and persistence must wait for the outstanding SQLCipher, Keystore and authenticated-session gates. No commits or pushes are authorized for this phase.

## Agreed policies

- Card budgets, overall budgets and category budgets are independent guardrails. Never sum overlapping guardrails into a purported total. Each budget has one currency; there is no implicit currency conversion. Bank credit limits and statement settings belong to a separate card profile and never constrain the spending allowance.
- Allow zero allowances. Money is integer minor units, checked for overflow. A rollover-enabled base must also fit safely when doubled for its maximum capped carry, preventing an accepted configuration from making a future period unreadable. Repayments, income and opening balances do not consume or reset budgets.
- Support calendar months, Monday-start weeks for overall/category scopes, billing cycles for cards, explicit one-off inclusive dates, and repeating N-calendar-day periods anchored to a start date. Stored boundaries are half-open `[start,end)`. Closing day belongs to the ending cycle; independently clamp days 29–31 each month. The default financial zone is Asia/Colombo; preserve the saved zone and historical boundaries when the device zone changes.
- A new recurring budget created midperiod starts with the full current period and full allowance, including existing spending in that period. A future custom period is previewed but not issued early.
- Amount, cadence, closing-day and rollover edits take effect next period. Preserve revision history; the latest pending revision wins. A short transition ending at a new cadence boundary receives `floor(new allowance × transition days / normal new-period days)`. Repeating cadence changes anchor to the old period's end. A one-off budget has no successor.
- Rollover defaults off. If enabled, carry unused effective allowance, capped at the next period's base allowance; never carry overspending debt. Freeze an issued incoming rollover. Late corrections recalculate historical usage and show the difference without silently changing later issued allowances.
- Derive budget activity from canonical transactions rather than maintaining another ledger. Pending purchases reserve allowance; confirmation replaces that reservation; reversals release it. Linked refunds count on their effective date, retaining original account/category attribution. Credits without a valid original purchase go to review and receive no budget credit. Cumulative category refunds cannot exceed their original charge allocation.
- Seed Uncategorized, groceries, transport, dining, shopping and utilities. Manual expenses may specify a category; legacy expenses default to Uncategorized. Validate exact allocation totals now; split-editing UI remains Phase 7.
- Show posted spending, pending reservations, refunds, net usage, remaining amount, overspending and daily allowance. Daily allowance is `floor(max(0,remaining) / remaining calendar days including today)` only for an active period. Zero allowances never divide by zero.
- Default thresholds: 50/75/90/100; configurable unique integers from 1 through 100. Use integer comparisons. Emit once per period/threshold, consolidate simultaneous crossings, and do not repeat after refund/re-spending. Baseline settings changes without retroactive alert floods. Native notifications remain Phase 9.
- Materialize on reads/resume, without relying on background timers. Catch up in bounded batches. The eventual encrypted repository must atomically save period snapshots and threshold keys before publishing in-app signals. Unique `(budget_id,start_date)` and `(period_id,threshold)` keys prevent replay races.

## Delivery and acceptance

| Slice | Implementation | Acceptance |
| --- | --- | --- |
| Calendar engine | `calendarMath.ts`, `periods.ts` | Leap years, Monday boundaries, month/year crossings, clamped closing days, custom periods, explicit timezone |
| Usage projection | `activity.ts`, `usage.ts`, manual-ledger category adapter | Transfers excluded, pending replacement, voids, linked/over-refunds, exact allocations, currency and scope separation, overflow rejection |
| History and policy | `budget.ts`, `history.ts`, `thresholds.ts`, `refresh.ts` | Next-period edits, proration, capped rollover, frozen issued history, late corrections, bounded resume/replay, consolidated deduplicated thresholds |
| Security prerequisite | Local `finance-vault` Kotlin module, SQLCipher connection and synthetic development probe | Actual Android authentication/cancellation and credential fallback; copied database unreadable without key; fail closed without cipher/wrong key; key loss/invalidation; lifecycle/deep-link locking |
| Durable integration | Encrypted account/ledger prerequisites, versioned budget migrations and focused repositories | Atomic revision/snapshot/threshold writes; uniqueness and rollback; reopening retains history; locked operations rejected; no secret/log/devtools exposure |
| User workflows | Authenticated overview/create/edit/detail/history | Period previews, scheduled changes and proration, currency grouping, historical corrections, accessibility, manual use without SMS permission |

Full Phase 3 is complete only after both the domain suite and authenticated encrypted user workflows pass. A synthetic encryption probe alone does not prove session locking, recovery or repositories.

## Current execution status

The calendar, usage, history and refresh domain slices, encrypted repositories and protected budget screens are implemented for development validation. Card bank settings are separate from budget entities. The owner confirmed native startup, the locked screen and authenticated unlock on the API 34 phone. Remaining negative-key and cancellation probes need native confirmation. Full updated-build workflow/session acceptance is pending; use disposable synthetic records. See `DEVELOPMENT.md` and `PHASE3_TESTING.md` for current evidence and remaining native gates.

`refreshBudget` is pure: supply definitions, canonical activities, previously issued periods and threshold state. Save returned state in one authenticated transaction before showing signals. Its `catchUpPending` flag requires another bounded refresh before declaring the current period ready. Caller-supplied current-period edits must match calculated boundaries. Nothing in this API authenticates a caller or supplies durable storage.

Native verification must cover: authenticate using both offered paths, cancel, relaunch/reopen, wait beyond the five-second Keystore authorization window, background during unlock, lock/deep-link races, missing envelope/alias and credential changes. Tests that remove credentials/keys use disposable test installations only and require explicit agreement before destructive device changes.

## Compatibility notes

No new dependency is needed for budget arithmetic. It uses the existing strict TypeScript and Jest toolchain. SQLCipher is added through `expo-sqlite` **58.0.17**, the version listed in the installed Expo 58 native-module map. Its `useSQLCipher` config requires prebuild and a new development binary; Expo Go and the old shell binary cannot run the probe. Native key access uses Android platform AES-GCM and Keystore APIs through a local Expo module, with no custom cryptographic primitive.

The [Expo SQLite documentation](https://docs.expo.dev/versions/latest/sdk/sqlite/) warns that a missing SQLCipher implementation silently ignores `PRAGMA key`; the connection therefore checks `cipher_version` before touching schema. Dedicated connections avoid Expo's database inspector. The [Android authentication guide](https://developer.android.com/identity/sign-in/biometric-auth) describes timed Keystore authorization with strong biometrics or device credentials. The module uses a five-second authorization window, always requests a system prompt for unlock, and uses device credentials on API 24–29. API 30+ offers strong biometric/device credential selection. Those older-device paths still need device evidence.

The wrapping key stays in Android Keystore; its AES-GCM envelope is in the no-backup directory. A transient hexadecimal database key crosses the Expo SQLite JS/native boundary. It is never persisted/logged in JS; JavaScript strings cannot guarantee memory zeroization. A native-only database handoff remains an architectural hardening question rather than a claimed property of this probe. The only added permission is `USE_BIOMETRIC`; no SMS, storage, notification or release internet permission is introduced.
