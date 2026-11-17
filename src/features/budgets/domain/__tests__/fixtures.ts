import { createMoney } from '@/core/money/money';
import { createLedgerAccount } from '@/features/accounts/domain/account';
import { createBudgetDefinition, type BudgetInput } from '../budget';
import type { BudgetActivity } from '../activity';

// Independently synthetic data; never derived from the supplied SMS samples.
export const accounts = Object.freeze([
  createLedgerAccount({ id: 'card-a', kind: 'credit-card' }),
  createLedgerAccount({ id: 'bank-a', kind: 'bank' }),
  createLedgerAccount({ id: 'card-b', kind: 'credit-card' }),
  createLedgerAccount({ id: 'usd-card', kind: 'credit-card', currency: 'USD' }),
]);
export const money = (units: number) => createMoney(units);
export function budget(overrides: Partial<BudgetInput> = {}) {
  return createBudgetDefinition({ id: 'budget-a', name: 'Synthetic allowance', scope: { kind: 'card', id: 'card-a' },
    amount: money(10000), rule: { kind: 'monthly' }, startDate: '2024-01-15', ...overrides }, accounts);
}
export function expense(id: string, units: number, date = '2024-01-15', overrides: Partial<BudgetActivity> = {}): BudgetActivity {
  return { id, amount: money(units), accountId: 'card-a', date, allocations: [{ categoryId: 'groceries', amount: money(units) }],
    kind: 'expense', status: 'confirmed', voided: false, ...overrides } as BudgetActivity;
}
export function refund(id: string, originalExpenseId: string, units: number, date = '2024-01-20', overrides: Partial<BudgetActivity> = {}): BudgetActivity {
  return { id, originalExpenseId, amount: money(units), accountId: 'card-a', date,
    allocations: [{ categoryId: 'groceries', amount: money(units) }], kind: 'refund', status: 'confirmed', ...overrides } as BudgetActivity;
}
