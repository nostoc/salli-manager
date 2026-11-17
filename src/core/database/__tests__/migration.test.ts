/// <reference types="node" />
import { describe, expect, it } from '@jest/globals';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { migrateDatabase } from '../schema';
function legacy() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY,payload TEXT); CREATE TABLE manual_entries(id TEXT PRIMARY KEY,payload TEXT); PRAGMA user_version=1');
  sql.prepare('INSERT INTO accounts VALUES (?,?)').run('card', JSON.stringify({ id: 'card', kind: 'credit-card', currency: 'LKR', archived: false }));
  const db = { execAsync: async (query: string) => { sql.exec(query); },
    runAsync: async (query: string, ...args: SQLInputValue[]) => sql.prepare(query).run(...args),
    getFirstAsync: async (query: string) => sql.prepare(query).get() ?? null,
    getAllAsync: async (query: string) => sql.prepare(query).all(),
  } as unknown as SQLiteDatabase;
  return { sql, db };
}
describe('schema v1 to v2 migration', () => {
  it('preserves IDs and financial fields and supplies explicit lifecycle and provenance', async () => {
    const { sql, db } = legacy();
    try {
      const original = { id: 'original', kind: 'expense', accountId: 'card', date: '2026-06-12', amount: { minorUnits: 4700, currency: 'LKR' }, categoryId: 'groceries' };
      sql.prepare('INSERT INTO manual_entries VALUES (?,?)').run(original.id, JSON.stringify(original));
      await migrateDatabase(db);
      expect(JSON.parse(sql.prepare('SELECT payload FROM transactions').get()?.payload as string)).toMatchObject({ ...original, status: 'confirmed', origin: 'manual', voided: false });
      expect(sql.prepare('SELECT transaction_id FROM source_observations').get()?.transaction_id).toBe(original.id);
      expect(sql.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
      await migrateDatabase(db);
      expect(sql.prepare('SELECT count(*) AS n FROM transactions').get()?.n).toBe(1);
    } finally { sql.close(); }
  });
  it('rolls back tables and schema version without modifying legacy data if any record is invalid', async () => {
    const { sql, db } = legacy();
    try {
      sql.prepare('INSERT INTO manual_entries VALUES (?,?)').run('invalid', '{"id":"wrong"}');
      await expect(migrateDatabase(db)).rejects.toThrow();
      expect(sql.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
      expect(sql.prepare('SELECT payload FROM manual_entries').get()?.payload).toBe('{"id":"wrong"}');
      expect(sql.prepare("SELECT name FROM sqlite_master WHERE name='transactions'").get()).toBeUndefined();
    } finally { sql.close(); }
  });
});
