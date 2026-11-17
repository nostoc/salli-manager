import { addMoney, createMoney, readMoney, subtractMoney } from '@/core/money/money';
import type { LedgerAccount } from '@/features/accounts/domain/account';
import type { BudgetActivity } from '@/features/budgets/domain/activity';
import { createManualEntry, projectManualLedger, type ManualEntryDraft } from './manualLedger';
import { UNCATEGORIZED } from './categories';

type RefundDraft = Readonly<{ id: string; kind: 'refund'; accountId: string; originalExpenseId: string; date: string; amount: ReturnType<typeof readMoney> }>;
export type TransactionDraft = ManualEntryDraft | RefundDraft;
export type LedgerTransaction = TransactionDraft & Readonly<{
  status: 'pending' | 'confirmed' | 'reconciled'; voided: boolean; origin: 'manual' | 'sms';
  merchant: string | null; estimated: boolean;
}>;

export class TransactionError extends Error {
  constructor(readonly code: string) { super('Invalid transaction or lifecycle change.'); this.name = 'TransactionError'; }
}

export function createTransaction(accounts: readonly LedgerAccount[], input: TransactionDraft & Partial<Pick<LedgerTransaction,
  'status' | 'voided' | 'origin' | 'merchant' | 'estimated'>>, historical = false): LedgerTransaction {
  if (!input || typeof input !== 'object') throw new TransactionError('invalid_transaction');
  const status = input.status ?? 'confirmed';
  const voided = input.voided ?? false;
  const origin = input.origin ?? 'manual';
  const estimated = input.estimated ?? false;
  if (!['pending', 'confirmed', 'reconciled'].includes(status) || typeof voided !== 'boolean' ||
      !['manual', 'sms'].includes(origin) || typeof estimated !== 'boolean' || (status === 'pending' && input.kind !== 'expense') ||
      (estimated && (input.kind !== 'expense' || status !== 'pending'))) throw new TransactionError('invalid_lifecycle');
  const merchant = input.merchant ?? null;
  if (merchant !== null && (typeof merchant !== 'string' || merchant.length > 160 || /[\u0000-\u001f]|\d(?:[ -]?\d){6,}/.test(merchant))) {
    throw new TransactionError('invalid_merchant');
  }
  const available = historical ? accounts.map((account) => ({ ...account, archived: false })) : accounts;
  const legacy = createManualEntry(available, input.kind === 'refund' ? { ...input, kind: 'income' } : input);
  const fields = { id: legacy.id, date: legacy.date, amount: legacy.amount, status, voided, origin, merchant, estimated };
  if (input.kind === 'refund') {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.originalExpenseId) || input.originalExpenseId === input.id) throw new TransactionError('invalid_refund');
    return Object.freeze({ ...fields, kind: 'refund', accountId: input.accountId, originalExpenseId: input.originalExpenseId });
  }
  if (legacy.kind === 'transfer') return Object.freeze({ ...fields, kind: legacy.kind, fromAccountId: legacy.fromAccountId, toAccountId: legacy.toAccountId });
  if (legacy.kind === 'expense') return Object.freeze({ ...fields, kind: legacy.kind, accountId: legacy.accountId, categoryId: legacy.categoryId ?? UNCATEGORIZED });
  return Object.freeze({ ...fields, kind: legacy.kind, accountId: legacy.accountId });
}

export function projectLedger(accounts: readonly LedgerAccount[], input: readonly LedgerTransaction[]) {
  const entries = input.map((entry) => createTransaction(accounts, entry, true));
  const ids = new Set<string>();
  const index = new Map(entries.map((entry) => [entry.id, entry]));
  const refunded = new Map<string, number>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new TransactionError('duplicate_transaction');
    ids.add(entry.id);
    if (entry.kind !== 'refund' || entry.voided) continue;
    const original = index.get(entry.originalExpenseId);
    if (!original || original.kind !== 'expense' || original.voided || original.status === 'pending' ||
        original.accountId !== entry.accountId || original.amount.currency !== entry.amount.currency || entry.date < original.date) throw new TransactionError('invalid_refund_link');
    const total = addMoney(createMoney(refunded.get(original.id) ?? 0, entry.amount.currency), entry.amount).minorUnits;
    if (total > original.amount.minorUnits) throw new TransactionError('over_refund');
    refunded.set(original.id, total);
  }
  const posted = entries.filter((entry) => !entry.voided && entry.status !== 'pending');
  const projection = projectManualLedger(accounts, posted.map((entry) => entry.kind === 'refund' ? { ...entry, kind: 'income' as const } : entry));
  // Every supported spending view must remain representable, including an
  // overall budget combining confirmed expenses and pending reservations.
  for (const currency of new Set(accounts.map((account) => account.currency))) {
    entries.filter((entry) => entry.kind === 'expense' && !entry.voided && entry.amount.currency === currency)
      .reduce((sum, entry) => addMoney(sum, entry.amount), createMoney(0, currency));
  }
  const totals = projection.totals.map((total) => {
    let refunds = createMoney(0, total.currency);
    for (const entry of posted) if (entry.kind === 'refund' && entry.amount.currency === total.currency) refunds = addMoney(refunds, entry.amount);
    return Object.freeze({ ...total, income: subtractMoney(total.income, refunds), expenses: subtractMoney(total.expenses, refunds) });
  });
  const pending = accounts.map((account) => Object.freeze({ accountId: account.id,
    amount: entries.filter((entry) => entry.kind === 'expense' && entry.accountId === account.id && entry.status === 'pending' && !entry.voided)
      .reduce((sum, entry) => addMoney(sum, entry.amount), createMoney(0, account.currency)) }));
  return Object.freeze({ ...projection, totals: Object.freeze(totals), pending: Object.freeze(pending) });
}

export function ledgerBudgetActivity(accounts: readonly LedgerAccount[], entries: readonly LedgerTransaction[]): readonly BudgetActivity[] {
  projectLedger(accounts, entries);
  const index = new Map(entries.map((entry) => [entry.id, entry]));
  const activities: BudgetActivity[] = [];
  for (const entry of entries) {
    if (entry.kind === 'expense') activities.push(Object.freeze({ id: entry.id, kind: 'expense', accountId: entry.accountId,
      amount: entry.amount, date: entry.date, status: entry.status, voided: entry.voided,
      allocations: Object.freeze([{ categoryId: entry.categoryId ?? UNCATEGORIZED, amount: entry.amount }]) }));
    if (entry.kind === 'refund' && !entry.voided && entry.status !== 'pending') {
      const original = index.get(entry.originalExpenseId);
      if (!original || original.kind !== 'expense') throw new TransactionError('invalid_refund_link');
      activities.push(Object.freeze({ id: entry.id, kind: 'refund', accountId: entry.accountId, amount: entry.amount, date: entry.date,
        status: entry.status, originalExpenseId: original.id,
        allocations: Object.freeze([{ categoryId: original.categoryId ?? UNCATEGORIZED, amount: entry.amount }]) }));
    }
  }
  return Object.freeze(activities);
}
