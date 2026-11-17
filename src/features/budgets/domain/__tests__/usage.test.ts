import { createMoney } from '@/core/money/money';
import { createManualEntry, type ManualEntryDraft } from '@/features/transactions/domain/manualLedger';
import { manualBudgetActivity, validateBudgetActivity, type BudgetActivity } from '../activity';
import { calculateBudgetUsage } from '../usage';
import { accounts, budget, expense, money, refund } from './fixtures';

const window = { start: '2024-01-01', end: '2024-02-01', allowance: money(10000) };
const usage = (activities: readonly BudgetActivity[], today = '2024-01-15') => calculateBudgetUsage(budget(), window, activities, accounts, today);

describe('canonical ledger budget adapter', () => {
  it('preserves category attribution and excludes income, opening balance and repayments', () => {
    const drafts: ManualEntryDraft[] = [
      { id: 'opening', kind: 'opening-balance', accountId: 'card-a', amount: money(12000), date: '2024-01-01' },
      { id: 'purchase', kind: 'expense', accountId: 'card-a', categoryId: 'groceries', amount: money(3000), date: '2024-01-02' },
      { id: 'income', kind: 'income', accountId: 'bank-a', amount: money(9000), date: '2024-01-03' },
      { id: 'repayment', kind: 'transfer', fromAccountId: 'bank-a', toAccountId: 'card-a', amount: money(5000), date: '2024-01-04' },
    ];
    const projected = manualBudgetActivity(accounts, drafts);
    expect(projected).toHaveLength(1);
    expect(usage(projected).used).toEqual(money(3000));
    expect(projected[0]?.allocations).toEqual([{ categoryId: 'groceries', amount: money(3000) }]);
    expect(() => manualBudgetActivity(accounts, [...drafts, drafts[3]!])).toThrow();
  });
  it('defaults legacy uncategorized purchases and preserves archived history', () => {
    const draft = { id: 'legacy', kind: 'expense', accountId: 'card-a', amount: money(30), date: '2024-01-02' } as const;
    const archived = accounts.map((account) => ({ ...account, archived: true }));
    const projected = manualBudgetActivity(archived, [draft]);
    expect(projected[0]?.allocations[0]?.categoryId).toBe('uncategorized');
    expect(() => createManualEntry(accounts, { ...draft, categoryId: 'bad\ncategory' })).toThrow();
  });
});

describe('budget activity integrity', () => {
  it.each([
    (item: BudgetActivity) => ({ ...item, id: '' }),
    (item: BudgetActivity) => ({ ...item, accountId: 'missing' }),
    (item: BudgetActivity) => ({ ...item, date: '2024-02-30' }),
    (item: BudgetActivity) => ({ ...item, amount: money(0) }),
    (item: BudgetActivity) => ({ ...item, amount: createMoney(100, 'USD') }),
    (item: BudgetActivity) => ({ ...item, allocations: [] }),
    (item: BudgetActivity) => ({ ...item, allocations: [{ categoryId: 'unknown', amount: money(100) }] }),
    (item: BudgetActivity) => ({ ...item, allocations: [{ categoryId: 'groceries', amount: money(99) }] }),
    (item: BudgetActivity) => ({ ...item, status: 'unknown' }),
    (item: BudgetActivity) => ({ ...item, voided: 'false' }),
  ])('rejects malformed or inconsistent activity', (change) => {
    expect(() => validateBudgetActivity([change(expense('p', 100)) as BudgetActivity], accounts)).toThrow();
  });
  it('rejects duplicate economic event IDs and duplicate account references', () => {
    expect(() => usage([expense('p', 100), expense('p', 100)])).toThrow();
    expect(() => validateBudgetActivity([], [...accounts, accounts[0]!])).toThrow();
  });
  it('keeps genuine equal purchases and freezes canonical copies', () => {
    const result = validateBudgetActivity([expense('p1', 100), expense('p2', 100)], accounts);
    expect(result.activities).toHaveLength(2);
    expect(Object.isFrozen(result.activities[0]?.allocations[0])).toBe(true);
  });
  it('reviews unlinked credits, refunds before charges and refunds of pending or reversed charges', () => {
    const result = validateBudgetActivity([expense('pending', 100, undefined, { status: 'pending' }),
      expense('voided', 100, undefined, { voided: true }), expense('p', 100),
      refund('unlinked', 'missing', 10), refund('early', 'p', 10, '2024-01-01'),
      refund('pending-credit', 'pending', 10), refund('voided-credit', 'voided', 10),
      refund('other-account', 'p', 10, undefined, { accountId: 'card-b' })], accounts);
    expect(new Set(result.reviewIds)).toEqual(new Set(['unlinked', 'early', 'pending-credit', 'voided-credit', 'other-account']));
  });
  it('enforces cumulative refunds by original category, independent of input order', () => {
    const items = [expense('p', 100), refund('r2', 'p', 60, '2024-01-21'), refund('r1', 'p', 60),
      refund('wrong-category', 'p', 10, undefined, { allocations: [{ categoryId: 'transport', amount: money(10) }] })];
    expect(validateBudgetActivity(items, accounts).reviewIds).toEqual(['wrong-category', 'r2']);
    expect(validateBudgetActivity([...items].reverse(), accounts).reviewIds).toEqual(['wrong-category', 'r2']);
    expect(usage(items).refunds).toEqual(money(60));
  });
});

describe('budget usage', () => {
  it('reserves pending spending once, releases reversed charges and accounts for posted refunds', () => {
    const items = [expense('p', 6000), expense('pending', 1500, undefined, { status: 'pending' }),
      expense('reversed', 800, undefined, { voided: true }), refund('r', 'p', 1000)];
    const result = usage(items);
    expect(result.posted).toEqual(money(6000));
    expect(result.pending).toEqual(money(1500));
    expect(result.refunds).toEqual(money(1000));
    expect(result.used).toEqual(money(6500));
    expect(result.remaining).toEqual(money(3500));
    expect(result.dailyAllowance).toEqual(money(205)); // 17 days including today.
    expect(result.utilizationPercent).toBe('65.00');
    const posted = items.map((item) => item.id === 'pending' ? { ...item, status: 'reconciled' as const } : item);
    expect(usage(posted).used).toEqual(result.used);
    expect(usage(posted).pending).toEqual(money(0));
  });
  it('attributes linked refunds to their effective period and original category', () => {
    const items = [expense('old', 500, '2023-12-31'), refund('r', 'old', 500, '2024-01-01')];
    const result = usage(items);
    expect(result.used).toEqual(money(-500));
    expect(result.remaining).toEqual(money(10500));
    expect(result.progressBasisPoints).toBe(0);
    expect(usage([...items, refund('unlinked', 'missing', 999)]).reviewIds).toEqual(['unlinked']);
  });
  it('uses half-open boundaries with existing transactions from the whole current period', () => {
    expect(usage([expense('before', 1, '2023-12-31'), expense('first', 100, '2024-01-01'),
      expense('last', 200, '2024-01-31'), expense('after', 1, '2024-02-01')]).used).toEqual(money(300));
  });
  it('keeps card, category and overall guardrails separate and excludes other currencies', () => {
    const items = [expense('card-a', 1000), expense('card-b', 500, undefined, { accountId: 'card-b' }),
      expense('split', 1000, undefined, { allocations: [{ categoryId: 'groceries', amount: money(600) }, { categoryId: 'transport', amount: money(400) }] }),
      expense('usd', 100, undefined, { accountId: 'usd-card', amount: createMoney(100, 'USD'),
        allocations: [{ categoryId: 'groceries', amount: createMoney(100, 'USD') }] })];
    expect(usage(items).used).toEqual(money(2000));
    expect(calculateBudgetUsage(budget({ scope: { kind: 'overall' } }), window, items, accounts, '2024-01-15').used).toEqual(money(2500));
    expect(calculateBudgetUsage(budget({ scope: { kind: 'category', id: 'groceries' } }), window, items, accounts, '2024-01-15').used).toEqual(money(2100));
  });
  it('handles zero allowance, overspending and dates outside the period', () => {
    const zero = { ...window, allowance: money(0) };
    const empty = calculateBudgetUsage(budget(), zero, [], accounts, '2024-01-31');
    expect(empty.progressBasisPoints).toBeNull();
    const spent = calculateBudgetUsage(budget(), zero, [expense('p', 1)], accounts, '2024-01-31');
    expect(spent.overspending).toEqual(money(1));
    expect(spent.dailyAllowance).toEqual(money(0));
    expect(spent.progressBasisPoints).toBe(10000);
    expect(spent.utilizationPercent).toBeNull();
    expect(usage([], '2023-12-31')).toMatchObject({ state: 'upcoming', dailyAllowance: null });
    expect(usage([], '2024-02-01')).toMatchObject({ state: 'ended', dailyAllowance: null });
  });
  it('rejects mismatched allowances, invalid periods and unsafe aggregate arithmetic', () => {
    expect(() => calculateBudgetUsage(budget(), { ...window, allowance: createMoney(1, 'USD') }, [], accounts, '2024-01-15')).toThrow();
    expect(() => calculateBudgetUsage(budget(), { ...window, end: window.start }, [], accounts, '2024-01-15')).toThrow();
    expect(() => usage([expense('big', Number.MAX_SAFE_INTEGER), expense('overflow', 1)])).toThrow();
  });
});
import { describe, expect, it } from '@jest/globals';
