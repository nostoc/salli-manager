# Phase 4 — approved implementation plan

The owner accepted the Phase 3 functional workflows and approved the full Phase 4 plan on 17 November 2026. This document records decisions, not completed verification. Preserve existing uncommitted work; no commits or pushes are authorized. The owner runs Metro and Android builds.

## Delivery

Implementation note: the two Expo native modules share `modules/finance-vault/android` and its process-local session instead of creating mutually dependent Android libraries. This preserves the Kotlin/JS boundaries with fewer build dependencies. See PHASE4_TESTING.md for executed checks and open native acceptance gates; code presence is not a native verification claim.

The native SMS bridge uses an explicit API version. Increment it with any incompatible required field/method/security-contract change, update its TypeScript guard and rebuild the native app; Metro reload alone cannot update Kotlin.

1. Canonical transaction lifecycle, encrypted schema v2 migration, source observations, account instruments and review/import contracts.
2. Native capture/security gate: authenticated session handles, public-key encrypted inbox, bounded receiver, ciphertext-only WorkManager housekeeping and permission controls.
3. Independent HNB, Commercial, Sampath and BoC parser slices with synthetic fixtures.
4. Foreground ingestion, conservative matching, review/corrections, source acknowledgement, balances and budgets.
5. Historical scan/preview/resumable import, acceptance checks, CI and documentation.

## Locked decisions

- Sender seeds: HNB=`HNB`, Commercial credit/debit=`COMBANK`, Sampath credit=`SAMPCCTXN`, BoC=`BOC`. Confirm sender/account mappings before automatic entry. Sender IDs are hints, not bank authentication.
- Complete, supported and unambiguous purchases become pending expenses automatically. They reserve budget capacity but do not change posted balances. Estimates stay explicitly estimated.
- Card repayments remain review candidates without financial effects until both accounts are known. Never invent an external payer or classify repayments as income/expense.
- Missing full dates/years require review. For DD/MM/YY, accept only one matching calendar date in the interval from receipt minus 366 days through receipt plus one day. Preserve original precision and century-resolution provenance.
- Process eligible messages during an active authenticated foreground session; capture only encrypted content while locked. Private inbox decryption material lives only in native session memory and is cleared on lock/background/process death.
- Sanitize before persistence/bridge delivery. Reject OTP/authentication/unrelated content. Keep unresolved sanitized text for seven days from first intake; delete immediately on resolution. Never extend retention through retries.
- History: default last 30 days, explicit range, preview before financial effects, commits of 50 items per atomic transaction. Cancellation/locking keeps completed batches and pauses the rest. Baseline historical thresholds to avoid old-alert floods.
- Exact source replay is a no-op. Similar fingerprints/amounts/dates are review evidence, never global unique transaction keys. Preserve genuine equal purchases and user corrections.
- Refunds require valid original links and remaining refundable amounts; reversals must not duplicate credits. Unsupported templates remain review-only, including unverified refund/reversal/decline variants.

## Security and limits

Use platform RSA-3072 OAEP with explicit SHA-256/MGF1-SHA-256 to wrap fresh AES-256-GCM envelope keys. Wrap the software RSA private key at rest using a separate authenticated Android Keystore AES key; the Keystore wrapping key is non-exportable, while the unwrapped RSA private key is a native-memory session secret, never JavaScript data. Native session handles are generation-bound and activated only after authenticated database initialization. No worker can decrypt the inbox or open the ledger.

Receiver limits: 20 parts, 8 KiB decoded UTF-8. Native backlog: 1,000 files or 16 MiB. At capacity reject new captures with a visible aggregate gap warning; do not silently evict unprocessed files. Use no-backup storage, opaque filenames, bounded envelope validation and explicit recovery on key loss. WorkManager 2.12.0 performs ciphertext housekeeping only. Request RECEIVE_SMS for opt-in live capture and READ_SMS separately for historical import; installer restrictions must be tested. No release INTERNET, broad storage, default-SMS role, SEND_SMS, contacts, phone-state, notification or foreground-service permission.

## Acceptance

Migration must preserve existing IDs, balances, manual transactions and issued budget history, and roll back atomically on failure. Test all sample format families with independently synthetic data; dates, amounts, malformed balances, suffix collisions, unsupported currency and uncertain input. Test exact replay, ambiguous matches, equal genuine purchases, source changes, user overrides, commit/ack crashes, historical cancellation/resume and refund/reversal/repayment budget effects.

Native verification must cover ordinary/wrong/no-key reads, encrypted inbox files, background/session races, private-key clearing, OTP/full-number stripping, multipart messages, permission denial/revocation, queue expiry/capacity, process death, reboot and force-stop limitations. Verify minimum/target Android APIs plus the connected phone, merged release permissions and offline cold-start. Leave capture disabled if native gates fail; never weaken authentication or fall back to plaintext. Statements, native notifications and advanced categorization remain later phases.
