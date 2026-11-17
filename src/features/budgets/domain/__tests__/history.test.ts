import { createMoney } from '@/core/money/money';
import { archiveBudget, createBudgetDefinition, revisionAt, scheduleBudgetRevision, setBudgetThresholds, validateThresholds,
  type BudgetInput } from '../budget';
import { materializeBudgetPeriods, rolloverCorrection, type BudgetPeriod } from '../history';
import { calculateBudgetUsage } from '../usage';
import { evaluateBudgetThresholds } from '../thresholds';
import { accounts, budget, expense, money, refund } from './fixtures';

describe('budget definitions and prospective edits', () => {
  it('starts midmonth with the full current period, independent of credit limit', () => {
    const definition = budget({ amount: money(99999999) });
    expect(definition.revisions[0]?.effectiveFrom).toBe('2024-01-01');
    expect(definition.timeZone).toBe('Asia/Colombo');
    expect(definition.revisions[0]?.rollover).toBe(false);
    expect(definition.thresholds).toEqual([50, 75, 90, 100]);
    expect(Object.isFrozen(definition.revisions[0]?.amount)).toBe(true);
    expect('creditLimit' in definition).toBe(false);
  });
  it.each<Partial<BudgetInput>>([
    { id: '' }, { name: ' ' }, { scope: null as unknown as BudgetInput['scope'] },
    { amount: money(-1) }, { timeZone: 'unknown' }, { scope: { kind: 'card', id: 'missing' } },
    { scope: { kind: 'card', id: 'bank-a' } }, { scope: { kind: 'card', id: 'usd-card' } },
    { scope: { kind: 'category', id: 'unknown' } }, { rule: { kind: 'weekly' } },
    { scope: { kind: 'overall' }, rule: { kind: 'billing', closingDay: 10 } },
    { rule: { kind: 'one-off', start: '2024-01-01', endInclusive: '2024-01-31' }, rollover: true },
    { thresholds: [50, 50] }, { thresholds: [0] }, { thresholds: [101] }, { thresholds: [99.5] },
  ])('rejects invalid definitions: %j', (overrides) => {
    expect(() => budget(overrides)).toThrow();
  });
  it('rejects archived cards and allows weekly overall/category and zero allowance', () => {
    expect(() => createBudgetDefinition({ id: 'b', name: 'B', amount: money(0), scope: { kind: 'card', id: 'card-a' },
      rule: { kind: 'monthly' }, startDate: '2024-01-01' }, accounts.map((item) => ({ ...item, archived: true })))).toThrow();
    expect(budget({ amount: money(0), scope: { kind: 'overall' }, rule: { kind: 'weekly' } }).revisions[0]?.amount).toEqual(money(0));
    expect(budget({ scope: { kind: 'category', id: 'groceries' }, rule: { kind: 'weekly' } }).scope.kind).toBe('category');
    expect(validateThresholds([100, 25, 75])).toEqual([25, 75, 100]);
  });
  it('rejects rollover configurations whose maximum carry would make future periods unsafe', () => {
    expect(() => budget({ amount: money(Number.MAX_SAFE_INTEGER), rollover: true })).toThrow();
    expect(budget({ amount: money(Math.floor(Number.MAX_SAFE_INTEGER / 2)), rollover: true }).revisions[0]?.rollover).toBe(true);
    expect(budget({ amount: money(Number.MAX_SAFE_INTEGER), rollover: false }).revisions[0]?.amount).toEqual(money(Number.MAX_SAFE_INTEGER));
  });
  it('keeps current allowance unchanged and latest scheduled edit wins', () => {
    const original = budget();
    const [current] = materializeBudgetPeriods(original, accounts, [], '2024-01-15');
    const first = scheduleBudgetRevision(original, { amount: money(20000), rule: { kind: 'monthly' }, rollover: true }, '2024-01-15', current!);
    const second = scheduleBudgetRevision(first, { amount: money(30000), rule: { kind: 'monthly' }, rollover: false }, '2024-01-16', current!);
    expect(revisionAt(second, '2024-01-31').amount).toEqual(money(10000));
    expect(revisionAt(second, '2024-02-01').amount).toEqual(money(30000));
    expect(second.revisions).toHaveLength(3);
    expect(materializeBudgetPeriods(second, accounts, [], '2024-02-01', [current!])[1]?.allowance).toEqual(money(30000));
    expect(() => scheduleBudgetRevision(second, { amount: createMoney(1, 'USD'), rule: { kind: 'monthly' }, rollover: false }, '2024-01-16', current!)).toThrow();
    expect(() => scheduleBudgetRevision(archiveBudget(original), original.revisions[0]!, '2024-01-15', current!)).toThrow();
    expect(() => scheduleBudgetRevision(original, original.revisions[0]!, '2024-02-01', current!)).toThrow();
  });
});

describe('immutable period history and rollover', () => {
  it('materializes missed periods once and carries unused allowance up to the next base', () => {
    const definition = budget({ rollover: true });
    const items = [expense('jan', 3000)];
    const periods = materializeBudgetPeriods(definition, accounts, items, '2024-04-15');
    expect(periods.map((item) => item.start)).toEqual(['2024-01-01', '2024-02-01', '2024-03-01', '2024-04-01']);
    expect(periods.map((item) => item.allowance.minorUnits)).toEqual([10000, 17000, 20000, 20000]);
    expect(materializeBudgetPeriods(definition, accounts, items, '2024-04-15', periods)).toEqual(periods);
    expect(materializeBudgetPeriods(definition, accounts, items, '2024-01-01', periods)).toEqual(periods); // Clock rollback.
    expect(Object.isFrozen(periods[1]?.allowance)).toBe(true);
  });
  it('does not carry overspending debt or roll over when disabled', () => {
    expect(materializeBudgetPeriods(budget({ rollover: true }), accounts, [expense('over', 12000)], '2024-02-01')[1]?.allowance).toEqual(money(10000));
    expect(materializeBudgetPeriods(budget(), accounts, [], '2024-02-01')[1]?.allowance).toEqual(money(10000));
  });
  it('freezes issued rollover when late corrections change historic usage', () => {
    const definition = budget({ rollover: true });
    const periods = materializeBudgetPeriods(definition, accounts, [expense('jan', 3000)], '2024-02-01');
    const corrected = [expense('jan', 8000)];
    expect(materializeBudgetPeriods(definition, accounts, corrected, '2024-02-15', periods)).toEqual(periods);
    expect(rolloverCorrection(definition, periods[1]!, periods[0]!, accounts, corrected, '2024-02-15')).toEqual({
      usageDifference: money(5000), rolloverDifference: money(-5000),
    });
    expect(rolloverCorrection(definition, periods[0]!, periods[0]!, accounts, [], '2024-02-15')).toBeNull();
  });
  it('prorates a short monthly-to-billing transition using integer floor', () => {
    const original = budget();
    const [jan] = materializeBudgetPeriods(original, accounts, [], '2024-01-15');
    const changed = scheduleBudgetRevision(original, { amount: money(10001), rule: { kind: 'billing', closingDay: 15 }, rollover: true }, '2024-01-15', jan!);
    const periods = materializeBudgetPeriods(changed, accounts, [], '2024-02-16', [jan!]);
    expect(periods[1]).toMatchObject({ start: '2024-02-01', end: '2024-02-16', baseAllowance: money(4839), rollover: money(4839) });
    expect(periods[2]).toMatchObject({ start: '2024-02-16', end: '2024-03-16', baseAllowance: money(10001) });
    expect(periods[0]).toEqual(jan);
  });
  it('anchors a changed repeating cadence to the previous end, retaining full allowance', () => {
    const original = budget();
    const [jan] = materializeBudgetPeriods(original, accounts, [], '2024-01-15');
    const changed = scheduleBudgetRevision(original, { amount: money(700), rule: { kind: 'repeating', days: 7, anchor: '2020-01-01' }, rollover: false }, '2024-01-15', jan!);
    const periods = materializeBudgetPeriods(changed, accounts, [], '2024-02-08', [jan!]);
    expect(periods[1]).toMatchObject({ start: '2024-02-01', end: '2024-02-08', baseAllowance: money(700) });
    expect(periods[2]?.start).toBe('2024-02-08');
  });
  it('previews future custom periods without issuing and never repeats a one-off', () => {
    const definition = budget({ rule: { kind: 'one-off', start: '2024-02-10', endInclusive: '2024-02-12' } });
    expect(materializeBudgetPeriods(definition, accounts, [], '2024-02-09')).toEqual([]);
    const periods = materializeBudgetPeriods(definition, accounts, [], '2024-03-01');
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ start: '2024-02-10', end: '2024-02-13', baseAllowance: money(10000) });
    expect(() => scheduleBudgetRevision(definition, definition.revisions[0]!, '2024-02-11', periods[0]!)).toThrow();
    expect(materializeBudgetPeriods(archiveBudget(definition), accounts, [], '2024-04-01', periods)).toEqual(periods);
  });
  it.each([
    (p: BudgetPeriod) => ({ ...p, id: 'wrong' }),
    (p: BudgetPeriod) => ({ ...p, revisionId: 'wrong' }),
    (p: BudgetPeriod) => ({ ...p, timeZone: 'UTC' }),
    (p: BudgetPeriod) => ({ ...p, end: '2024-02-02' }),
    (p: BudgetPeriod) => ({ ...p, issuedOn: '2023-12-31' }),
    (p: BudgetPeriod) => ({ ...p, allowance: money(10001) }),
    (p: BudgetPeriod) => ({ ...p, rollover: money(1), allowance: money(10001) }),
    (p: BudgetPeriod) => ({ ...p, rolloverBasisUsage: money(0) }),
  ])('rejects inconsistent stored snapshots', (change) => {
    const definition = budget();
    const [period] = materializeBudgetPeriods(definition, accounts, [], '2024-01-15');
    expect(() => materializeBudgetPeriods(definition, accounts, [], '2024-01-15', [change(period!)])).toThrow();
  });
});

describe('threshold state', () => {
  const definition = budget();
  const [period] = materializeBudgetPeriods(definition, accounts, [], '2024-01-15');
  const calculate = (items: ReturnType<typeof expense>[]) => calculateBudgetUsage(definition, period!, items, accounts, '2024-01-15');
  it('consolidates simultaneous crossings and never repeats after refunds and re-spending', () => {
    const first = evaluateBudgetThresholds(definition, period!, calculate([expense('p', 9500)]), '2024-01-15');
    expect(first.signal).toMatchObject({ highest: 90, thresholds: [50, 75, 90] });
    const lower = evaluateBudgetThresholds(definition, period!, calculate([expense('p', 9500), refund('r', 'p', 8000)]), '2024-01-20', first.state);
    expect(lower.signal).toBeNull();
    expect(evaluateBudgetThresholds(definition, period!, calculate([expense('p', 9500)]), '2024-01-21', lower.state).signal).toBeNull();
    expect(evaluateBudgetThresholds(definition, period!, calculate([expense('p', 10000)]), '2024-01-21', lower.state).signal?.thresholds).toEqual([100]);
  });
  it('baselines new thresholds prospectively and keeps historic/archive evaluations quiet', () => {
    const changed = setBudgetThresholds(definition, [10, 20, 100]);
    const baseline = evaluateBudgetThresholds(changed, period!, calculate([expense('p', 5000)]), '2024-01-15', undefined, 'baseline');
    expect(baseline.signal).toBeNull();
    expect(evaluateBudgetThresholds(changed, period!, calculate([expense('p', 5000)]), '2024-01-16', baseline.state).signal).toBeNull();
    expect(evaluateBudgetThresholds(definition, period!, calculate([expense('p', 10000)]), '2024-02-01').signal).toBeNull();
    expect(evaluateBudgetThresholds(archiveBudget(definition), period!, calculate([expense('p', 10000)]), '2024-01-15').signal).toBeNull();
    expect(() => evaluateBudgetThresholds(definition, period!, calculate([]), '2024-01-15', { periodId: 'other', reached: [] })).toThrow();
  });
  it('signals 100% once for positive spending against zero allowance without division', () => {
    const zero = budget({ amount: money(0) });
    const [zeroPeriod] = materializeBudgetPeriods(zero, accounts, [], '2024-01-15');
    const result = evaluateBudgetThresholds(zero, zeroPeriod!, calculateBudgetUsage(zero, zeroPeriod!, [expense('p', 1)], accounts, '2024-01-15'), '2024-01-15');
    expect(result.signal?.thresholds).toEqual([100]);
  });
});
import { describe, expect, it } from '@jest/globals';
