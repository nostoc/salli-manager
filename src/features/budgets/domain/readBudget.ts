import { addCalendarDays, requireCalendarDate, validateFinancialTimeZone } from '@/core/dates/calendarMath';
import { readMoney } from '@/core/money/money';
import type { LedgerAccount } from '@/features/accounts/domain/account';
import { DEFAULT_CATEGORIES } from '@/features/transactions/domain/categories';
import { BudgetError, createBudgetDefinition, validateBudgetConfiguration, validateThresholds, type BudgetDefinition,
  type BudgetInput, type BudgetRevision } from './budget';
import { resolveBudgetPeriod } from './periods';

// Reconstruct immutable, canonical objects from untrusted decrypted records.
// Do not cast a parsed JSON document into a trusted domain entity.
export function readBudgetDefinition(value: unknown, accounts: readonly LedgerAccount[],
  categories: readonly Readonly<{ id: string }>[] = DEFAULT_CATEGORIES): BudgetDefinition {
  if (!value || typeof value !== 'object') throw new BudgetError('invalid_definition');
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.revisions) || raw.revisions.length === 0 || raw.revisions.length > 10000 ||
      typeof raw.archived !== 'boolean') throw new BudgetError('invalid_definition');
  const first = raw.revisions[0] as Record<string, unknown> | null;
  if (!first || typeof first !== 'object') throw new BudgetError('invalid_definition');
  const definition = createBudgetDefinition({ id: raw.id, name: raw.name, scope: raw.scope,
    amount: readMoney(first.amount), rule: first.rule, rollover: first.rollover, startDate: first.effectiveFrom,
    timeZone: raw.timeZone, thresholds: raw.thresholds } as BudgetInput,
    accounts.map((account) => ({ ...account, archived: false })), categories);
  if (raw.currency !== definition.currency || first.effectiveFrom !== definition.revisions[0]?.effectiveFrom ||
      typeof raw.timeZone !== 'string' || !Array.isArray(raw.thresholds)) throw new BudgetError('invalid_definition');
  const revisions: BudgetRevision[] = [];
  for (const [index, item] of raw.revisions.entries()) {
    if (!item || typeof item !== 'object') throw new BudgetError('invalid_revision');
    const revision = item as BudgetRevision;
    const effectiveFrom = requireCalendarDate(revision.effectiveFrom);
    const config = validateBudgetConfiguration(revision, definition.currency);
    if (revision.id !== `${definition.id}:revision:${index + 1}` ||
        (config.rule.kind === 'billing' && definition.scope.kind !== 'card') ||
        (config.rule.kind === 'weekly' && definition.scope.kind === 'card')) throw new BudgetError('invalid_revision');
    const previous = revisions[index - 1];
    if (previous) {
      if (effectiveFrom < previous.effectiveFrom || (effectiveFrom > previous.effectiveFrom && previous.rule.kind === 'one-off')) throw new BudgetError('invalid_revision');
      if (effectiveFrom > previous.effectiveFrom && resolveBudgetPeriod(previous.rule, addCalendarDays(effectiveFrom, -1)).end !== effectiveFrom) {
        throw new BudgetError('invalid_revision_boundary');
      }
      if ((config.rule.kind === 'repeating' && config.rule.anchor !== effectiveFrom) ||
          (config.rule.kind === 'one-off' && config.rule.start !== effectiveFrom)) throw new BudgetError('invalid_revision_boundary');
    }
    revisions.push(Object.freeze({ ...config, id: revision.id, effectiveFrom }));
  }
  return Object.freeze({ ...definition, timeZone: validateFinancialTimeZone(raw.timeZone),
    thresholds: validateThresholds(raw.thresholds as number[]), archived: raw.archived, revisions: Object.freeze(revisions) });
}
