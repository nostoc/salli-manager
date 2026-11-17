import type { SQLiteDatabase } from 'expo-sqlite';
import { loadFinance, type FinanceSnapshot } from '@/core/database/financeRepository';
import { createTransaction, projectLedger, type LedgerTransaction, type TransactionDraft } from '@/features/transactions/domain/ledger';
import { DEFAULT_CATEGORIES } from '@/features/transactions/domain/categories';
import type { Money } from '@/core/money/money';
import { parseSms } from '../parsers/parseSms';
import { decidePurchase, readInstrument, readSmsSettings } from '../domain/ingestion';
import { DEFAULT_SMS_SETTINGS, SMS_BATCH_SIZE, SOURCE_TTL_MS, SmsError, sourceId,
  type AccountInstrument, type ParsedSmsObservation, type SmsEnvelope, type SmsSettings } from '../domain/types';

export type ReviewItem = Readonly<{ id: string; observation: ParsedSmsObservation; reasons: readonly string[]; candidates: readonly string[]; expiresAt: number; text: string | null }>;
export type SmsSnapshot = Readonly<{ settings: SmsSettings; instruments: readonly AccountInstrument[]; reviews: readonly ReviewItem[] }>;
type ObservationRecord = Readonly<{ kind: 'sms'; envelopeId: string; receivedAt: number; sentAt: number | null; intakeAt: number; observation: ParsedSmsObservation }>;
type SourceRow = { id: string; source_key: string; fingerprint: string; transaction_id: string | null; batch_id: string | null; payload: string; decision: string; source_text: string | null; expires_at: number };
const decode = <T,>(value: string): T => {
  if (value.length > 32768) throw new SmsError('oversized_record');
  try { return JSON.parse(value) as T; } catch { throw new SmsError('invalid_record'); }
};
function freshId(newId: () => string) { const id = sourceId(newId()); if (id.length > 80) throw new SmsError('invalid_generated_id'); return id; }
function instant(value: number) { if (!Number.isSafeInteger(value) || value <= 0 || value > 8_640_000_000_000_000 - SOURCE_TTL_MS) throw new SmsError('invalid_timestamp'); return value; }
export async function expireSourceText(db: SQLiteDatabase, now: number) {
  instant(now);
  await db.runAsync('UPDATE source_observations SET source_text=NULL WHERE source_text IS NOT NULL AND expires_at<=?', now);
}
export async function loadSms(db: SQLiteDatabase, accounts: FinanceSnapshot['accounts'], now = Date.now()): Promise<SmsSnapshot> {
  await expireSourceText(db, now);
  const settingsRow = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM sms_settings WHERE id=1');
  const settings = settingsRow ? readSmsSettings(decode<SmsSettings>(settingsRow.payload)) : DEFAULT_SMS_SETTINGS;
  const instruments = (await db.getAllAsync<{ id: string; account_id: string; payload: string }>('SELECT id,account_id,payload FROM account_instruments ORDER BY id')).map((row) => {
    const item = readInstrument(decode<AccountInstrument>(row.payload), accounts);
    if (item.id !== row.id || item.accountId !== row.account_id) throw new SmsError('invalid_record');
    return item;
  });
  const reviews = (await db.getAllAsync<SourceRow & { review_payload: string }>(
    "SELECT s.*,r.payload AS review_payload FROM source_observations s JOIN review_items r ON s.id=r.id WHERE s.decision='review' ORDER BY s.rowid LIMIT 200")).map((row): ReviewItem => {
      const payload = decode<ObservationRecord>(row.payload);
      const review = decode<{ reasons: string[]; candidates: string[] }>(row.review_payload);
      if (payload.kind !== 'sms' || !Array.isArray(review.reasons) || !Array.isArray(review.candidates)) throw new SmsError('invalid_record');
      return Object.freeze({ id: row.id, observation: payload.observation, reasons: review.reasons, candidates: review.candidates, text: row.source_text, expiresAt: row.expires_at });
    });
  return Object.freeze({ settings, instruments: Object.freeze(instruments), reviews: Object.freeze(reviews) });
}
export async function saveSmsSettings(db: SQLiteDatabase, value: SmsSettings) {
  await db.runAsync('INSERT INTO sms_settings(id,payload) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload', JSON.stringify(readSmsSettings(value)));
}
export async function saveInstrument(db: SQLiteDatabase, value: AccountInstrument) {
  const finance = await loadFinance(db);
  const item = readInstrument(value, finance.accounts);
  const conflict = await db.getFirstAsync<{ id: string }>('SELECT id FROM account_instruments WHERE id=?', item.id);
  if (conflict) throw new SmsError('instrument_exists');
  await db.runAsync('INSERT INTO account_instruments(id,account_id,payload) VALUES (?,?,?)', item.id, item.accountId, JSON.stringify(item));
}
export async function removeInstrument(db: SQLiteDatabase, id: string) { await db.runAsync('DELETE FROM account_instruments WHERE id=?', sourceId(id)); }

export type IntakeCounts = Readonly<{ created: number; review: number; replayed: number; rejected: number }>;
// Caller owns the authenticated SQLite transaction. Native ack MUST happen after commit.
// Replaying an envelope after a commit/ack crash is harmless.
export async function ingestSmsBatch(db: SQLiteDatabase, envelopes: readonly SmsEnvelope[], newId: () => string, now = Date.now(), historical = false): Promise<IntakeCounts> {
  if (envelopes.length > SMS_BATCH_SIZE) throw new SmsError('batch_too_large');
  instant(now);
  const finance = await loadFinance(db);
  const sms = await loadSms(db, finance.accounts, now);
  const entries = [...finance.entries];
  const counts = { created: 0, review: 0, replayed: 0, rejected: 0 };
  for (const envelope of envelopes) {
    sourceId(envelope.id); sourceId(envelope.sourceKey);
    if (!/^(?:live:[A-Za-z0-9_-]+|provider:(?:[a-f0-9]{24}:)?\d+)$/.test(envelope.sourceKey)) throw new SmsError('invalid_source_namespace');
    if (!/^[a-f0-9]{64}$/.test(envelope.fingerprint)) throw new SmsError('invalid_fingerprint');
    instant(envelope.receivedAt); instant(envelope.intakeAt);
    if (envelope.sentAt !== null) instant(envelope.sentAt);
    if (envelope.intakeAt > now + 60_000) throw new SmsError('future_intake');
    const existing = await db.getFirstAsync<SourceRow>('SELECT * FROM source_observations WHERE source_key=?', envelope.sourceKey);
    if (existing?.fingerprint === envelope.fingerprint) { counts.replayed++; continue; }
    const parsed = parseSms(envelope);
    if (!('observation' in parsed)) { counts.rejected++; continue; }
    if (existing) {
      // Changed provider content cannot rewrite a user decision or ledger entry.
      // Store a separate review observation with deterministic change identity.
      const changedKey = `${existing.id}:changed:${envelope.fingerprint}`;
      sourceId(changedKey);
      if (await db.getFirstAsync('SELECT id FROM source_observations WHERE source_key=?', changedKey)) { counts.replayed++; continue; }
      await stage(changedKey, ['source_changed'], existing.transaction_id ? [existing.transaction_id] : []);
      continue;
    }
    const fingerprints = await db.getAllAsync<{ transaction_id: string }>('SELECT transaction_id FROM source_observations WHERE fingerprint=? AND transaction_id IS NOT NULL', envelope.fingerprint);
    const id = freshId(newId);
    const decision = decidePurchase({ id, observation: parsed.observation, accounts: finance.accounts, instruments: sms.instruments,
      settings: sms.settings, entries, fingerprintCandidates: fingerprints.map((item) => item.transaction_id) });
    if (decision.transaction && parsed.type === 'recognized') {
      try { projectLedger(finance.accounts, [...entries, decision.transaction]); }
      catch { await stage(envelope.sourceKey, ['financial_projection_rejected'], decision.candidates); continue; }
      await db.runAsync('INSERT INTO transactions(id,payload) VALUES (?,?)', id, JSON.stringify(decision.transaction));
      entries.push(decision.transaction);
      await writeSource(envelope.sourceKey, id, 'automatic', null);
      await db.runAsync('INSERT INTO changes(entity_id,kind,next_payload) VALUES (?,?,?)', id, 'sms-create', JSON.stringify(decision.transaction));
      counts.created++;
    } else await stage(envelope.sourceKey, decision.reasons.length ? decision.reasons : parsed.observation.warnings, decision.candidates);

    async function stage(key: string, reasons: readonly string[], candidates: readonly string[]) {
      const observationId = await writeSource(key, null, 'review', envelope.intakeAt + SOURCE_TTL_MS > now ? parsed.type === 'recognized' || parsed.type === 'needsReview' ? parsed.sanitizedText : null : null);
      await db.runAsync('INSERT INTO review_items(id,payload) VALUES (?,?)', observationId, JSON.stringify({ reasons, candidates }));
      counts.review++;
    }
    async function writeSource(key: string, transactionId: string | null, decision: string, text: string | null) {
      if (!('observation' in parsed)) throw new SmsError('invalid_parse');
      const id = freshId(newId);
      const payload: ObservationRecord = { kind: 'sms', envelopeId: envelope.id, receivedAt: envelope.receivedAt, sentAt: envelope.sentAt,
        intakeAt: envelope.intakeAt, observation: parsed.observation };
      const expires = existing ? Math.min(existing.expires_at, envelope.intakeAt + SOURCE_TTL_MS) : envelope.intakeAt + SOURCE_TTL_MS;
      await db.runAsync('INSERT INTO source_observations(id,source_key,fingerprint,transaction_id,batch_id,payload,source_text,expires_at,decision) VALUES (?,?,?,?,?,?,?,?,?)',
        id, key, envelope.fingerprint, transactionId, envelope.batchId ?? null, JSON.stringify(payload), expires > now ? text : null, expires, decision);
      return id;
    }
  }
  await loadFinance(db, new Date(now), historical ? true : undefined);
  return Object.freeze(counts);
}

export type ReviewResolution =
  | Readonly<{ kind: 'dismiss' }>
  | Readonly<{ kind: 'link'; transactionId: string }>
  | Readonly<{ kind: 'create'; draft: TransactionDraft; status: 'pending' | 'confirmed'; estimated?: boolean }>
  | Readonly<{ kind: 'reverse'; transactionId: string }>;
export async function resolveReview(db: SQLiteDatabase, id: string, resolution: ReviewResolution) {
  const row = await db.getFirstAsync<SourceRow>("SELECT * FROM source_observations WHERE id=? AND decision='review'", sourceId(id));
  if (!row) throw new SmsError('review_already_resolved');
  const finance = await loadFinance(db);
  const source = decode<ObservationRecord>(row.payload);
  let transactionId: string | null = null;
  if (resolution.kind === 'link' || resolution.kind === 'reverse') {
    const entry = finance.entries.find((item) => item.id === resolution.transactionId);
    if (!entry || entry.voided || entry.kind === 'opening-balance') throw new SmsError('invalid_link');
    if (source.observation.kind === 'repayment' && entry.kind !== 'transfer') throw new SmsError('repayment_requires_transfer');
    transactionId = entry.id;
    if (resolution.kind === 'reverse') {
      // A reversal voids the original event. Refunded originals cannot be voided.
      const changed = createTransaction(finance.accounts, { ...entry, voided: true }, true);
      projectLedger(finance.accounts, finance.entries.map((item) => item.id === entry.id ? changed : item));
      await db.runAsync('UPDATE transactions SET payload=? WHERE id=?', JSON.stringify(changed), entry.id);
      await db.runAsync('INSERT INTO changes(entity_id,kind,previous_payload,next_payload) VALUES (?,?,?,?)', entry.id, 'sms-reversal', JSON.stringify(entry), JSON.stringify(changed));
    }
  } else if (resolution.kind === 'create') {
    const entry = createTransaction(finance.accounts, { ...resolution.draft, origin: 'sms', status: resolution.status,
      estimated: resolution.estimated ?? false, merchant: source.observation.merchant });
    if (entry.kind === 'opening-balance' || entry.kind === 'income' || entry.voided) throw new SmsError('invalid_sms_classification');
    if (source.observation.kind === 'repayment' && entry.kind !== 'transfer') throw new SmsError('repayment_requires_transfer');
    if (entry.kind === 'expense' && !DEFAULT_CATEGORIES.some((item) => item.id === entry.categoryId)) throw new SmsError('invalid_category');
    if (entry.kind === 'transfer') {
      const from = finance.accounts.find((account) => account.id === entry.fromAccountId);
      const to = finance.accounts.find((account) => account.id === entry.toAccountId);
      if (from?.kind === 'credit-card' || to?.kind !== 'credit-card') throw new SmsError('invalid_repayment');
    }
    projectLedger(finance.accounts, [...finance.entries, entry]);
    await db.runAsync('INSERT INTO transactions(id,payload) VALUES (?,?)', entry.id, JSON.stringify(entry));
    await db.runAsync('INSERT INTO changes(entity_id,kind,next_payload) VALUES (?,?,?)', entry.id, 'sms-review-create', JSON.stringify(entry));
    transactionId = entry.id;
  }
  await db.runAsync('UPDATE source_observations SET transaction_id=?,decision=?,source_text=NULL WHERE id=?', transactionId, resolution.kind, id);
  await db.runAsync('DELETE FROM review_items WHERE id=?', id);
  await db.runAsync('INSERT INTO changes(entity_id,kind,next_payload) VALUES (?,?,?)', id, 'sms-review-decision', JSON.stringify({ decision: resolution.kind, transactionId }));
  if (row.batch_id) await loadFinance(db, new Date(), true);
}

export async function changeTransactionStatus(db: SQLiteDatabase, id: string, status: LedgerTransaction['status']) {
  const finance = await loadFinance(db);
  const entry = finance.entries.find((item) => item.id === id);
  if (!entry || entry.voided || entry.kind !== 'expense' || (entry.status !== 'pending' && status === 'pending')) throw new SmsError('invalid_status_change');
  const changed = createTransaction(finance.accounts, { ...entry, status, estimated: status === 'pending' && entry.estimated }, true);
  projectLedger(finance.accounts, finance.entries.map((item) => item.id === id ? changed : item));
  await db.runAsync('UPDATE transactions SET payload=? WHERE id=?', JSON.stringify(changed), id);
  await db.runAsync('INSERT INTO changes(entity_id,kind,previous_payload,next_payload) VALUES (?,?,?,?)', id, 'status-change', JSON.stringify(entry), JSON.stringify(changed));
}

export async function correctSmsExpense(db: SQLiteDatabase, expected: LedgerTransaction, input: Readonly<{ amount: Money; date: string; categoryId: string; confirm: boolean }>) {
  const finance = await loadFinance(db);
  const entry = finance.entries.find((item) => item.id === expected.id);
  if (!entry || JSON.stringify(entry) !== JSON.stringify(expected) || entry.kind !== 'expense' || entry.origin !== 'sms' || entry.voided || entry.status === 'reconciled') throw new SmsError('stale_or_invalid_correction');
  if (!DEFAULT_CATEGORIES.some((category) => category.id === input.categoryId)) throw new SmsError('invalid_category');
  const corrected = createTransaction(finance.accounts, { ...entry, amount: input.amount, date: input.date, categoryId: input.categoryId,
    status: input.confirm ? 'confirmed' : entry.status, estimated: false }, true);
  projectLedger(finance.accounts, finance.entries.map((item) => item.id === entry.id ? corrected : item));
  await db.runAsync('UPDATE transactions SET payload=? WHERE id=?', JSON.stringify(corrected), entry.id);
  await db.runAsync('INSERT INTO changes(entity_id,kind,previous_payload,next_payload) VALUES (?,?,?,?)', entry.id, 'user-correction', JSON.stringify(entry), JSON.stringify(corrected));
}
