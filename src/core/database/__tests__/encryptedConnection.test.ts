import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { openDatabaseAsync } from 'expo-sqlite';
import { openEncryptedDatabase } from '../encryptedConnection';
import { requireLedgerKey } from '@/core/security/nativeVault';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
const open = jest.mocked(openDatabaseAsync);
const key = 'ab'.repeat(32); // Synthetic test key, never used by the app.

describe('encrypted connection fail-closed boundary (mocked; not native proof)', () => {
  beforeEach(() => { open.mockReset(); });
  it.each([null, '', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), `${key}\n`, "'; DROP TABLE x; --", 123])('rejects noncanonical key material', (value) => {
    expect(() => requireLedgerKey(value)).toThrow('unavailable or locked');
  });
  it('rejects arbitrary database paths before native access', async () => {
    await expect(openEncryptedDatabase('../outside.db' as 'ledger.db', key)).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });
  it('checks for cipher support before key setup or schema reads and closes unsupported connections', async () => {
    const db = { getFirstAsync: jest.fn<(sql: string) => Promise<unknown>>().mockResolvedValue(null), execAsync: jest.fn(), closeAsync: jest.fn<() => Promise<void>>().mockResolvedValue() };
    open.mockResolvedValue(db as unknown as Awaited<ReturnType<typeof openDatabaseAsync>>);
    await expect(openEncryptedDatabase('ledger.db', key)).rejects.toThrow('unavailable or locked');
    expect(db.getFirstAsync).toHaveBeenCalledWith('PRAGMA cipher_version');
    expect(db.execAsync).not.toHaveBeenCalled();
    expect(db.closeAsync).toHaveBeenCalledTimes(1);
  });
  it('rejects wrong-key or corrupt databases before migrations and sanitizes native errors', async () => {
    const db = { getFirstAsync: jest.fn<(sql: string) => Promise<unknown>>().mockResolvedValueOnce({ cipher_version: 'synthetic' }).mockRejectedValueOnce(new Error(`sensitive ${key}`)),
      execAsync: jest.fn<(sql: string) => Promise<void>>().mockResolvedValue(), closeAsync: jest.fn<() => Promise<void>>().mockResolvedValue() };
    open.mockResolvedValue(db as unknown as Awaited<ReturnType<typeof openDatabaseAsync>>);
    await expect(openEncryptedDatabase('ledger.db', key)).rejects.toThrow('The encrypted vault is unavailable or locked.');
    expect(db.execAsync).toHaveBeenCalledTimes(1); // Only key setup; no pragma/schema mutation after failed read.
    expect(db.closeAsync).toHaveBeenCalledTimes(1);
  });
  it('uses an isolated connection without Expo database inspection and enables integrity controls only after a successful key read', async () => {
    const db = { getFirstAsync: jest.fn<(sql: string) => Promise<unknown>>().mockResolvedValueOnce({ cipher_version: 'synthetic' }).mockResolvedValueOnce({ count: 0 }),
      execAsync: jest.fn<(sql: string) => Promise<void>>().mockResolvedValue(), closeAsync: jest.fn<() => Promise<void>>().mockResolvedValue() };
    open.mockResolvedValue(db as unknown as Awaited<ReturnType<typeof openDatabaseAsync>>);
    await expect(openEncryptedDatabase('ledger.db', key)).resolves.toBe(db);
    expect(open).toHaveBeenCalledWith('ledger.db', { useNewConnection: true });
    expect(db.execAsync.mock.calls[1]?.[0]).toBe('PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON; PRAGMA temp_store = MEMORY;');
    expect(db.closeAsync).not.toHaveBeenCalled();
  });
});
