/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { migrateDatabase } from '../schema';
import { insertAccount, loadFinance, saveBudget } from '../financeRepository';
import { createBudgetDefinition } from '@/features/budgets/domain/budget';
import { createLedgerAccount } from '@/features/accounts/domain/account';
import { correctSmsExpense, ingestSmsBatch, loadSms, resolveReview, saveInstrument, saveSmsSettings } from '@/features/sms/data/smsRepository';
import type { SmsEnvelope } from '@/features/sms/domain/types';
import { createMoney } from '@/core/money/money';
import { createTransaction } from '@/features/transactions/domain/ledger';
import { commitHistoryChunk, createHistory, pauseHistory, pauseHistoryOnUnlock, previewHistory, purgeExpiredHistory, readHistory, stageHistoryPage } from '@/features/sms/data/historyRepository';
let sql: DatabaseSync;
let db: SQLiteDatabase;
let sequence = 0;
const now = Date.parse('2026-06-13T08:00:00Z');
const newId = () => `generated-${++sequence}`;
const card = { ...createLedgerAccount({ id: 'card', kind: 'credit-card' }), name: 'Synthetic card' };
const bank = { ...createLedgerAccount({ id: 'bank', kind: 'bank' }), name: 'Synthetic bank' };
const envelope = (id: string): SmsEnvelope => ({ id, sourceKey: `live:${id}`, fingerprint: 'a'.repeat(64), sender: 'HNB',
  body: 'HNB SMS Alert VC : XXXX4826 : Cedar Grocery LKR 2,375.40 (12-JUN-2026 09:15)', receivedAt: now, sentAt: now, intakeAt: now });
async function tx<T>(work: () => Promise<T>) { sql.exec('BEGIN IMMEDIATE'); try { const result = await work(); sql.exec('COMMIT'); return result; } catch (error) { sql.exec('ROLLBACK'); throw error; } }
beforeEach(async () => {
  jest.useFakeTimers().setSystemTime(now);
  sequence = 0;
  sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
  db = { execAsync: async (query: string) => { sql.exec(query); },
    runAsync: async (query: string, ...args: SQLInputValue[]) => sql.prepare(query).run(...args),
    getFirstAsync: async (query: string, ...args: SQLInputValue[]) => sql.prepare(query).get(...args) ?? null,
    getAllAsync: async (query: string, ...args: SQLInputValue[]) => sql.prepare(query).all(...args),
  } as unknown as SQLiteDatabase;
  await migrateDatabase(db);
  await tx(async () => {
    await insertAccount(db, card); await insertAccount(db, bank);
    await saveSmsSettings(db, { approvedSenders: ['HNB'] });
    await saveInstrument(db, { id: 'mapping', accountId: card.id, bank: 'hnb', kind: 'credit-card', suffix: '4826' });
  });
});
afterEach(() => { sql.close(); jest.useRealTimers(); });
describe('authenticated SMS repository transactions (ordinary SQLite, not native encryption proof)', () => {
  it('creates pending purchases once across commit/ack replay and purges resolved source text', async () => {
    const first = await tx(() => ingestSmsBatch(db, [envelope('one')], newId, now));
    expect(first.created).toBe(1);
    expect((await tx(() => ingestSmsBatch(db, [envelope('one')], newId, now))).replayed).toBe(1);
    const finance = await loadFinance(db);
    expect(finance.entries).toHaveLength(1);
    expect(finance.entries[0]?.status).toBe('pending');
    expect(sql.prepare('SELECT source_text FROM source_observations').get()?.source_text).toBeNull();
  });
  it('holds equal genuine purchases for review and can explicitly retain both', async () => {
    await tx(() => ingestSmsBatch(db, [envelope('one'), envelope('two')], newId, now));
    const review = (await loadSms(db, [card, bank], now)).reviews[0]!;
    expect(review.reasons).toContain('possible_duplicate');
    expect((await loadFinance(db)).entries).toHaveLength(1);
    await tx(() => resolveReview(db, review.id, { kind: 'create', status: 'pending', draft: {
      id: newId(), kind: 'expense', accountId: card.id, amount: createMoney(237540), date: '2026-06-12', categoryId: 'groceries',
    } }));
    expect((await loadFinance(db)).entries).toHaveLength(2);
    expect((await loadSms(db, [card, bank], now)).reviews).toHaveLength(0);
    expect(sql.prepare('SELECT source_text FROM source_observations WHERE id=?').get(review.id)?.source_text).toBeNull();
    await expect(tx(() => resolveReview(db, review.id, { kind: 'dismiss' }))).rejects.toThrow();
  });
  it('preserves audited user corrections across replay and rejects stale editors', async () => {
    await tx(() => ingestSmsBatch(db, [envelope('one')], newId, now));
    const original = (await loadFinance(db)).entries[0]!;
    await tx(() => correctSmsExpense(db, original, { amount: createMoney(235000), date: '2026-06-11', categoryId: 'dining', confirm: true }));
    await expect(tx(() => correctSmsExpense(db, original, { amount: createMoney(1), date: original.date, categoryId: 'dining', confirm: true }))).rejects.toThrow();
    await tx(() => ingestSmsBatch(db, [envelope('one')], newId, now));
    expect((await loadFinance(db)).entries[0]).toMatchObject({ status: 'confirmed', amount: createMoney(235000), date: '2026-06-11', categoryId: 'dining' });
    expect(sql.prepare("SELECT count(*) AS n FROM changes WHERE kind='user-correction'").get()?.n).toBe(1);
    expect(JSON.parse(sql.prepare("SELECT payload FROM source_observations WHERE decision='automatic'").get()?.payload as string).observation.amount.minorUnits).toBe(237540);
  });
  it('does not guess among colliding masked instruments', async () => {
    await tx(() => saveInstrument(db, { id: 'collision', accountId: card.id, bank: 'hnb', kind: 'credit-card', suffix: '4826' }));
    expect((await tx(() => ingestSmsBatch(db, [envelope('one')], newId, now))).review).toBe(1);
    expect((await loadSms(db, [card, bank], now)).reviews[0]?.reasons).toContain('ambiguous_instrument');
  });
  it('retains a single repayment transfer only after both accounts are supplied', async () => {
    await tx(() => ingestSmsBatch(db, [{ ...envelope('payment'), body: 'Thank you for your payment of LKR 1,450.00 made to Card No. XXXX4826 on 12-06-26.' }], newId, now));
    expect((await loadFinance(db)).entries).toHaveLength(0);
    const review = (await loadSms(db, [card, bank], now)).reviews[0]!;
    await expect(tx(() => resolveReview(db, review.id, { kind: 'create', status: 'confirmed', draft: {
      id: newId(), kind: 'expense', accountId: card.id, amount: createMoney(145000), date: '2026-06-12', categoryId: 'groceries',
    } }))).rejects.toThrow();
    await tx(() => resolveReview(db, review.id, { kind: 'create', status: 'confirmed', draft: {
      id: newId(), kind: 'transfer', fromAccountId: bank.id, toAccountId: card.id, amount: createMoney(145000), date: '2026-06-12',
    } }));
    expect((await loadFinance(db)).entries[0]?.kind).toBe('transfer');
  });
  it('preserves user decisions when a provider row changes and bounds text retention from first intake', async () => {
    await tx(() => ingestSmsBatch(db, [envelope('one')], newId, now));
    const changed = { ...envelope('one'), fingerprint: 'b'.repeat(64), body: envelope('one').body.replace('2,375.40', '4,375.40') };
    await tx(() => ingestSmsBatch(db, [changed], newId, now));
    expect((await loadFinance(db)).entries[0]?.amount.minorUnits).toBe(237540);
    const review = (await loadSms(db, [card, bank], now)).reviews[0]!;
    expect(review.reasons).toEqual(['source_changed']);
    expect((await tx(() => ingestSmsBatch(db, [changed], newId, now))).replayed).toBe(1);
    const expired = await loadSms(db, [card, bank], now + 7 * 86400000);
    expect(expired.reviews[0]?.text).toBeNull();
  });
  it('rolls back complete batches on failure and never persists OTP content', async () => {
    await expect(tx(() => ingestSmsBatch(db, [envelope('one'), { ...envelope('bad'), fingerprint: 'invalid' }], newId, now))).rejects.toThrow();
    expect((await loadFinance(db)).entries).toHaveLength(0);
    expect(sql.prepare('SELECT count(*) AS n FROM source_observations').get()?.n).toBe(0);
    expect((await tx(() => ingestSmsBatch(db, [{ ...envelope('otp'), body: envelope('otp').body + ' OTP 524109' }], newId, now))).rejected).toBe(1);
    expect(sql.prepare('SELECT count(*) AS n FROM source_observations').get()?.n).toBe(0);
  });
  it('stages an unsafe aggregate for review without blocking other intake', async () => {
    const huge = createTransaction([card, bank], { id: 'huge', kind: 'expense', accountId: card.id, amount: createMoney(Number.MAX_SAFE_INTEGER), date: '2026-06-12', status: 'pending', origin: 'sms' });
    await db.runAsync('INSERT INTO transactions(id,payload) VALUES (?,?)', huge.id, JSON.stringify(huge));
    const result = await tx(() => ingestSmsBatch(db, [envelope('overflow')], newId, now));
    expect(result).toEqual({ created: 0, review: 1, replayed: 0, rejected: 0 });
    expect((await loadFinance(db)).entries).toHaveLength(1);
    expect((await loadSms(db, [card, bank], now)).reviews[0]?.reasons).toContain('financial_projection_rejected');
  });
  it('previews without financial writes, rejects stale previews and resumes after an atomic 50-item commit', async () => {
    await tx(() => createHistory(db, 'history', now - 86400000, now + 1, now));
    const first = Array.from({ length: 50 }, (_, index) => ({ ...envelope(`item-${index}`), sourceKey: `provider:${index + 1}` }));
    await tx(() => stageHistoryPage(db, 'history', { envelopes: first, after: 50, highWater: 51, done: false }));
    await tx(() => stageHistoryPage(db, 'history', { envelopes: [{ ...envelope('last'), sourceKey: 'provider:51' }], after: 51, highWater: 51, done: true }));
    const preview = await tx(() => previewHistory(db, 'history', newId, now));
    expect(preview.preview?.counts).toEqual({ created: 1, review: 50, replayed: 0, rejected: 0 });
    expect(preview.preview?.pendingChange).toEqual([createMoney(237540)]);
    expect((await loadFinance(db)).entries).toHaveLength(0);
    expect(sql.prepare('SELECT count(*) AS n FROM source_observations').get()?.n).toBe(0);
    sql.prepare('INSERT INTO changes(entity_id,kind,next_payload) VALUES (?,?,?)').run('external', 'synthetic-change', '{}');
    await expect(tx(() => commitHistoryChunk(db, 'history', newId, now))).rejects.toThrow();
    await tx(() => previewHistory(db, 'history', newId, now));
    const committed = await tx(() => commitHistoryChunk(db, 'history', newId, now));
    expect(committed.committed).toBe(50);
    expect((await loadFinance(db)).entries).toHaveLength(1);
    await tx(() => pauseHistoryOnUnlock(db));
    expect((await readHistory(db))[0]).toMatchObject({ status: 'paused', committed: 50, preview: null });
    await expect(tx(() => commitHistoryChunk(db, 'history', newId, now))).rejects.toThrow();
    await tx(() => previewHistory(db, 'history', newId, now));
    const done = await tx(() => commitHistoryChunk(db, 'history', newId, now));
    expect(done.status).toBe('completed'); expect(done.committed).toBe(51);
    expect(done.counts).toEqual({ created: 1, review: 50, replayed: 0, rejected: 0 });
    expect(sql.prepare('SELECT count(*) AS n FROM import_items').get()?.n).toBe(0);
  });
  it('purges expired staged text while preserving the import audit and committed counts', async () => {
    await tx(() => createHistory(db, 'history', now - 86400000, now + 1, now));
    await tx(() => stageHistoryPage(db, 'history', { envelopes: [{ ...envelope('first'), sourceKey: 'provider:1' }], after: 1, highWater: 1, done: true }));
    await tx(() => purgeExpiredHistory(db, now + 7 * 86400000));
    expect(sql.prepare('SELECT count(*) AS n FROM import_items').get()?.n).toBe(0);
    expect((await readHistory(db))[0]).toMatchObject({ expired: true, discarded: 1, committed: 0, status: 'completed' });
  });
  it('reserves historical spending without flooding old budget thresholds', async () => {
    const budget = createBudgetDefinition({ id: 'budget', name: 'Synthetic allowance', scope: { kind: 'card', id: card.id },
      amount: createMoney(10000), startDate: '2026-06-01', rule: { kind: 'monthly' } }, [card, bank]);
    await tx(() => saveBudget(db, budget, null));
    await tx(() => createHistory(db, 'history', now - 86400000, now + 1, now));
    await tx(() => stageHistoryPage(db, 'history', { envelopes: [{ ...envelope('first'), sourceKey: 'provider:1' }], after: 1, highWater: 1, done: true }));
    await tx(() => previewHistory(db, 'history', newId, now));
    await tx(() => commitHistoryChunk(db, 'history', newId, now));
    const finance = await tx(() => loadFinance(db));
    expect(finance.budgets[0]?.refresh.summaries[0]?.usage.used).toEqual(createMoney(237540));
    expect(finance.signals).toEqual([]);
    expect((await tx(() => loadFinance(db))).signals).toEqual([]);
  });
});
