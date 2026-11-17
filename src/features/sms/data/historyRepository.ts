import type { SQLiteDatabase } from 'expo-sqlite';
import { addMoney, createMoney, subtractMoney, type Money } from '@/core/money/money';
import { loadFinance } from '@/core/database/financeRepository';
import { projectLedger } from '@/features/transactions/domain/ledger';
import type { HistoryPage } from '../nativeSms';
import { SMS_BATCH_SIZE, SOURCE_TTL_MS, SmsError, sourceId, type SmsEnvelope } from '../domain/types';
import { ingestSmsBatch, type IntakeCounts } from './smsRepository';

export type HistoryBatch = Readonly<{
  id: string; start: number; end: number; after: number; highWater: number; scanDone: boolean;
  status: 'scanning' | 'paused' | 'ready' | 'completed'; staged: number; committed: number;
  discarded: number; expired: boolean;
  counts: IntakeCounts; preview: Readonly<{ counts: IntakeCounts; pendingChange: readonly Money[]; revision: number }> | null;
}>;
const empty = (): IntakeCounts => ({ created: 0, review: 0, replayed: 0, rejected: 0 });
const plus = (a: IntakeCounts, b: IntakeCounts): IntakeCounts => ({ created: a.created + b.created, review: a.review + b.review, replayed: a.replayed + b.replayed, rejected: a.rejected + b.rejected });
async function revision(db: SQLiteDatabase) { return (await db.getFirstAsync<{ n: number }>('SELECT COALESCE(MAX(sequence),0) AS n FROM changes'))!.n; }
async function write(db: SQLiteDatabase, item: HistoryBatch) { await db.runAsync('UPDATE import_batches SET payload=? WHERE id=?', JSON.stringify(item), item.id); return item; }
export async function readHistory(db: SQLiteDatabase): Promise<readonly HistoryBatch[]> {
  return (await db.getAllAsync<{ payload: string }>('SELECT payload FROM import_batches ORDER BY rowid DESC LIMIT 20')).map((row) => {
    const value = JSON.parse(row.payload) as HistoryBatch;
    sourceId(value.id);
    if (!['scanning', 'paused', 'ready', 'completed'].includes(value.status) || !Number.isSafeInteger(value.staged) || !Number.isSafeInteger(value.committed) ||
        value.committed < 0 || value.staged < value.committed || value.staged > 10000 || !Number.isFinite(value.start) || value.start >= value.end) throw new SmsError('invalid_batch');
    return Object.freeze(value);
  });
}
async function batch(db: SQLiteDatabase, id: string) { const item = (await readHistory(db)).find((item) => item.id === id); if (!item) throw new SmsError('unknown_batch'); return item; }
export async function createHistory(db: SQLiteDatabase, id: string, start: number, end: number, now = Date.now()) {
  sourceId(id);
  if (![start, end, now].every(Number.isSafeInteger) || start <= 0 || end <= start || end > now + 60000) throw new SmsError('invalid_range');
  const item: HistoryBatch = { id, start, end, after: 0, highWater: 0, scanDone: false, status: 'scanning', staged: 0, committed: 0, discarded: 0, expired: false, counts: empty(), preview: null };
  await db.runAsync('INSERT INTO import_batches(id,payload) VALUES (?,?)', id, JSON.stringify(item));
  return item;
}
export async function stageHistoryPage(db: SQLiteDatabase, id: string, page: HistoryPage) {
  const item = await batch(db, id);
  if (item.scanDone || item.committed || page.envelopes.length > SMS_BATCH_SIZE || page.after < item.after ||
      !Number.isSafeInteger(page.after) || !Number.isSafeInteger(page.highWater) || page.highWater < page.after ||
      (item.highWater !== 0 && page.highWater !== item.highWater) || item.staged + page.envelopes.length > 10000) throw new SmsError('invalid_page');
  for (const [index, envelope] of page.envelopes.entries()) {
    if (envelope.receivedAt < item.start || envelope.receivedAt >= item.end || envelope.body.length > 8192) throw new SmsError('invalid_page');
    const existing = await db.getFirstAsync<{ fingerprint: string; expires_at: number }>('SELECT fingerprint,expires_at FROM source_observations WHERE source_key=?', envelope.sourceKey);
    const staged = { ...envelope, batchId: id };
    // Repeated scans do not retain already resolved/expired source text again.
    if (existing?.fingerprint === envelope.fingerprint) staged.body = '';
    await db.runAsync('INSERT INTO import_items(batch_id,position,payload) VALUES (?,?,?)', id, item.staged + index, JSON.stringify(staged));
  }
  return write(db, { ...item, staged: item.staged + page.envelopes.length, after: page.after, highWater: page.highWater, scanDone: page.done, status: page.done ? 'paused' : 'scanning', preview: null });
}
async function items(db: SQLiteDatabase, item: HistoryBatch, offset: number, now: number) {
  const rows = await db.getAllAsync<{ payload: string }>('SELECT payload FROM import_items WHERE batch_id=? AND position>=? ORDER BY position LIMIT 50', item.id, offset);
  if (rows.length !== Math.min(SMS_BATCH_SIZE, item.staged - offset)) throw new SmsError('incomplete_staging');
  return rows.map((row) => {
    const envelope = JSON.parse(row.payload) as SmsEnvelope;
    if (envelope.intakeAt + SOURCE_TTL_MS <= now) throw new SmsError('preview_expired_rescan_required');
    return envelope;
  });
}
// Simulate all remaining chunks in a savepoint. Roll back every financial and
// threshold write before persisting a preview. Preview is never ledger acceptance.
export async function previewHistory(db: SQLiteDatabase, id: string, newId: () => string, now = Date.now()) {
  const item = await batch(db, id);
  if (!item.scanDone || item.status === 'completed') throw new SmsError('scan_not_ready');
  const expectedRevision = await revision(db);
  let counts = empty(); let pendingChange: Money[] = [];
  await db.execAsync('SAVEPOINT sms_preview');
  try {
    const before = await loadFinance(db, new Date(now));
    const initial = projectLedger(before.accounts, before.entries).pending;
    for (let offset = item.committed; offset < item.staged; offset += SMS_BATCH_SIZE) {
      counts = plus(counts, await ingestSmsBatch(db, await items(db, item, offset, now), newId, now, true));
    }
    const after = await loadFinance(db, new Date(now), true);
    const totals = new Map<string, Money>();
    for (const pending of projectLedger(after.accounts, after.entries).pending) {
      const previous = initial.find((value) => value.accountId === pending.accountId)!;
      const difference = subtractMoney(pending.amount, previous.amount);
      totals.set(difference.currency, addMoney(totals.get(difference.currency) ?? createMoney(0, difference.currency), difference));
    }
    pendingChange = [...totals.values()];
  } finally { await db.execAsync('ROLLBACK TO sms_preview; RELEASE sms_preview'); }
  return write(db, { ...item, status: 'ready', preview: { counts, pendingChange, revision: expectedRevision } });
}
export async function commitHistoryChunk(db: SQLiteDatabase, id: string, newId: () => string, now = Date.now()) {
  const item = await batch(db, id);
  if (item.status !== 'ready' || !item.preview || item.preview.revision !== await revision(db)) throw new SmsError('preview_required_or_stale');
  const envelopes = await items(db, item, item.committed, now);
  const counts = await ingestSmsBatch(db, envelopes, newId, now, true);
  const committed = item.committed + envelopes.length;
  await db.runAsync('DELETE FROM import_items WHERE batch_id=? AND position<?', id, committed);
  return write(db, { ...item, committed, counts: plus(item.counts, counts), status: committed >= item.staged ? 'completed' : 'ready',
    preview: committed >= item.staged ? null : { ...item.preview, revision: await revision(db) } });
}
export async function pauseHistory(db: SQLiteDatabase, id: string) {
  const item = await batch(db, id);
  if (item.status === 'completed') return item;
  return write(db, { ...item, status: 'paused', preview: null });
}
export async function pauseHistoryOnUnlock(db: SQLiteDatabase) {
  // A killed/backgrounded importer cannot resume acceptance automatically.
  // Its committed chunk counters survive; remaining work needs a fresh preview.
  for (const item of await readHistory(db)) if (item.status !== 'completed') await pauseHistory(db, item.id);
  await purgeExpiredHistory(db);
}
export async function discardHistory(db: SQLiteDatabase, id: string, expired = false) {
  const item = await batch(db, id);
  await db.runAsync('DELETE FROM import_items WHERE batch_id=?', id);
  // Keep committed counts and the import provenance, delete only staged text.
  return write(db, { ...item, discarded: item.staged - item.committed, expired, scanDone: true, status: 'completed', preview: null });
}
export async function purgeExpiredHistory(db: SQLiteDatabase, now = Date.now()) {
  // SQLite JSON reads are local; expiry does not depend on opening every body in JS.
  const expired = await db.getAllAsync<{ batch_id: string }>('SELECT DISTINCT batch_id FROM import_items WHERE json_extract(payload,\'$.intakeAt\')<=?', now - SOURCE_TTL_MS);
  for (const row of expired) await discardHistory(db, row.batch_id, true);
}
