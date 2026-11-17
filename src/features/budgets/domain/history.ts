import { daysBetween, requireCalendarDate } from '@/core/dates/calendarMath';
import { addMoney, createMoney, readMoney, subtractMoney, type Money } from '@/core/money/money';
import type { LedgerAccount } from '@/features/accounts/domain/account';
import type { BudgetActivity } from './activity';
import { BudgetError, revisionAt, validateBudgetConfiguration, type BudgetDefinition, type BudgetRevision } from './budget';
import { resolveBudgetPeriod, type PeriodWindow } from './periods';
import { calculateBudgetUsage } from './usage';

export type BudgetPeriod = PeriodWindow & Readonly<{
  id: string; budgetId: string; revisionId: string; timeZone: string; issuedOn: string;
  baseAllowance: Money; rollover: Money; allowance: Money;
  previousPeriodId: string | null; rolloverBasisUsage: Money | null;
}>;

export function periodBaseAllowance(revision: BudgetRevision, start: string): Money {
  const config = validateBudgetConfiguration(revision);
  const normal = resolveBudgetPeriod(config.rule, start);
  if (start < normal.start || start >= normal.end) throw new BudgetError('invalid_transition');
  const numerator = BigInt(config.amount.minorUnits) * BigInt(daysBetween(start, normal.end));
  return createMoney(Number(numerator / BigInt(daysBetween(normal.start, normal.end))), config.amount.currency);
}

function cappedRollover(base: Money, previousAllowance: Money, previousUsage: Money): Money {
  const unused = BigInt(previousAllowance.minorUnits) - BigInt(previousUsage.minorUnits);
  const cap = BigInt(base.minorUnits);
  return createMoney(Number(unused < 0n ? 0n : unused > cap ? cap : unused), base.currency);
}

function validateIssuedPeriod(budget: BudgetDefinition, period: BudgetPeriod, start: string, previous: BudgetPeriod | undefined): void {
  const revision = revisionAt(budget, start);
  const normal = resolveBudgetPeriod(revision.rule, start);
  const base = periodBaseAllowance(revision, start);
  if (period.id !== `${budget.id}:${start}` || period.budgetId !== budget.id || period.revisionId !== revision.id ||
      period.timeZone !== budget.timeZone || period.start !== start || period.end !== normal.end ||
      period.previousPeriodId !== (previous?.id ?? null) || requireCalendarDate(period.issuedOn) < start) throw new BudgetError('invalid_snapshot');
  const snapshotBase = readMoney(period.baseAllowance);
  const rollover = readMoney(period.rollover);
  const allowance = readMoney(period.allowance);
  if (snapshotBase.currency !== budget.currency || rollover.currency !== budget.currency || allowance.currency !== budget.currency ||
      snapshotBase.minorUnits !== base.minorUnits || rollover.minorUnits < 0 || rollover.minorUnits > base.minorUnits ||
      allowance.minorUnits !== addMoney(base, rollover).minorUnits) throw new BudgetError('invalid_snapshot');
  if (revision.rollover && previous) {
    const basis = readMoney(period.rolloverBasisUsage);
    if (basis.currency !== budget.currency || cappedRollover(base, previous.allowance, basis).minorUnits !== rollover.minorUnits) {
      throw new BudgetError('invalid_rollover_snapshot');
    }
  } else if (period.rolloverBasisUsage !== null || rollover.minorUnits !== 0) throw new BudgetError('invalid_rollover_snapshot');
}

// Returns new immutable snapshots; repository integration must commit them with
// UNIQUE(budget_id,start_date) inside its authenticated SQLite transaction.
export function materializeBudgetPeriods(budget: BudgetDefinition, accounts: readonly LedgerAccount[],
  activities: readonly BudgetActivity[], today: string, issued: readonly BudgetPeriod[] = [],
  categories?: readonly Readonly<{ id: string }>[], maxNewPeriods = 256): readonly BudgetPeriod[] {
  requireCalendarDate(today);
  if (!Number.isInteger(maxNewPeriods) || maxNewPeriods < 1 || maxNewPeriods > 1024) throw new BudgetError('invalid_batch_size');
  const initial = budget.revisions[0];
  if (!initial) throw new BudgetError('missing_revision');
  let cursor = requireCalendarDate(initial.effectiveFrom);
  const result: BudgetPeriod[] = [];
  for (const period of issued) {
    const previous = result[result.length - 1];
    if (previous && revisionAt(budget, previous.start).rule.kind === 'one-off') {
      throw new BudgetError('one_off_successor');
    }
    validateIssuedPeriod(budget, period, cursor, result[result.length - 1]);
    result.push(Object.freeze({ ...period, baseAllowance: readMoney(period.baseAllowance), rollover: readMoney(period.rollover),
      allowance: readMoney(period.allowance), rolloverBasisUsage: period.rolloverBasisUsage === null ? null : readMoney(period.rolloverBasisUsage) }));
    cursor = period.end;
  }
  if (budget.archived) return Object.freeze(result);
  let created = 0;
  while (cursor <= today && created < maxNewPeriods) {
    const previous = result[result.length - 1];
    if (previous && revisionAt(budget, previous.start).rule.kind === 'one-off') break;
    const revision = revisionAt(budget, cursor);
    const window = resolveBudgetPeriod(revision.rule, cursor);
    if (cursor < window.start || window.end <= cursor) throw new BudgetError('noncontiguous_period');
    const baseAllowance = periodBaseAllowance(revision, cursor);
    const basis = revision.rollover && previous
      ? calculateBudgetUsage(budget, previous, activities, accounts, today, categories).used : null;
    const rollover = basis && previous ? cappedRollover(baseAllowance, previous.allowance, basis) : createMoney(0, budget.currency);
    const next: BudgetPeriod = Object.freeze({ id: `${budget.id}:${cursor}`, budgetId: budget.id,
      revisionId: revision.id, start: cursor, end: window.end, timeZone: budget.timeZone, issuedOn: today,
      baseAllowance, rollover, allowance: addMoney(baseAllowance, rollover), previousPeriodId: previous?.id ?? null, rolloverBasisUsage: basis });
    result.push(next);
    created++;
    cursor = next.end;
    if (revision.rule.kind === 'one-off') break;
  }
  return Object.freeze(result);
}

export function rolloverCorrection(budget: BudgetDefinition, period: BudgetPeriod, previous: BudgetPeriod,
  accounts: readonly LedgerAccount[], activities: readonly BudgetActivity[], today: string,
  categories?: readonly Readonly<{ id: string }>[]): Readonly<{ usageDifference: Money; rolloverDifference: Money }> | null {
  if (period.rolloverBasisUsage === null) return null;
  if (period.previousPeriodId !== previous.id || period.budgetId !== budget.id || previous.budgetId !== budget.id) throw new BudgetError('invalid_snapshot');
  const corrected = calculateBudgetUsage(budget, previous, activities, accounts, today, categories).used;
  return Object.freeze({ usageDifference: subtractMoney(corrected, period.rolloverBasisUsage),
    rolloverDifference: subtractMoney(cappedRollover(period.baseAllowance, previous.allowance, corrected), period.rollover) });
}
