/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createMoney } from '@/core/money/money';
import { createLedgerAccount } from '@/features/accounts/domain/account';
import { createBudgetDefinition, scheduleBudgetRevision, setBudgetThresholds } from '@/features/budgets/domain/budget';
import { migrateDatabase } from '../schema';
import { insertAccount, insertManualEntry, loadFinance, requirePrivateLabel, saveBudget } from '../financeRepository';

// Real SQLite constraint/rollback tests, NOT evidence of Android SQLCipher.
let native: DatabaseSync;
let db: SQLiteDatabase;
const money = (minorUnits: number) => createMoney(minorUnits);
const card = { ...createLedgerAccount({ id: 'card-a', kind: 'credit-card' }), name: 'Synthetic card' };
const bank = { ...createLedgerAccount({ id: 'bank-a', kind: 'bank' }), name: 'Synthetic bank' };
async function transaction<T>(work: () => Promise<T>): Promise<T> {
  native.exec('BEGIN IMMEDIATE');
  try { const result = await work(); native.exec('COMMIT'); return result; }
  catch (error) { native.exec('ROLLBACK'); throw error; }
}
beforeEach(async () => {
  jest.useFakeTimers().setSystemTime(new Date('2024-01-15T08:00:00Z'));
  native = new DatabaseSync(':memory:');
  native.exec('PRAGMA foreign_keys=ON');
  db = {
    execAsync: async (sql: string) => { native.exec(sql); },
    runAsync: async (sql: string, ...values: SQLInputValue[]) => native.prepare(sql).run(...values),
    getFirstAsync: async (sql: string, ...values: SQLInputValue[]) => native.prepare(sql).get(...values) ?? null,
    getAllAsync: async (sql: string, ...values: SQLInputValue[]) => native.prepare(sql).all(...values),
  } as unknown as SQLiteDatabase;
  await migrateDatabase(db);
  await transaction(async () => { await insertAccount(db, card); await insertAccount(db, bank); });
});
afterEach(() => { native.close(); jest.useRealTimers(); });

function definition(rollover = false) {
  return createBudgetDefinition({ id: 'b', name: 'Synthetic allowance', scope: { kind: 'card', id: card.id },
    amount: money(10000), startDate: '2024-01-15', rule: { kind: 'monthly' }, rollover }, [card, bank]);
}
const purchase = (id: string, amount = 9000) => ({ id, kind: 'expense' as const, accountId: card.id, amount: money(amount), date: '2024-01-15', categoryId: 'groceries' });

describe('encrypted repository relational contracts', () => {
  it('migrates the existing ledger without changing issued budget history or user records', async () => {
    await transaction(async () => { await saveBudget(db, definition(true), null); await insertManualEntry(db, purchase('original')); });
    await transaction(() => loadFinance(db));
    const before = await transaction(() => loadFinance(db));
    native.exec(`CREATE TABLE manual_entries (id TEXT PRIMARY KEY NOT NULL,payload TEXT NOT NULL);
      INSERT INTO manual_entries SELECT id,payload FROM transactions;
      DROP TABLE review_items; DROP TABLE source_observations; DROP TABLE account_instruments;
      DROP TABLE sms_settings; DROP TABLE import_items; DROP TABLE import_batches; DROP TABLE transactions;
      PRAGMA user_version=1;`);
    await migrateDatabase(db);
    const after = await transaction(() => loadFinance(db));
    expect(after.accounts).toEqual(before.accounts);
    expect(after.entries).toEqual(before.entries);
    expect(after.budgets).toEqual(before.budgets);
    expect(after.signals).toEqual(before.signals);
  });
  it('migrates once, rejects future schema versions and preserves financial records', async () => {
    await migrateDatabase(db);
    expect((await loadFinance(db)).accounts).toHaveLength(2);
    native.exec('PRAGMA user_version=3');
    await expect(migrateDatabase(db)).rejects.toThrow();
    expect(native.prepare('SELECT count(*) AS n FROM accounts').get()?.n).toBe(2);
  });
  it('persists canonical entries and rejects duplicate IDs atomically', async () => {
    await transaction(() => insertManualEntry(db, purchase('p')));
    await expect(transaction(() => insertManualEntry(db, purchase('p')))).rejects.toThrow();
    expect((await loadFinance(db)).entries).toHaveLength(1);
    const rows = native.prepare('SELECT kind FROM changes WHERE entity_id=?').all('p');
    expect(rows).toHaveLength(1);
  });
  it('persists one period/threshold event set, with an alert surviving replay until dismissed', async () => {
    await transaction(async () => { await saveBudget(db, definition(), null); await insertManualEntry(db, purchase('p')); });
    const first = await transaction(() => loadFinance(db));
    expect(first.budgets[0]?.refresh.summaries[0]?.usage.used).toEqual(money(9000));
    expect(first.signals).toHaveLength(1);
    expect(first.signals[0]?.thresholds).toEqual([50, 75, 90]);
    const replay = await transaction(() => loadFinance(db));
    expect(replay.budgets[0]?.refresh.signals).toEqual([]);
    expect(replay.signals).toEqual(first.signals);
    expect(native.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n).toBe(1);
    expect(native.prepare('SELECT count(*) AS n FROM budget_thresholds').get()?.n).toBe(3);
    native.exec('UPDATE budget_signals SET acknowledged=1');
    expect((await transaction(() => loadFinance(db))).signals).toEqual([]);
  });
  it('repayments never alter persisted budget usage', async () => {
    await transaction(async () => { await saveBudget(db, definition(), null); await insertManualEntry(db, purchase('p')); });
    await transaction(() => loadFinance(db));
    await transaction(() => insertManualEntry(db, { id: 'repayment', kind: 'transfer', fromAccountId: bank.id, toAccountId: card.id, amount: money(6000), date: '2024-01-15' }));
    expect((await transaction(() => loadFinance(db))).budgets[0]?.refresh.summaries[0]?.usage.used).toEqual(money(9000));
  });
  it('uses optimistic versions, keeps old snapshots and baselines changed thresholds', async () => {
    await transaction(() => saveBudget(db, definition(), null));
    const initial = (await transaction(() => loadFinance(db))).budgets[0]!;
    const changed = scheduleBudgetRevision(initial.definition, { amount: money(20000), rule: { kind: 'monthly' }, rollover: true }, '2024-01-15', initial.refresh.periods[0]!);
    await transaction(() => saveBudget(db, changed, initial.version));
    await expect(transaction(() => saveBudget(db, changed, initial.version))).rejects.toThrow();
    const loaded = (await transaction(() => loadFinance(db))).budgets[0]!;
    expect(loaded.refresh.periods).toEqual(initial.refresh.periods);
    expect(loaded.definition.revisions).toHaveLength(2);
    await transaction(() => insertManualEntry(db, purchase('p', 3000)));
    await transaction(() => saveBudget(db, setBudgetThresholds(loaded.definition, [10, 20, 100]), loaded.version));
    const baseline = await transaction(() => loadFinance(db, new Date(), 'b'));
    expect(baseline.signals).toEqual([]);
    expect((await transaction(() => loadFinance(db))).signals).toEqual([]);
  });
  it('rolls back snapshot and threshold writes together after a failed transaction', async () => {
    await transaction(async () => { await saveBudget(db, definition(), null); await insertManualEntry(db, purchase('p')); });
    await expect(transaction(async () => { await loadFinance(db); throw new Error('synthetic interruption'); })).rejects.toThrow();
    expect(native.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n).toBe(1); // Existing initial materialization from entry validation.
    expect(native.prepare('SELECT count(*) AS n FROM budget_signals').get()?.n).toBe(0);
    expect((await transaction(() => loadFinance(db))).signals).toHaveLength(1);
  });
  it('rejects edited issued revisions and labels containing full number-like identifiers', async () => {
    await transaction(() => saveBudget(db, definition(), null));
    const current = (await transaction(() => loadFinance(db))).budgets[0]!;
    const tampered = { ...current.definition, revisions: [{ ...current.definition.revisions[0]!, amount: money(1) }] };
    await expect(transaction(() => saveBudget(db, tampered, current.version))).rejects.toThrow();
    expect(() => requirePrivateLabel('Synthetic 1111 2222 3333 4444')).toThrow();
    expect(() => requirePrivateLabel('bad\nlabel')).toThrow();
  });
  it('uses bound labels and rolls back partially inserted accounts on invalid opening balances', async () => {
    const name = "Synthetic'); DROP TABLE accounts; --";
    await transaction(() => insertAccount(db, { ...bank, id: 'bank-safe', name }));
    expect((await loadFinance(db)).accounts.find((account) => account.id === 'bank-safe')?.name).toBe(name);
    await expect(transaction(() => insertAccount(db, { ...bank, id: 'bank-failed' }, undefined,
      { id: 'bad-opening', kind: 'opening-balance', accountId: 'other', amount: money(1), date: '2024-01-01' }))).rejects.toThrow();
    expect(native.prepare('SELECT id FROM accounts WHERE id=?').get('bank-failed')).toBeUndefined();
  });
  it('preserves issued rollover after late durable entries correct a closed period', async () => {
    jest.setSystemTime(new Date('2024-02-15T08:00:00Z'));
    await transaction(() => saveBudget(db, definition(true), null));
    const initial = (await transaction(() => loadFinance(db))).budgets[0]!;
    expect(initial.refresh.periods[1]?.allowance).toEqual(money(20000));
    await transaction(() => insertManualEntry(db, purchase('late', 6000)));
    const corrected = (await transaction(() => loadFinance(db))).budgets[0]!;
    expect(corrected.refresh.periods).toEqual(initial.refresh.periods);
    expect(corrected.refresh.summaries[1]?.correction?.rolloverDifference).toEqual(money(-6000));
  });
  it('rejects unknown categories and corrupt stored currencies without silently guessing', async () => {
    await expect(transaction(() => insertManualEntry(db, { ...purchase('bad-category'), categoryId: 'unknown' }))).rejects.toThrow();
    native.prepare('UPDATE accounts SET payload=? WHERE id=?').run(JSON.stringify({ id: card.id, kind: card.kind, name: card.name, archived: false }), card.id);
    await expect(loadFinance(db)).rejects.toThrow();
  });
});
