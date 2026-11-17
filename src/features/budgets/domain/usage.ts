import { daysBetween, requireCalendarDate } from '@/core/dates/calendarMath';
import { addMoney, createMoney, readMoney, subtractMoney, sumMoney, type Money } from '@/core/money/money';
import type { LedgerAccount } from '@/features/accounts/domain/account';
import type { BudgetActivity } from './activity';
import { validateBudgetActivity } from './activity';
import { BudgetError, type BudgetDefinition } from './budget';
import { containsDate, type PeriodWindow } from './periods';

export type BudgetUsage = Readonly<{
  budgetId: string; periodStart: string; periodEnd: string;
  posted: Money; pending: Money; refunds: Money; netPosted: Money; used: Money;
  remaining: Money; overspending: Money; dailyAllowance: Money | null;
  progressBasisPoints: number | null; utilizationPercent: string | null;
  state: 'upcoming' | 'active' | 'ended'; reviewIds: readonly string[];
}>;

export function calculateBudgetUsage(budget: BudgetDefinition, period: PeriodWindow & Readonly<{ allowance: Money }>,
  activities: readonly BudgetActivity[], accounts: readonly LedgerAccount[], today: string,
  categories?: readonly Readonly<{ id: string }>[]): BudgetUsage {
  requireCalendarDate(period.start); requireCalendarDate(period.end); requireCalendarDate(today);
  if (period.end <= period.start) throw new BudgetError('invalid_period');
  const allowance = readMoney(period.allowance);
  if (allowance.currency !== budget.currency || allowance.minorUnits < 0) throw new BudgetError('invalid_allowance');
  const validated = validateBudgetActivity(activities, accounts, categories);
  const posted: Money[] = []; const pending: Money[] = []; const refunds: Money[] = [];
  for (const item of validated.activities) {
    if (item.amount.currency !== budget.currency || !containsDate(period, item.date)) continue;
    if (budget.scope.kind === 'card' && item.accountId !== budget.scope.id) continue;
    if (item.kind === 'expense' && item.voided) continue;
    const scope = budget.scope;
    const eligible = scope.kind === 'category'
      ? sumMoney(item.allocations.filter((part) => part.categoryId === scope.id).map((part) => part.amount), budget.currency)
      : item.amount;
    if (item.kind === 'refund') refunds.push(eligible);
    else if (item.status === 'pending') pending.push(eligible);
    else posted.push(eligible);
  }
  const postedMoney = sumMoney(posted, budget.currency);
  const pendingMoney = sumMoney(pending, budget.currency);
  const refundMoney = sumMoney(refunds, budget.currency);
  const netPosted = subtractMoney(postedMoney, refundMoney);
  const used = addMoney(netPosted, pendingMoney);
  const remaining = subtractMoney(allowance, used);
  const state = today < period.start ? 'upcoming' : today >= period.end ? 'ended' : 'active';
  const dailyAllowance = state === 'active'
    ? createMoney(Number(BigInt(Math.max(0, remaining.minorUnits)) / BigInt(daysBetween(today, period.end))), budget.currency)
    : null;
  const basisPoints = allowance.minorUnits > 0
    ? BigInt(Math.max(0, used.minorUnits)) * 10_000n / BigInt(allowance.minorUnits) : null;
  const utilizationPercent = basisPoints === null ? null : `${basisPoints / 100n}.${String(basisPoints % 100n).padStart(2, '0')}`;
  const progressBasisPoints = basisPoints === null ? (used.minorUnits > 0 ? 10_000 : null) : Number(basisPoints > 10_000n ? 10_000n : basisPoints);
  return Object.freeze({ budgetId: budget.id, periodStart: period.start, periodEnd: period.end,
    posted: postedMoney, pending: pendingMoney, refunds: refundMoney, netPosted, used, remaining,
    overspending: createMoney(Math.max(0, -remaining.minorUnits), budget.currency), dailyAllowance,
    progressBasisPoints, utilizationPercent, state, reviewIds: validated.reviewIds });
}
