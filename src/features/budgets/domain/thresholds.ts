import { requireCalendarDate } from '@/core/dates/calendarMath';
import { BudgetError, validateThresholds, type BudgetDefinition } from './budget';
import type { BudgetPeriod } from './history';
import type { BudgetUsage } from './usage';

export type ThresholdState = Readonly<{ periodId: string; reached: readonly number[] }>;
export type ThresholdSignal = Readonly<{ budgetId: string; periodId: string; date: string; thresholds: readonly number[]; highest: number }>;

export function evaluateBudgetThresholds(budget: BudgetDefinition, period: BudgetPeriod, usage: BudgetUsage,
  today: string, state: ThresholdState = { periodId: period.id, reached: [] }, mode: 'live' | 'baseline' = 'live'):
  Readonly<{ state: ThresholdState; signal: ThresholdSignal | null }> {
  requireCalendarDate(today);
  if (state.periodId !== period.id || period.budgetId !== budget.id || usage.used.currency !== budget.currency ||
      usage.budgetId !== budget.id || usage.periodStart !== period.start || usage.periodEnd !== period.end ||
      period.allowance.currency !== budget.currency || (mode !== 'live' && mode !== 'baseline')) throw new BudgetError('invalid_threshold_state');
  const thresholds = validateThresholds(budget.thresholds);
  const reached = new Set(validateThresholds(state.reached));
  const crossed = period.allowance.minorUnits === 0
    ? (usage.used.minorUnits > 0 && thresholds.includes(100) ? [100] : [])
    : thresholds.filter((value) => BigInt(usage.used.minorUnits) * 100n >= BigInt(period.allowance.minorUnits) * BigInt(value));
  const fresh = crossed.filter((value) => !reached.has(value));
  for (const value of crossed) reached.add(value);
  const highest = fresh[fresh.length - 1];
  const live = mode === 'live' && !budget.archived && period.start <= today && today < period.end;
  return Object.freeze({ state: Object.freeze({ periodId: period.id, reached: Object.freeze([...reached].sort((a, b) => a - b)) }),
    signal: live && highest !== undefined ? Object.freeze({ budgetId: budget.id, periodId: period.id, date: today,
      thresholds: Object.freeze(fresh), highest }) : null });
}
