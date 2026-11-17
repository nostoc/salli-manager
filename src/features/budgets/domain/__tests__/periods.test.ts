import { addCalendarDays, anchoredMonthDate, calendarOrdinal, dateFromOrdinal, daysBetween, financialDateAt,
  validateFinancialTimeZone } from '@/core/dates/calendarMath';
import { containsDate, resolveBudgetPeriod, validatePeriodRule, type BudgetPeriodRule } from '../periods';

describe('financial calendar', () => {
  it.each(['0001-01-01', '0099-12-31', '1900-03-01', '2000-02-29', '2024-12-31', '9999-12-31'])('round trips %s without year coercion', (date) => {
    expect(dateFromOrdinal(calendarOrdinal(date))).toBe(date);
  });
  it('uses calendar days across leap days and independently clamps monthly anchors', () => {
    expect(addCalendarDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(daysBetween('2024-02-01', '2024-03-01')).toBe(29);
    expect(anchoredMonthDate('2024-01-31', 1, 31)).toBe('2024-02-29');
    expect(anchoredMonthDate('2024-02-29', 1, 31)).toBe('2024-03-31');
    expect(anchoredMonthDate('2023-12-31', 1, 31)).toBe('2024-01-31');
  });
  it('uses the saved zone rather than the phone zone and follows DST', () => {
    const instant = new Date('2024-01-31T20:00:00Z');
    expect(financialDateAt(instant)).toBe('2024-02-01');
    expect(financialDateAt(instant, 'America/New_York')).toBe('2024-01-31');
    expect(financialDateAt(new Date('2024-03-10T07:01:00Z'), 'America/New_York')).toBe('2024-03-10');
  });
  it.each([() => addCalendarDays('0001-01-01', -1), () => addCalendarDays('9999-12-31', 1),
    () => addCalendarDays('2024-01-01', 0.5), () => calendarOrdinal('2024-02-30'), () => dateFromOrdinal(Infinity),
    () => anchoredMonthDate('2024-01-01', 0, 32), () => anchoredMonthDate('0001-01-01', -1, 1),
    () => validateFinancialTimeZone('not/a-zone'), () => financialDateAt(new Date(NaN))])('rejects invalid or unrepresentable dates', (operation) => {
    expect(operation).toThrow(RangeError);
  });
});

describe('budget periods [start, end)', () => {
  it.each<[{ kind: 'monthly' | 'weekly' }, string, string, string]>([
    [{ kind: 'monthly' }, '2024-02-29', '2024-02-01', '2024-03-01'],
    [{ kind: 'monthly' }, '2024-12-31', '2024-12-01', '2025-01-01'],
    [{ kind: 'weekly' }, '2024-01-01', '2024-01-01', '2024-01-08'],
    [{ kind: 'weekly' }, '2024-01-07', '2024-01-01', '2024-01-08'],
    [{ kind: 'weekly' }, '2023-12-31', '2023-12-25', '2024-01-01'],
  ])('resolves %j on %s', (rule, date, start, end) => {
    const window = resolveBudgetPeriod(rule, date);
    expect(window).toEqual({ start, end });
    expect(containsDate(window, start)).toBe(true);
    expect(containsDate(window, end)).toBe(false);
  });
  it.each([29, 30, 31])('includes clamped February closing day %i without March drift', (closingDay) => {
    expect(resolveBudgetPeriod({ kind: 'billing', closingDay }, '2024-02-29')).toEqual({
      start: `2024-01-${String(closingDay + 1).padStart(2, '0')}`.replace('2024-01-32', '2024-02-01'), end: '2024-03-01',
    });
    expect(resolveBudgetPeriod({ kind: 'billing', closingDay }, '2024-03-01')).toEqual({
      start: '2024-03-01', end: closingDay === 31 ? '2024-04-01' : `2024-03-${closingDay + 1}`,
    });
  });
  it('handles non-leap February and year crossings', () => {
    expect(resolveBudgetPeriod({ kind: 'billing', closingDay: 31 }, '2023-02-28')).toEqual({ start: '2023-02-01', end: '2023-03-01' });
    expect(resolveBudgetPeriod({ kind: 'billing', closingDay: 10 }, '2024-01-10')).toEqual({ start: '2023-12-11', end: '2024-01-11' });
    expect(resolveBudgetPeriod({ kind: 'billing', closingDay: 10 }, '2024-01-11')).toEqual({ start: '2024-01-11', end: '2024-02-11' });
  });
  it('resolves anchored N-day periods and previews a future first period', () => {
    const rule = { kind: 'repeating', anchor: '2024-02-27', days: 3 } as const;
    expect(resolveBudgetPeriod(rule, '2024-02-01')).toEqual({ start: '2024-02-27', end: '2024-03-01' });
    expect(resolveBudgetPeriod(rule, '2024-03-01')).toEqual({ start: '2024-03-01', end: '2024-03-04' });
  });
  it('includes both user-entered one-off dates', () => {
    expect(resolveBudgetPeriod({ kind: 'one-off', start: '2024-02-29', endInclusive: '2024-02-29' }, '2024-02-01'))
      .toEqual({ start: '2024-02-29', end: '2024-03-01' });
  });
  it.each([null, { kind: 'unknown' }, { kind: 'billing', closingDay: 0 }, { kind: 'billing', closingDay: 1.5 },
    { kind: 'repeating', anchor: '2024-01-01', days: 0 }, { kind: 'repeating', anchor: '2024-01-01', days: Infinity },
    { kind: 'one-off', start: '2024-02-02', endInclusive: '2024-02-01' }])('rejects malformed rules', (rule) => {
    expect(() => validatePeriodRule(rule as BudgetPeriodRule)).toThrow();
  });
  it('partitions 400 consecutive calendar days without gaps or overlaps for each closing day', () => {
    for (const closingDay of [1, 28, 29, 30, 31]) {
      let previous = resolveBudgetPeriod({ kind: 'billing', closingDay }, '2023-12-01');
      for (let i = 1; i <= 400; i++) {
        const date = addCalendarDays('2023-12-01', i);
        const current = resolveBudgetPeriod({ kind: 'billing', closingDay }, date);
        expect(containsDate(current, date)).toBe(true);
        if (current.start !== previous.start) expect(current.start).toBe(previous.end);
        previous = current;
      }
    }
  });
});
import { describe, expect, it } from '@jest/globals';
