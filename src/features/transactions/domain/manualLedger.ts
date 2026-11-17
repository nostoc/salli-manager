import { isCalendarDate } from '@/core/dates/calendarDate';
import { addMoney, createMoney, negateMoney, readMoney, type CurrencyCode, type Money } from '@/core/money/money';
import { createLedgerAccount, type LedgerAccount } from '@/features/accounts/domain/account';
import { isCategoryId, UNCATEGORIZED } from './categories';

type EntryFields = Readonly<{ id: string; date: string; amount: Money }>;
export type ManualEntryDraft = EntryFields & (
  | Readonly<{ kind: 'expense'; accountId: string; categoryId?: string }>
  | Readonly<{ kind: 'income' | 'opening-balance'; accountId: string }>
  | Readonly<{ kind: 'transfer'; fromAccountId: string; toAccountId: string }>
);

export type LedgerPosting = Readonly<{ accountId: string; direction: 'debit' | 'credit'; amount: Money }>;
export type ManualLedgerEntry = Readonly<ManualEntryDraft & {
  status: 'confirmed';
  postings: readonly LedgerPosting[];
}>;

type LedgerErrorCode = 'invalid_entry' | 'invalid_date' | 'duplicate_account' | 'unknown_account' |
  'archived_account' | 'invalid_amount' | 'currency_mismatch' | 'same_account' |
  'duplicate_entry' | 'duplicate_opening_balance';
const MESSAGES: Record<LedgerErrorCode, string> = {
  invalid_entry: 'Invalid manual ledger entry.',
  invalid_date: 'A complete valid calendar date is required.',
  duplicate_account: 'Account IDs must be unique.',
  unknown_account: 'The entry references an unknown account.',
  archived_account: 'New entries cannot use an archived account.',
  invalid_amount: 'Expenses, income and transfers require a positive amount.',
  currency_mismatch: 'The amount and account currencies must match.',
  same_account: 'A transfer requires two different accounts.',
  duplicate_entry: 'The same entry ID cannot be counted twice.',
  duplicate_opening_balance: 'An account can have only one opening balance.',
};

export class LedgerError extends Error {
  constructor(readonly code: LedgerErrorCode) {
    super(MESSAGES[code]);
    this.name = 'LedgerError';
  }
}

function accountIndex(accounts: readonly LedgerAccount[]): Map<string, LedgerAccount> {
  const index = new Map<string, LedgerAccount>();
  for (const candidate of accounts) {
    const account = createLedgerAccount(candidate);
    if (index.has(account.id)) throw new LedgerError('duplicate_account');
    index.set(account.id, account);
  }
  return index;
}

function buildEntry(index: ReadonlyMap<string, LedgerAccount>, draft: ManualEntryDraft, historical: boolean): ManualLedgerEntry {
  if (!draft || typeof draft !== 'object' || typeof draft.id !== 'string' ||
      draft.id.length > 128 || !/^[A-Za-z0-9]/.test(draft.id) || /[^A-Za-z0-9_-]/.test(draft.id)) {
    throw new LedgerError('invalid_entry');
  }
  if (!isCalendarDate(draft.date)) throw new LedgerError('invalid_date');
  const amount = readMoney(draft.amount);
  const base = { id: draft.id, date: draft.date, amount, status: 'confirmed' as const };

  function resolve(id: string): LedgerAccount {
    const account = index.get(id);
    if (!account) throw new LedgerError('unknown_account');
    if (account.currency !== amount.currency) throw new LedgerError('currency_mismatch');
    if (account.archived && !historical) throw new LedgerError('archived_account');
    return account;
  }
  function posting(account: LedgerAccount, direction: LedgerPosting['direction'], value = amount): LedgerPosting {
    return Object.freeze({ accountId: account.id, direction, amount: value });
  }

  switch (draft.kind) {
    case 'expense':
    case 'income': {
      if (amount.minorUnits <= 0) throw new LedgerError('invalid_amount');
      const account = resolve(draft.accountId);
      const category = draft.kind === 'expense' ? draft.categoryId ?? UNCATEGORIZED : null;
      if (category !== null && !isCategoryId(category)) throw new LedgerError('invalid_entry');
      return Object.freeze({ ...base, kind: draft.kind, accountId: account.id,
        ...(category === null ? {} : { categoryId: category }),
        postings: Object.freeze([posting(account, draft.kind === 'expense' ? 'debit' : 'credit')]) });
    }
    case 'transfer': {
      if (amount.minorUnits <= 0) throw new LedgerError('invalid_amount');
      if (draft.fromAccountId === draft.toAccountId) throw new LedgerError('same_account');
      const from = resolve(draft.fromAccountId);
      const to = resolve(draft.toAccountId);
      return Object.freeze({ ...base, kind: 'transfer', fromAccountId: from.id, toAccountId: to.id,
        postings: Object.freeze([posting(from, 'debit'), posting(to, 'credit')]) });
    }
    case 'opening-balance': {
      const account = resolve(draft.accountId);
      const magnitude = amount.minorUnits < 0 ? negateMoney(amount) : amount;
      let direction: LedgerPosting['direction'];
      if (account.kind === 'credit-card') direction = amount.minorUnits < 0 ? 'credit' : 'debit';
      else direction = amount.minorUnits < 0 ? 'debit' : 'credit';
      return Object.freeze({ ...base, kind: 'opening-balance', accountId: account.id,
        postings: Object.freeze(amount.minorUnits === 0 ? [] : [posting(account, direction, magnitude)]) });
    }
    default:
      throw new LedgerError('invalid_entry');
  }
}

export function createManualEntry(accounts: readonly LedgerAccount[], draft: ManualEntryDraft): ManualLedgerEntry {
  return buildEntry(accountIndex(accounts), draft, false);
}

export type CurrencyTotals = Readonly<{ currency: CurrencyCode; income: Money; expenses: Money; netWorth: Money }>;
export type LedgerProjection = Readonly<{
  balances: readonly Readonly<{ accountId: string; balance: Money }>[];
  totals: readonly CurrencyTotals[];
}>;

// Pure projection of the supplied entry set, not persistence, date filtering or
// a source matcher. Rebuild postings from validated intent, never caller signs.
export function projectManualLedger(accounts: readonly LedgerAccount[], drafts: readonly ManualEntryDraft[]): LedgerProjection {
  const index = accountIndex(accounts);
  const balances = new Map<string, Money>();
  const totals = new Map<CurrencyCode, CurrencyTotals>();
  for (const account of index.values()) {
    const zero = createMoney(0, account.currency);
    balances.set(account.id, zero);
    totals.set(account.currency, { currency: account.currency, income: zero, expenses: zero, netWorth: zero });
  }

  const seen = new Set<string>();
  const openings = new Set<string>();
  for (const draft of drafts) {
    const entry = buildEntry(index, draft, true);
    if (seen.has(entry.id)) throw new LedgerError('duplicate_entry');
    seen.add(entry.id);
    if (entry.kind === 'opening-balance') {
      if (openings.has(entry.accountId)) throw new LedgerError('duplicate_opening_balance');
      openings.add(entry.accountId);
    }
    for (const item of entry.postings) {
      // buildEntry already resolved every posting; re-check map invariants here
      // so an internal inconsistency cannot silently invent an account balance.
      const account = index.get(item.accountId);
      const previous = balances.get(item.accountId);
      if (!account || !previous) throw new LedgerError('unknown_account');
      const increasesBalance = account.kind === 'credit-card' ? item.direction === 'debit' : item.direction === 'credit';
      balances.set(account.id, addMoney(previous, increasesBalance ? item.amount : negateMoney(item.amount)));
    }
    const previousTotals = totals.get(entry.amount.currency);
    if (!previousTotals) throw new LedgerError('unknown_account');
    if (entry.kind === 'expense') {
      totals.set(entry.amount.currency, { ...previousTotals, expenses: addMoney(previousTotals.expenses, entry.amount) });
    } else if (entry.kind === 'income') {
      totals.set(entry.amount.currency, { ...previousTotals, income: addMoney(previousTotals.income, entry.amount) });
    }
  }

  for (const account of index.values()) {
    const balance = balances.get(account.id);
    const previousTotals = totals.get(account.currency);
    if (!balance || !previousTotals) throw new LedgerError('unknown_account');
    totals.set(account.currency, { ...previousTotals,
      netWorth: addMoney(previousTotals.netWorth, account.kind === 'credit-card' ? negateMoney(balance) : balance) });
  }
  return Object.freeze({
    balances: Object.freeze(Array.from(balances, ([accountId, balance]) => Object.freeze({ accountId, balance }))),
    totals: Object.freeze(Array.from(totals.values(), (value) => Object.freeze(value))),
  });
}
