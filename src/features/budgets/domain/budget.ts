import { DEFAULT_FINANCIAL_TIME_ZONE, requireCalendarDate, validateFinancialTimeZone } from '@/core/dates/calendarMath';
import { readMoney, type CurrencyCode, type Money } from '@/core/money/money';
import { createLedgerAccount, type LedgerAccount } from '@/features/accounts/domain/account';
import { DEFAULT_CATEGORIES } from '@/features/transactions/domain/categories';
import { containsDate, resolveBudgetPeriod, validatePeriodRule, type BudgetPeriodRule } from './periods';

export class BudgetError extends Error {
  constructor(readonly code: string) { super('Invalid budget configuration or activity.'); this.name = 'BudgetError'; }
}

export type BudgetScope = Readonly<{ kind: 'overall' }> | Readonly<{ kind: 'card' | 'category'; id: string }>;
export type BudgetConfiguration = Readonly<{ amount: Money; rule: BudgetPeriodRule; rollover: boolean }>;
export type BudgetRevision = BudgetConfiguration & Readonly<{ id: string; effectiveFrom: string }>;
export type BudgetDefinition = Readonly<{
  id: string; name: string; scope: BudgetScope; currency: CurrencyCode; timeZone: string;
  thresholds: readonly number[]; revisions: readonly BudgetRevision[]; archived: boolean;
}>;
export type BudgetInput = Readonly<{
  id: string; name: string; scope: BudgetScope; amount: Money; rule: BudgetPeriodRule;
  startDate: string; timeZone?: string; rollover?: boolean; thresholds?: readonly number[];
}>;

export function requireBudgetId(id: string): string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 192 || /[^A-Za-z0-9_.:-]/.test(id)) throw new BudgetError('invalid_id');
  return id;
}

export function validateThresholds(values: readonly number[]): readonly number[] {
  if (!Array.isArray(values) || values.some((value) => !Number.isInteger(value) || value < 1 || value > 100) ||
      new Set(values).size !== values.length) throw new BudgetError('invalid_thresholds');
  return Object.freeze([...values].sort((a, b) => a - b));
}

export function validateBudgetConfiguration(input: BudgetConfiguration, currency?: CurrencyCode): BudgetConfiguration {
  const amount = readMoney(input.amount);
  if (amount.minorUnits < 0 || (currency !== undefined && amount.currency !== currency)) throw new BudgetError('invalid_allowance');
  if (typeof input.rollover !== 'boolean') throw new BudgetError('invalid_rollover');
  // Even a completely unused period must be issuable with its maximum capped
  // carry. Reject configurations that would otherwise break a future read.
  if (input.rollover && BigInt(amount.minorUnits) * 2n > BigInt(Number.MAX_SAFE_INTEGER)) throw new BudgetError('rollover_overflow');
  const rule = validatePeriodRule(input.rule);
  if (rule.kind === 'one-off' && input.rollover) throw new BudgetError('one_off_rollover');
  return Object.freeze({ amount, rule, rollover: input.rollover });
}

export function createBudgetDefinition(
  input: BudgetInput, accounts: readonly LedgerAccount[], categories: readonly Readonly<{ id: string }>[] = DEFAULT_CATEGORIES,
): BudgetDefinition {
  requireBudgetId(input.id);
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) throw new BudgetError('invalid_name');
  const config = validateBudgetConfiguration({ amount: input.amount, rule: input.rule, rollover: input.rollover ?? false });
  const requestedScope = input.scope;
  if (!requestedScope || typeof requestedScope !== 'object') throw new BudgetError('invalid_scope');
  let scope: BudgetScope;
  switch (requestedScope.kind) {
    case 'overall': scope = Object.freeze({ kind: 'overall' }); break;
    case 'card': {
      const account = accounts.find((item) => item.id === requestedScope.id);
      if (!account) throw new BudgetError('unknown_card');
      const card = createLedgerAccount(account);
      if (card.kind !== 'credit-card' || card.archived || card.currency !== config.amount.currency) throw new BudgetError('invalid_card');
      if (config.rule.kind === 'weekly') throw new BudgetError('invalid_card_period');
      scope = Object.freeze({ kind: 'card', id: card.id });
      break;
    }
    case 'category':
      if (!categories.some((item) => item.id === requestedScope.id) || config.rule.kind === 'billing') throw new BudgetError('invalid_category');
      scope = Object.freeze({ kind: 'category', id: requestedScope.id });
      break;
    default: throw new BudgetError('invalid_scope');
  }
  if (scope.kind !== 'card' && config.rule.kind === 'billing') throw new BudgetError('invalid_billing_scope');
  const window = resolveBudgetPeriod(config.rule, requireCalendarDate(input.startDate));
  const initial = Object.freeze({ ...config, id: `${input.id}:revision:1`, effectiveFrom: window.start });
  return Object.freeze({ id: input.id, name: input.name.trim(), scope, currency: config.amount.currency,
    timeZone: validateFinancialTimeZone(input.timeZone ?? DEFAULT_FINANCIAL_TIME_ZONE),
    thresholds: validateThresholds(input.thresholds ?? [50, 75, 90, 100]), revisions: Object.freeze([initial]), archived: false });
}

export function revisionAt(budget: BudgetDefinition, date: string): BudgetRevision {
  requireCalendarDate(date);
  let selected: BudgetRevision | undefined;
  for (const revision of budget.revisions) {
    if (revision.effectiveFrom <= date && (!selected || revision.effectiveFrom >= selected.effectiveFrom)) selected = revision;
  }
  if (!selected) throw new BudgetError('no_effective_revision');
  return selected;
}

// Scheduled revisions remain in the audit history; the latest pending edit wins.
export function scheduleBudgetRevision(budget: BudgetDefinition, input: BudgetConfiguration, asOf: string,
  current: Readonly<{ budgetId: string; start: string; end: string }>): BudgetDefinition {
  requireCalendarDate(asOf);
  if (budget.archived || current.budgetId !== budget.id || !containsDate(current, asOf)) throw new BudgetError('no_active_period');
  const activeRevision = revisionAt(budget, current.start);
  const activeWindow = resolveBudgetPeriod(activeRevision.rule, current.start);
  if (current.end !== activeWindow.end || current.start !== (activeRevision.effectiveFrom > activeWindow.start
    ? activeRevision.effectiveFrom : activeWindow.start)) throw new BudgetError('invalid_period');
  if (activeRevision.rule.kind === 'one-off') throw new BudgetError('one_off_has_no_next_period');
  const config = validateBudgetConfiguration(input, budget.currency);
  if (budget.scope.kind !== 'card' && config.rule.kind === 'billing') throw new BudgetError('invalid_billing_scope');
  if (budget.scope.kind === 'card' && config.rule.kind === 'weekly') throw new BudgetError('invalid_card_period');
  const nextRule = config.rule.kind === 'repeating' ? { ...config.rule, anchor: current.end } : config.rule;
  if (nextRule.kind === 'one-off' && nextRule.start !== current.end) throw new BudgetError('noncontiguous_transition');
  const revision = Object.freeze({ ...config, rule: validatePeriodRule(nextRule),
    id: `${budget.id}:revision:${budget.revisions.length + 1}`, effectiveFrom: current.end });
  return Object.freeze({ ...budget, revisions: Object.freeze([...budget.revisions, revision]) });
}

export function setBudgetThresholds(budget: BudgetDefinition, thresholds: readonly number[]): BudgetDefinition {
  return Object.freeze({ ...budget, thresholds: validateThresholds(thresholds) });
}

export function archiveBudget(budget: BudgetDefinition): BudgetDefinition {
  return Object.freeze({ ...budget, archived: true });
}
