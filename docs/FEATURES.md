# Product feature catalogue

Status: full product scope approved on 17 November 2026; implementation starts with the navigation foundation, while financial features remain planned. Source: `Expense_Tracker_Feature_Catalogue.docx`, version 1.0, 17 November 2026. This document preserves all thirteen catalogue areas and navigation. Engineering rules below clarify the requested behavior; detailed policies are documented in the architecture.

Build a privacy-first, open-source Android application for individual personal finances. Initial banks are Bank of Ceylon (BoC), Sampath Bank, Hatton National Bank (HNB) and Commercial Bank of Ceylon. LKR is the default currency, with multiple currencies supported. No backend, registration, mandatory cloud services or shared household accounts.

## F01 Account management

- Multiple credit cards across banks, savings/current bank accounts and cash accounts.
- Custom names, colours and icons; opening balances and balance history.
- Archive accounts while retaining historical records.
- Account currencies and multi-currency support, defaulting to LKR.

## F02 Automated transaction tracking

- Incoming bank SMS detection and optional historical SMS import.
- Identify bank, account and merchant; automatically categorize transactions.
- Duplicate detection and a review queue for unrecognized or ambiguous transactions.
- Manual corrections to detected transactions; refund, reversal and internal transfer detection.
- Separate extensible parser modules for BoC, Sampath, HNB and Commercial Bank, with future bank additions possible.

## F03 Credit card management

- Per-card dashboard with credit limit, available credit, outstanding balance and unbilled transactions.
- Statement balance, minimum payment, billing cycle and due date.
- Full and partial settlement tracking, credit utilization and installment plans.
- Annual fees, interest and other charges.
- Statement history and card-specific spending analytics.

## F04 Budget management

- A separate personal spending budget for each credit card, independent of its credit limit. For example, a synthetic LKR 100,000 limit and LKR 35,000 budget are separate settings.
- Card budget periods: calendar month, billing cycle or custom period; automatic transition to the next period without erasing history.
- Configurable threshold alerts, including 50%, 75%, 90% and 100%.
- Utilization, remaining budget, remaining daily allowance, history and planned versus actual comparisons.
- Overall monthly expense budgets across accounts and category budgets, including groceries, transport, dining, shopping and utilities.
- Weekly, monthly and custom periods for overall/category budgets, optional unused-budget rollover, overspending detection and performance history.
- Repayments are transfers, never new expenses, and never reset spending budgets.

## F05 Transaction management

- Add, edit and delete; search, filter and sort transaction history.
- Expense, income and transfer types; splits across categories.
- Custom tags, notes and receipt attachments.
- Recurring transactions, bulk categorization and user-defined merchant categorization rules.
- Change tracking and transaction history; pending, confirmed and reconciled statuses.

## F06 Statements and reconciliation

- Import PDF and CSV statements, including password-protected PDFs with passwords entered and used locally.
- Bank-specific parsers and automatic transaction extraction.
- Match statement rows to SMS-created transactions without double counting.
- Detect missing and duplicate transactions; reconcile balances and track statement payment status.
- Retain historical statements for each account.

## F07 Analytics and reporting

- Daily, weekly, monthly and annual spending; financial year and custom date ranges.
- Category breakdowns and trends; spending by account, card and merchant.
- Income versus expenses, cash flow and budget versus actual expenses.
- Credit utilization trends and net worth tracking.

## F08 Bills subscriptions and reminders

- Card payment and statement-generation reminders, budget threshold alerts and bill reminders.
- Recurring subscription detection, renewal and installment reminders.
- Calendar of upcoming obligations and configurable local notifications.

## F09 Savings and financial planning

- Savings goals, emergency funds, contributions and monthly savings targets.
- Savings rate analysis and upcoming expense planning.
- Estimated end-of-month spending and available spending after reserving upcoming payments.

## F10 Security and privacy

- Encrypted local database and secure key management.
- Biometric or device credential authentication and automatic locking.
- Offline operation, no mandatory cloud storage, no ads, analytics or tracking SDKs.
- Never collect/store banking credentials, full card numbers, CVVs, PINs or OTPs.
- Configurable screenshot protection, masked sensitive notification content and an option to hide amounts.
- Filter OTPs/unrelated SMS and minimize retained message content.
- Complete local deletion, transparent permissions, encrypted backups and restoration.

## F11 Data import and export

- CSV transaction exports, JSON exports and PDF financial reports.
- Encrypted full backups, restoration and device migration.
- Import from other expense trackers where supported; selective exports by account/date range.

## F12 Personalization and accessibility

- Light, dark and system themes; custom categories, icons and colours.
- Configurable dashboard widgets and currency/date format preferences.
- English, Sinhala and Tamil; accessible typography and contrast.
- Hide sensitive financial amounts.

## F13 Open-source development and distribution

- Modular parsers, sanitized SMS/statement fixtures and automated unit/integration tests.
- Contribution guidelines, a public threat model and vulnerability reporting policy.
- Dependency security scanning, signed APKs and reproducible builds where practical.
- F-Droid distribution, subject to its inclusion/build review.

## Navigation

| Tab | Content |
| --- | --- |
| Home | Financial overview, upcoming payments, recent transactions |
| Transactions | History, filters, manual entry |
| Accounts | Credit cards, bank accounts, cash |
| Budgets | Overall, per-card and category budgets |
| More | Reports, statements, savings, subscriptions, security, settings |

## Cross-cutting acceptance rules

- Persist monetary values as integer minor units plus currency; balances, budgets and reports follow the same rule.
- A repayment must not increase expenses or restore budget capacity, whether detected from a card SMS, bank debit or statement. Represent a single economic transfer across its observations.
- Reimporting the same source must not create another transaction. Ambiguous matches require review; repeated equal-value purchases must remain distinguishable.
- Missing or approximate SMS fields remain explicitly uncertain. Users can correct records without losing provenance.
- Core manual workflows remain functional without SMS permission and without internet access.
- Later phases are still committed product scope; see `DEVELOPMENT.md` for sequencing and acceptance gates.
