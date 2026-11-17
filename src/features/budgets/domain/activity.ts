import { requireCalendarDate } from '@/core/dates/calendarMath';
import { readMoney, sumMoney, type Money } from '@/core/money/money';
import { createLedgerAccount, type LedgerAccount } from '@/features/accounts/domain/account';
import { DEFAULT_CATEGORIES, UNCATEGORIZED } from '@/features/transactions/domain/categories';
import { createManualEntry, type ManualEntryDraft } from '@/features/transactions/domain/manualLedger';
import { BudgetError, requireBudgetId } from './budget';

export type CategoryAllocation = Readonly<{ categoryId: string; amount: Money }>;
export type BudgetActivity = Readonly<{
  id: string; accountId: string; date: string; amount: Money; allocations: readonly CategoryAllocation[];
}> & (
  | Readonly<{ kind: 'expense'; status: 'pending' | 'confirmed' | 'reconciled'; voided: boolean }>
  | Readonly<{ kind: 'refund'; status: 'confirmed' | 'reconciled'; originalExpenseId: string }>
);

// These are derived views of canonical transactions, not another durable ledger.
export function manualBudgetActivity(accounts: readonly LedgerAccount[], drafts: readonly ManualEntryDraft[]): readonly BudgetActivity[] {
  const historical = accounts.map((account) => ({ ...account, archived: false }));
  const ids = new Set<string>();
  const result: BudgetActivity[] = [];
  for (const draft of drafts) {
    const entry = createManualEntry(historical, draft);
    if (ids.has(entry.id)) throw new BudgetError('duplicate_activity');
    ids.add(entry.id);
    if (entry.kind !== 'expense') continue;
    const categoryId = entry.categoryId ?? UNCATEGORIZED;
    result.push(Object.freeze({ id: entry.id, kind: 'expense', accountId: entry.accountId, date: entry.date,
      amount: entry.amount, status: 'confirmed', voided: false,
      allocations: Object.freeze([Object.freeze({ categoryId, amount: entry.amount })]) }));
  }
  return Object.freeze(result);
}

export type ValidatedActivity = Readonly<{ activities: readonly BudgetActivity[]; reviewIds: readonly string[] }>;

export function validateBudgetActivity(input: readonly BudgetActivity[], accounts: readonly LedgerAccount[],
  categories: readonly Readonly<{ id: string }>[] = DEFAULT_CATEGORIES): ValidatedActivity {
  const index = new Map<string, LedgerAccount>();
  for (const item of accounts) {
    const account = createLedgerAccount(item);
    if (index.has(account.id)) throw new BudgetError('duplicate_account');
    index.set(account.id, account);
  }
  const categoryIds = new Set(categories.map((category) => category.id));
  const ids = new Set<string>();
  const validated: BudgetActivity[] = [];
  for (const item of input) {
    requireBudgetId(item.id);
    if (ids.has(item.id)) throw new BudgetError('duplicate_activity');
    ids.add(item.id);
    const account = index.get(item.accountId);
    const amount = readMoney(item.amount);
    requireCalendarDate(item.date);
    if (!account || amount.currency !== account.currency || amount.minorUnits <= 0) throw new BudgetError('invalid_activity');
    if (!Array.isArray(item.allocations) || item.allocations.length === 0) throw new BudgetError('invalid_allocations');
    const allocations = item.allocations.map((allocation) => {
      const money = readMoney(allocation.amount);
      if (!categoryIds.has(allocation.categoryId) || money.currency !== amount.currency || money.minorUnits <= 0) {
        throw new BudgetError('invalid_allocations');
      }
      return Object.freeze({ categoryId: allocation.categoryId, amount: money });
    });
    if (sumMoney(allocations.map((part) => part.amount), amount.currency).minorUnits !== amount.minorUnits) {
      throw new BudgetError('allocation_total');
    }
    const base = { id: item.id, accountId: account.id, date: item.date, amount, allocations: Object.freeze(allocations) };
    if (item.kind === 'expense') {
      if (!['pending', 'confirmed', 'reconciled'].includes(item.status) || typeof item.voided !== 'boolean') throw new BudgetError('invalid_status');
      validated.push(Object.freeze({ ...base, kind: 'expense', status: item.status, voided: item.voided }));
    } else if (item.kind === 'refund') {
      if (!['confirmed', 'reconciled'].includes(item.status)) throw new BudgetError('invalid_status');
      requireBudgetId(item.originalExpenseId);
      validated.push(Object.freeze({ ...base, kind: 'refund', status: item.status, originalExpenseId: item.originalExpenseId }));
    } else throw new BudgetError('invalid_activity');
  }
  const originals = new Map(validated.filter((item) => item.kind === 'expense').map((item) => [item.id, item]));
  const credited = new Map<string, bigint>();
  const reviewIds: string[] = [];
  const accepted: BudgetActivity[] = validated.filter((item) => item.kind === 'expense');
  const refunds = validated.filter((item) => item.kind === 'refund').sort((a, b) =>
    a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const refund of refunds) {
    const original = originals.get(refund.originalExpenseId);
    if (!original || original.kind !== 'expense' || original.voided || original.status === 'pending' ||
        original.accountId !== refund.accountId || original.amount.currency !== refund.amount.currency || refund.date < original.date) {
      reviewIds.push(refund.id); continue;
    }
    const proposed = new Map<string, bigint>();
    for (const part of refund.allocations) {
      proposed.set(part.categoryId, (proposed.get(part.categoryId) ?? 0n) + BigInt(part.amount.minorUnits));
    }
    let valid = true;
    for (const [category, units] of proposed) {
      const available = original.allocations.filter((part) => part.categoryId === category)
        .reduce((total, part) => total + BigInt(part.amount.minorUnits), 0n);
      if ((credited.get(`${original.id}:${category}`) ?? 0n) + units > available) valid = false;
    }
    if (!valid) { reviewIds.push(refund.id); continue; }
    for (const [category, units] of proposed) {
      const key = `${original.id}:${category}`;
      credited.set(key, (credited.get(key) ?? 0n) + units);
    }
    accepted.push(refund);
  }
  return Object.freeze({ activities: Object.freeze(accepted), reviewIds: Object.freeze(reviewIds) });
}
