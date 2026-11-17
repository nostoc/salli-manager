import { requireCalendarDate } from '@/core/dates/calendarMath';
import type { LedgerAccount } from '@/features/accounts/domain/account';
import type { BudgetActivity } from './activity';
import { BudgetError, revisionAt, type BudgetDefinition } from './budget';
import { materializeBudgetPeriods, rolloverCorrection, type BudgetPeriod } from './history';
import { evaluateBudgetThresholds, type ThresholdSignal, type ThresholdState } from './thresholds';
import { calculateBudgetUsage, type BudgetUsage } from './usage';

export type BudgetSummary = Readonly<{
  period: BudgetPeriod; usage: BudgetUsage; correction: ReturnType<typeof rolloverCorrection>;
}>;
export type BudgetRefresh = Readonly<{
  periods: readonly BudgetPeriod[]; summaries: readonly BudgetSummary[];
  thresholdStates: readonly ThresholdState[]; signals: readonly ThresholdSignal[]; catchUpPending: boolean;
}>;

// Deterministic read/resume operation. The encrypted repository must read inputs
// and commit the returned snapshots and threshold keys in ONE transaction before
// publishing in-app signals. Replays with the committed state produce no signal.
// This function neither authenticates nor persists anything.
export function refreshBudget(input: Readonly<{
  budget: BudgetDefinition; accounts: readonly LedgerAccount[]; activities: readonly BudgetActivity[]; today: string;
  periods?: readonly BudgetPeriod[]; thresholdStates?: readonly ThresholdState[];
  categories?: readonly Readonly<{ id: string }>[]; baselineThresholds?: boolean; maxNewPeriods?: number;
}>): BudgetRefresh {
  const { budget, accounts, activities, today, categories } = input;
  requireCalendarDate(today);
  const periods = materializeBudgetPeriods(budget, accounts, activities, today, input.periods, categories, input.maxNewPeriods);
  const states = new Map<string, ThresholdState>();
  const periodIds = new Set(periods.map((period) => period.id));
  for (const state of input.thresholdStates ?? []) {
    if (states.has(state.periodId) || !periodIds.has(state.periodId)) throw new BudgetError('invalid_threshold_state');
    states.set(state.periodId, state);
  }
  const summaries: BudgetSummary[] = [];
  const thresholdStates: ThresholdState[] = [];
  const signals: ThresholdSignal[] = [];
  for (const [index, period] of periods.entries()) {
    const usage = calculateBudgetUsage(budget, period, activities, accounts, today, categories);
    const previous = periods[index - 1];
    const correction = previous ? rolloverCorrection(budget, period, previous, accounts, activities, today, categories) : null;
    const threshold = evaluateBudgetThresholds(budget, period, usage, today, states.get(period.id), input.baselineThresholds ? 'baseline' : 'live');
    summaries.push(Object.freeze({ period, usage, correction }));
    thresholdStates.push(threshold.state);
    if (threshold.signal) signals.push(threshold.signal);
  }
  const last = periods[periods.length - 1];
  const catchUpPending = !budget.archived && last !== undefined && last.end <= today && revisionAt(budget, last.start).rule.kind !== 'one-off';
  return Object.freeze({ periods, summaries: Object.freeze(summaries), thresholdStates: Object.freeze(thresholdStates),
    signals: Object.freeze(signals), catchUpPending });
}
