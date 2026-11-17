import { addCalendarDays, anchoredMonthDate, calendarOrdinal, dateFromOrdinal, requireCalendarDate } from '@/core/dates/calendarMath';

export type BudgetPeriodRule =
  | Readonly<{ kind: 'monthly' }>
  | Readonly<{ kind: 'weekly' }>
  | Readonly<{ kind: 'billing'; closingDay: number }>
  | Readonly<{ kind: 'repeating'; anchor: string; days: number }>
  | Readonly<{ kind: 'one-off'; start: string; endInclusive: string }>;

export type PeriodWindow = Readonly<{ start: string; end: string }>;

export function validatePeriodRule(rule: BudgetPeriodRule): BudgetPeriodRule {
  if (!rule || typeof rule !== 'object') throw new RangeError('Invalid budget period rule.');
  switch (rule.kind) {
    case 'monthly': return Object.freeze({ kind: 'monthly' });
    case 'weekly': return Object.freeze({ kind: 'weekly' });
    case 'billing':
      if (!Number.isInteger(rule.closingDay) || rule.closingDay < 1 || rule.closingDay > 31) throw new RangeError('Invalid billing closing day.');
      return Object.freeze({ kind: 'billing', closingDay: rule.closingDay });
    case 'repeating':
      requireCalendarDate(rule.anchor);
      if (!Number.isSafeInteger(rule.days) || rule.days < 1) throw new RangeError('Invalid repeating period length.');
      addCalendarDays(rule.anchor, rule.days);
      return Object.freeze({ kind: 'repeating', anchor: rule.anchor, days: rule.days });
    case 'one-off':
      requireCalendarDate(rule.start);
      requireCalendarDate(rule.endInclusive);
      if (rule.endInclusive < rule.start) throw new RangeError('A budget must end on or after its start.');
      addCalendarDays(rule.endInclusive, 1);
      return Object.freeze({ kind: 'one-off', start: rule.start, endInclusive: rule.endInclusive });
    default: throw new RangeError('Invalid budget period rule.');
  }
}

export function resolveBudgetPeriod(input: BudgetPeriodRule, asOf: string): PeriodWindow {
  const rule = validatePeriodRule(input);
  requireCalendarDate(asOf);
  let start: string;
  let end: string;
  switch (rule.kind) {
    case 'monthly':
      start = anchoredMonthDate(asOf, 0, 1);
      end = anchoredMonthDate(asOf, 1, 1);
      break;
    case 'weekly': {
      const ordinal = calendarOrdinal(asOf);
      const offset = ((ordinal + 3) % 7 + 7) % 7;
      start = dateFromOrdinal(ordinal - offset);
      end = addCalendarDays(start, 7);
      break;
    }
    case 'billing': {
      const closing = anchoredMonthDate(asOf, 0, rule.closingDay);
      start = addCalendarDays(asOf <= closing ? anchoredMonthDate(asOf, -1, rule.closingDay) : closing, 1);
      end = addCalendarDays(asOf <= closing ? closing : anchoredMonthDate(asOf, 1, rule.closingDay), 1);
      break;
    }
    case 'repeating': {
      const offset = Math.max(0, Math.floor((calendarOrdinal(asOf) - calendarOrdinal(rule.anchor)) / rule.days));
      start = addCalendarDays(rule.anchor, offset * rule.days);
      end = addCalendarDays(start, rule.days);
      break;
    }
    case 'one-off':
      start = rule.start;
      end = addCalendarDays(rule.endInclusive, 1);
  }
  return Object.freeze({ start, end });
}

export function containsDate(window: PeriodWindow, date: string): boolean {
  requireCalendarDate(date);
  return window.start <= date && date < window.end;
}
