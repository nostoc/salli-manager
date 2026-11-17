import type { SQLiteDatabase } from 'expo-sqlite';
import { createLedgerAccount, type LedgerAccount } from '@/features/accounts/domain/account';
import { createCardProfile, type CardProfile } from '@/features/accounts/domain/cardProfile';
import type { ManualEntryDraft } from '@/features/transactions/domain/manualLedger';
import { createTransaction, ledgerBudgetActivity, projectLedger, type LedgerTransaction } from '@/features/transactions/domain/ledger';
import { readBudgetDefinition } from '@/features/budgets/domain/readBudget';
import { refreshBudget, type BudgetRefresh } from '@/features/budgets/domain/refresh';
import type { BudgetDefinition } from '@/features/budgets/domain/budget';
import type { BudgetPeriod } from '@/features/budgets/domain/history';
import { financialDateAt } from '@/core/dates/calendarMath';
import { VaultError } from '@/core/security/nativeVault';
import type { ThresholdSignal } from '@/features/budgets/domain/thresholds';
import { createBudgetDefinition, validateThresholds } from '@/features/budgets/domain/budget';
import { requireCalendarDate } from '@/core/dates/calendarMath';
import { DEFAULT_CATEGORIES } from '@/features/transactions/domain/categories';

export type AccountRecord = LedgerAccount & Readonly<{ name: string }>;
export type BudgetRecord = Readonly<{ definition: BudgetDefinition; version: number; refresh: BudgetRefresh }>;
export type FinanceSnapshot = Readonly<{
  accounts: readonly AccountRecord[]; profiles: readonly CardProfile[]; entries: readonly LedgerTransaction[];
  budgets: readonly BudgetRecord[];
  signals: readonly ThresholdSignal[];
}>;

export function requirePrivateLabel(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\u0000-\u001f]/.test(value) || /\d(?:[ -]?\d){11,18}/.test(value)) {
    throw new RangeError('Use a short name without full account or card numbers.');
  }
  return value.trim();
}

function parseRecord(payload: string): unknown {
  if (typeof payload !== 'string' || payload.length > 1_048_576) throw new VaultError('INVALID_RECORD');
  try { return JSON.parse(payload) as unknown; } catch { throw new VaultError('INVALID_RECORD'); }
}
async function change(db: SQLiteDatabase, id: string, kind: string, before: string | null, after: string) {
  await db.runAsync('INSERT INTO changes(entity_id,kind,previous_payload,next_payload) VALUES (?,?,?,?)', id, kind, before, after);
}

// All calls require VaultSession.transact. No connection, key or mutable cache is
// exported by a screen. Bound SQL values never interpolate user-provided text.
export async function loadFinance(db: SQLiteDatabase, instant = new Date(), baselineBudgetId?: string | true): Promise<FinanceSnapshot> {
  const accountRows = await db.getAllAsync<{ id: string; payload: string }>('SELECT id,payload FROM accounts ORDER BY id');
  const accounts = accountRows.map((row) => {
    const raw = parseRecord(row.payload) as AccountRecord;
    const account = createLedgerAccount(raw);
    if (account.id !== row.id || raw.currency !== account.currency || typeof raw.archived !== 'boolean') throw new VaultError('INVALID_RECORD');
    return Object.freeze({ ...account, name: requirePrivateLabel(raw.name) });
  });
  const historic = accounts.map((account) => ({ ...account, archived: false }));
  const entries = (await db.getAllAsync<{ id: string; payload: string }>('SELECT id,payload FROM transactions ORDER BY id')).map((row) => {
    const raw = parseRecord(row.payload) as LedgerTransaction;
    if (!raw || !['pending', 'confirmed', 'reconciled'].includes(raw.status) || typeof raw.voided !== 'boolean' ||
        typeof raw.estimated !== 'boolean' || !['manual', 'sms'].includes(raw.origin) || !Object.hasOwn(raw, 'merchant')) throw new VaultError('INVALID_RECORD');
    const entry = createTransaction(historic, raw, true);
    if (entry.id !== row.id) throw new VaultError('INVALID_RECORD');
    return entry;
  });
  projectLedger(accounts, entries); // Validate lifecycle and canonical totals on every durable read.
  const profiles = (await db.getAllAsync<{ account_id: string; payload: string }>('SELECT account_id,payload FROM card_profiles')).map((row) => {
    const account = accounts.find((item) => item.id === row.account_id);
    if (!account) throw new VaultError('INVALID_RECORD');
    return createCardProfile(account, parseRecord(row.payload) as CardProfile);
  });
  const activities = ledgerBudgetActivity(accounts, entries);
  const budgets: BudgetRecord[] = [];
  for (const row of await db.getAllAsync<{ id: string; payload: string; version: number }>('SELECT id,payload,version FROM budgets ORDER BY id')) {
    const definition = readBudgetDefinition(parseRecord(row.payload), accounts);
    requirePrivateLabel(definition.name);
    if (definition.id !== row.id || !Number.isSafeInteger(row.version) || row.version < 1) throw new VaultError('INVALID_RECORD');
    const periodRows = await db.getAllAsync<{ id: string; start_date: string; payload: string }>(
      'SELECT id,start_date,payload FROM budget_periods WHERE budget_id=? ORDER BY start_date', row.id);
    const periods = periodRows.map((stored) => {
      const period = parseRecord(stored.payload) as BudgetPeriod;
      if (period.id !== stored.id || period.start !== stored.start_date) throw new VaultError('INVALID_RECORD');
      return period;
    });
    const thresholds = await db.getAllAsync<{ period_id: string; threshold: number }>(
      'SELECT t.period_id,t.threshold FROM budget_thresholds t JOIN budget_periods p ON p.id=t.period_id WHERE p.budget_id=?', row.id);
    const states = periods.map((period) => ({ periodId: period.id, reached: thresholds.filter((t) => t.period_id === period.id).map((t) => t.threshold) }));
    const refresh = refreshBudget({ budget: definition, accounts, activities, today: financialDateAt(instant, definition.timeZone),
      periods, thresholdStates: states, baselineThresholds: baselineBudgetId === true || baselineBudgetId === row.id });
    const existingIds = new Set(periods.map((period) => period.id));
    for (const period of refresh.periods) {
      if (!existingIds.has(period.id)) await db.runAsync('INSERT INTO budget_periods(id,budget_id,start_date,payload) VALUES (?,?,?,?)',
        period.id, row.id, period.start, JSON.stringify(period));
    }
    for (const state of refresh.thresholdStates) for (const threshold of state.reached) {
      await db.runAsync('INSERT OR IGNORE INTO budget_thresholds(period_id,threshold) VALUES (?,?)', state.periodId, threshold);
    }
    for (const signal of refresh.signals) await db.runAsync(
      'INSERT OR IGNORE INTO budget_signals(id,budget_id,payload) VALUES (?,?,?)', `${signal.periodId}:${signal.highest}`, row.id, JSON.stringify(signal));
    budgets.push(Object.freeze({ definition, version: row.version, refresh }));
  }
  const signals = (await db.getAllAsync<{ id: string; budget_id: string; payload: string }>('SELECT id,budget_id,payload FROM budget_signals WHERE acknowledged=0 ORDER BY rowid DESC LIMIT 100'))
    .map((row): ThresholdSignal => {
      const signal = parseRecord(row.payload) as ThresholdSignal;
      if (!signal || typeof signal !== 'object' || signal.budgetId !== row.budget_id || row.id !== `${signal.periodId}:${signal.highest}` ||
          !budgets.some((record) => record.definition.id === signal.budgetId && record.refresh.periods.some((period) => period.id === signal.periodId))) throw new VaultError('INVALID_RECORD');
      const thresholds = validateThresholds(signal.thresholds);
      if (thresholds.length === 0 || thresholds[thresholds.length - 1] !== signal.highest) throw new VaultError('INVALID_RECORD');
      return Object.freeze({ budgetId: signal.budgetId, periodId: signal.periodId, highest: signal.highest,
        date: requireCalendarDate(signal.date), thresholds });
    });
  return Object.freeze({ accounts: Object.freeze(accounts), profiles: Object.freeze(profiles), entries: Object.freeze(entries), budgets: Object.freeze(budgets), signals: Object.freeze(signals) });
}

export async function insertAccount(db: SQLiteDatabase, account: AccountRecord, profile?: CardProfile, opening?: ManualEntryDraft): Promise<void> {
  const canonical = Object.freeze({ ...createLedgerAccount(account), name: requirePrivateLabel(account.name) });
  const payload = JSON.stringify(canonical);
  await db.runAsync('INSERT INTO accounts(id,payload) VALUES (?,?)', canonical.id, payload);
  if (canonical.kind === 'credit-card') {
    const card = createCardProfile(canonical, profile);
    await db.runAsync('INSERT INTO card_profiles(account_id,payload) VALUES (?,?)', canonical.id, JSON.stringify(card));
  }
  if (opening) {
    if (opening.kind !== 'opening-balance' || opening.accountId !== canonical.id) throw new VaultError('INVALID_OPENING');
    const entry = createTransaction([canonical], opening);
    await db.runAsync('INSERT INTO transactions(id,payload) VALUES (?,?)', entry.id, JSON.stringify(entry));
    await db.runAsync("INSERT INTO source_observations(id,source_key,fingerprint,transaction_id,payload,expires_at,decision) VALUES (?,?,?,?,?,0,'manual')",
      `manual:${entry.id}`, `manual:${entry.id}`, '', entry.id, JSON.stringify({ kind: 'manual' }));
  }
  await change(db, canonical.id, 'create-account', null, payload);
}

export async function insertManualEntry(db: SQLiteDatabase, draft: ManualEntryDraft): Promise<void> {
  const current = await loadFinance(db);
  const entry = createTransaction(current.accounts, draft);
  if (entry.kind === 'expense' && !DEFAULT_CATEGORIES.some((category) => category.id === entry.categoryId)) throw new VaultError('INVALID_CATEGORY');
  projectLedger(current.accounts, [...current.entries, entry]);
  const payload = JSON.stringify(entry);
  await db.runAsync('INSERT INTO transactions(id,payload) VALUES (?,?)', entry.id, payload);
  await db.runAsync("INSERT INTO source_observations(id,source_key,fingerprint,transaction_id,payload,expires_at,decision) VALUES (?,?,?,?,?,0,'manual')",
    `manual:${entry.id}`, `manual:${entry.id}`, '', entry.id, JSON.stringify({ kind: 'manual' }));
  await change(db, entry.id, 'create-manual-entry', null, payload);
}

export async function saveBudget(db: SQLiteDatabase, definition: BudgetDefinition, expectedVersion: number | null): Promise<void> {
  requirePrivateLabel(definition.name);
  const current = await loadFinance(db);
  const canonical = readBudgetDefinition(definition, current.accounts);
  const payload = JSON.stringify(canonical);
  const existing = current.budgets.find((item) => item.definition.id === canonical.id);
  if (expectedVersion === null) {
    if (existing) throw new VaultError('CONFLICT');
    if (canonical.revisions.length !== 1 || canonical.archived) throw new VaultError('INVALID_NEW_BUDGET');
    const initial = canonical.revisions[0]!;
    createBudgetDefinition({ id: canonical.id, name: canonical.name, scope: canonical.scope,
      amount: initial.amount, rule: initial.rule, startDate: initial.effectiveFrom, rollover: initial.rollover,
      timeZone: canonical.timeZone, thresholds: canonical.thresholds }, current.accounts);
    await db.runAsync('INSERT INTO budgets(id,payload,version) VALUES (?,?,1)', canonical.id, payload);
  } else {
    if (!existing || existing.version !== expectedVersion) throw new VaultError('CONFLICT');
    // Issued history cannot be edited, removed or reattributed by a stale form.
    const old = existing.definition;
    if (old.currency !== canonical.currency || old.timeZone !== canonical.timeZone || JSON.stringify(old.scope) !== JSON.stringify(canonical.scope) ||
        old.revisions.some((revision, index) => JSON.stringify(revision) !== JSON.stringify(canonical.revisions[index]))) throw new VaultError('IMMUTABLE_HISTORY');
    if (old.archived && (!canonical.archived || old.revisions.length !== canonical.revisions.length)) throw new VaultError('ARCHIVED');
    const currentPeriod = existing.refresh.periods.find((period) => period.start <= financialDateAt(new Date(), old.timeZone) &&
      financialDateAt(new Date(), old.timeZone) < period.end);
    if (canonical.revisions.slice(old.revisions.length).some((revision) => !currentPeriod || revision.effectiveFrom !== currentPeriod.end)) {
      throw new VaultError('PROSPECTIVE_EDIT_REQUIRED');
    }
    await db.runAsync('UPDATE budgets SET payload=?,version=version+1 WHERE id=? AND version=?', payload, canonical.id, expectedVersion);
  }
  await change(db, canonical.id, 'save-budget', existing ? JSON.stringify(existing.definition) : null, payload);
}
