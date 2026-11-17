import { describe, expect, it } from '@jest/globals';
import { createCardProfile } from '@/features/accounts/domain/cardProfile';
import { setBudgetThresholds } from '../budget';
import { refreshBudget } from '../refresh';
import { accounts, budget, expense, money } from './fixtures';

describe('read/resume budget refresh', () => {
  it('emits an in-app crossing once when replayed with committed state', () => {
    const input = { budget: budget({ rollover: true }), accounts, activities: [expense('p', 9000)], today: '2024-01-15' };
    const first = refreshBudget(input);
    expect(first.signals).toHaveLength(1);
    const replay = refreshBudget({ ...input, periods: first.periods, thresholdStates: first.thresholdStates });
    expect(replay.signals).toEqual([]);
    expect(replay.periods).toEqual(first.periods);
    expect(replay.catchUpPending).toBe(false);
  });
  it('does bounded catch-up work and keeps historical thresholds quiet', () => {
    const input = { budget: budget({ startDate: '2024-01-01', scope: { kind: 'overall' }, rule: { kind: 'repeating', anchor: '2024-01-01', days: 1 } }),
      accounts, activities: [expense('old', 10000, '2024-01-01')], today: '2024-01-04', maxNewPeriods: 2 };
    const first = refreshBudget(input);
    expect(first.periods).toHaveLength(2);
    expect(first.catchUpPending).toBe(true);
    expect(first.signals).toEqual([]);
    const next = refreshBudget({ ...input, periods: first.periods, thresholdStates: first.thresholdStates });
    expect(next.periods).toHaveLength(4);
    expect(next.catchUpPending).toBe(false);
    expect(next.signals).toEqual([]);
    expect(() => refreshBudget({ ...input, maxNewPeriods: 0 })).toThrow();
  });
  it('baselines a threshold change and rejects duplicate or unrelated threshold state', () => {
    const input = { budget: setBudgetThresholds(budget(), [20, 100]), accounts, activities: [expense('p', 3000)], today: '2024-01-15' };
    const baseline = refreshBudget({ ...input, baselineThresholds: true });
    expect(baseline.signals).toEqual([]);
    expect(baseline.thresholdStates[0]?.reached).toEqual([20]);
    expect(() => refreshBudget({ ...input, thresholdStates: [baseline.thresholdStates[0]!, baseline.thresholdStates[0]!] })).toThrow();
    expect(() => refreshBudget({ ...input, thresholdStates: [{ periodId: 'other', reached: [] }] })).toThrow();
  });
});

describe('independent bank card settings', () => {
  it('keeps unknown limits explicit and never constrains or mutates spending budgets', () => {
    const card = accounts[0]!;
    const definition = budget({ amount: money(50000) });
    expect(createCardProfile(card).creditLimit).toBeNull();
    const profile = createCardProfile(card, { creditLimit: money(10000), statementClosingDay: 31 });
    expect(profile.creditLimit).toEqual(money(10000));
    expect(definition.revisions[0]?.amount).toEqual(money(50000));
    expect(Object.isFrozen(profile)).toBe(true);
    expect(() => createCardProfile(accounts[1]!)).toThrow();
    expect(() => createCardProfile(card, { creditLimit: money(-1) })).toThrow();
    expect(() => createCardProfile(card, { statementClosingDay: 32 })).toThrow();
  });
});
