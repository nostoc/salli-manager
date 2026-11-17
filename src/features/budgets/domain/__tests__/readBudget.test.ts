import { describe, expect, it } from '@jest/globals';
import { materializeBudgetPeriods } from '../history';
import { scheduleBudgetRevision } from '../budget';
import { readBudgetDefinition } from '../readBudget';
import { accounts, budget, money } from './fixtures';

describe('untrusted stored budget definitions', () => {
  it('round trips and freezes revisions, preserving archived-account history', () => {
    const original = budget();
    const [current] = materializeBudgetPeriods(original, accounts, [], '2024-01-15');
    const changed = scheduleBudgetRevision(original, { amount: money(20000), rollover: true,
      rule: { kind: 'billing', closingDay: 15 } }, '2024-01-15', current!);
    const result = readBudgetDefinition(JSON.parse(JSON.stringify(changed)), accounts.map((account) => ({ ...account, archived: true })));
    expect(result).toEqual(changed);
    expect(Object.isFrozen(result.revisions[1]?.rule)).toBe(true);
  });
  it.each([null, {}, { revisions: [] }, { ...budget(), currency: 'USD' }, { ...budget(), archived: 'false' },
    { ...budget(), timeZone: null }, { ...budget(), thresholds: [50, 50] },
    { ...budget(), revisions: [{ ...budget().revisions[0], effectiveFrom: '2024-01-15' }] },
    { ...budget(), revisions: [{ ...budget().revisions[0], id: 'wrong' }] },
    { ...budget(), revisions: [budget().revisions[0], { ...budget().revisions[0], id: 'budget-a:revision:2', effectiveFrom: '2024-01-20' }] },
  ])('rejects corrupt definitions', (value) => {
    expect(() => readBudgetDefinition(value, accounts)).toThrow();
  });
  it('allows a later pending edit to replace an unissued one-off proposal', () => {
    const original = budget();
    const [current] = materializeBudgetPeriods(original, accounts, [], '2024-01-15');
    const pending = scheduleBudgetRevision(original, { amount: money(100), rollover: false,
      rule: { kind: 'one-off', start: '2024-02-01', endInclusive: '2024-02-02' } }, '2024-01-15', current!);
    const replaced = scheduleBudgetRevision(pending, { amount: money(200), rollover: false,
      rule: { kind: 'monthly' } }, '2024-01-15', current!);
    expect(readBudgetDefinition(JSON.parse(JSON.stringify(replaced)), accounts)).toEqual(replaced);
  });
});
