import { describe, expect, it } from '@jest/globals';
import { createLedgerAccount } from '@/features/accounts/domain/account';
import { createMoney } from '@/core/money/money';
import { createTransaction, ledgerBudgetActivity, projectLedger } from '../ledger';
const card = createLedgerAccount({ id: 'card', kind: 'credit-card' });
const bank = createLedgerAccount({ id: 'bank', kind: 'bank' });
const accounts = [card, bank];
const purchase = createTransaction(accounts, { id: 'purchase', kind: 'expense', accountId: 'card', amount: createMoney(4700), date: '2026-06-12', categoryId: 'groceries', status: 'pending', origin: 'sms' });
describe('canonical financial lifecycle', () => {
  it('reserves pending purchases without changing posted balances, then posts once', () => {
    const pending = projectLedger(accounts, [purchase]);
    expect(pending.balances[0]?.balance.minorUnits).toBe(0);
    expect(pending.pending[0]?.amount.minorUnits).toBe(4700);
    expect(ledgerBudgetActivity(accounts, [purchase])[0]).toMatchObject({ status: 'pending', amount: createMoney(4700) });
    const posted = projectLedger(accounts, [{ ...purchase, status: 'confirmed' }]);
    expect(posted.balances[0]?.balance.minorUnits).toBe(4700);
    expect(posted.pending[0]?.amount.minorUnits).toBe(0);
    expect(projectLedger(accounts, [{ ...purchase, voided: true }]).pending[0]?.amount.minorUnits).toBe(0);
  });
  it('links refunds to posted originals, reduces expenses instead of adding income and retains category', () => {
    const original = { ...purchase, status: 'confirmed' as const };
    const refund = createTransaction(accounts, { id: 'refund', kind: 'refund', accountId: 'card', originalExpenseId: original.id, amount: createMoney(1200), date: '2026-06-13' });
    if (refund.kind !== 'refund') throw new Error('Expected synthetic refund');
    const result = projectLedger(accounts, [original, refund]);
    expect(result.balances[0]?.balance.minorUnits).toBe(3500);
    expect(result.totals[0]).toMatchObject({ income: createMoney(0), expenses: createMoney(3500) });
    expect(ledgerBudgetActivity(accounts, [original, refund])[1]).toMatchObject({ kind: 'refund', allocations: [{ categoryId: 'groceries', amount: createMoney(1200) }] });
    expect(() => projectLedger(accounts, [purchase, refund])).toThrow();
    expect(() => projectLedger(accounts, [original, refund, { ...refund, id: 'excess', amount: createMoney(4000) }])).toThrow();
    expect(() => projectLedger(accounts, [original, { ...refund, accountId: 'bank' }])).toThrow();
    expect(() => projectLedger(accounts, [original, { ...refund, date: '2026-06-11' }])).toThrow();
  });
  it('repayments neither spend nor release pending reservations', () => {
    const repayment = createTransaction(accounts, { id: 'repay', kind: 'transfer', fromAccountId: 'bank', toAccountId: 'card', date: '2026-06-13', amount: createMoney(1500) });
    expect(ledgerBudgetActivity(accounts, [purchase, repayment])).toHaveLength(1);
    expect(projectLedger(accounts, [purchase, repayment]).pending[0]?.amount.minorUnits).toBe(4700);
  });
  it('rejects invalid lifecycle combinations and overflowing reservations', () => {
    expect(() => createTransaction(accounts, { ...purchase, status: 'confirmed', estimated: true })).toThrow();
    expect(() => projectLedger(accounts, [purchase, purchase])).toThrow();
    expect(() => projectLedger(accounts, [{ ...purchase, amount: createMoney(Number.MAX_SAFE_INTEGER) }, { ...purchase, id: 'overflow' }])).toThrow();
  });
});
