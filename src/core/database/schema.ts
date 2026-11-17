import type { SQLiteDatabase } from 'expo-sqlite';
import { VaultError } from '@/core/security/nativeVault';
import { createTransaction, projectLedger, type LedgerTransaction } from '@/features/transactions/domain/ledger';
import { createLedgerAccount } from '@/features/accounts/domain/account';
import { createManualEntry, type ManualEntryDraft } from '@/features/transactions/domain/manualLedger';

export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (version?.user_version === 2) return;
  if (version?.user_version !== 0 && version?.user_version !== 1) throw new VaultError('UNSUPPORTED_SCHEMA');
  await db.execAsync('BEGIN IMMEDIATE');
  try {
    if (version.user_version === 0) await db.execAsync(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE card_profiles (account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id), payload TEXT NOT NULL);
      CREATE TABLE manual_entries (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE budgets (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0));
      CREATE TABLE budget_periods (
        id TEXT PRIMARY KEY NOT NULL, budget_id TEXT NOT NULL REFERENCES budgets(id),
        start_date TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(budget_id,start_date)
      );
      CREATE TABLE budget_thresholds (
        period_id TEXT NOT NULL REFERENCES budget_periods(id), threshold INTEGER NOT NULL CHECK(threshold BETWEEN 1 AND 100),
        PRIMARY KEY(period_id,threshold)
      );
      CREATE TABLE budget_signals (
        id TEXT PRIMARY KEY NOT NULL, budget_id TEXT NOT NULL REFERENCES budgets(id), payload TEXT NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(acknowledged IN (0,1))
      );
      CREATE TABLE changes (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, entity_id TEXT NOT NULL, kind TEXT NOT NULL,
        previous_payload TEXT, next_payload TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
    await db.execAsync(`
      CREATE TABLE transactions (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE account_instruments (id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id), payload TEXT NOT NULL);
      CREATE TABLE sms_settings (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
      CREATE TABLE import_batches (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE import_items (batch_id TEXT NOT NULL REFERENCES import_batches(id), position INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(batch_id,position));
      CREATE TABLE source_observations (
        id TEXT PRIMARY KEY NOT NULL, source_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
        transaction_id TEXT REFERENCES transactions(id), batch_id TEXT REFERENCES import_batches(id),
        payload TEXT NOT NULL, source_text TEXT, expires_at INTEGER NOT NULL, decision TEXT NOT NULL
      );
      CREATE INDEX source_fingerprint ON source_observations(fingerprint);
      CREATE TABLE review_items (id TEXT PRIMARY KEY NOT NULL REFERENCES source_observations(id), payload TEXT NOT NULL);
    `);
    const accounts = (await db.getAllAsync<{ id: string; payload: string }>('SELECT id,payload FROM accounts')).map((row) => {
      const raw = JSON.parse(row.payload);
      const account = createLedgerAccount(raw);
      if (row.id !== account.id || raw.currency !== account.currency || typeof raw.archived !== 'boolean') throw new VaultError('INVALID_MIGRATION_RECORD');
      return account;
    });
    const migrated: LedgerTransaction[] = [];
    for (const row of await db.getAllAsync<{ id: string; payload: string }>('SELECT id,payload FROM manual_entries')) {
      const draft = JSON.parse(row.payload) as ManualEntryDraft;
      if (row.id !== draft.id) throw new VaultError('INVALID_MIGRATION_RECORD');
      const legacy = createManualEntry(accounts.map((account) => ({ ...account, archived: false })), draft);
      const canonical = createTransaction(accounts, legacy, true);
      migrated.push(canonical);
      await db.runAsync('INSERT INTO transactions(id,payload) VALUES (?,?)', row.id, JSON.stringify(canonical));
      await db.runAsync("INSERT INTO source_observations(id,source_key,fingerprint,transaction_id,payload,expires_at,decision) VALUES (?,?,?,?,?,0,'manual')",
        `manual:${row.id}`, `manual:${row.id}`, '', row.id, JSON.stringify({ kind: 'manual' }));
    }
    projectLedger(accounts, migrated);
    // Remove the old writable ledger only after every validated record is copied.
    await db.execAsync('DROP TABLE manual_entries; PRAGMA user_version = 2;');
    await db.execAsync('COMMIT');
  } catch {
    await db.execAsync('ROLLBACK').catch(() => undefined);
    throw new VaultError('MIGRATION_FAILED');
  }
}
