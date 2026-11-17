import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { requireLedgerKey, VaultError } from '@/core/security/nativeVault';

export async function openEncryptedDatabase(name: 'ledger.db' | 'security-probe.db', key: string): Promise<SQLiteDatabase> {
  requireLedgerKey(key);
  if (name !== 'ledger.db' && name !== 'security-probe.db') throw new VaultError('INVALID_DATABASE_NAME');
  // A dedicated connection also avoids Expo's development database inspector.
  const db = await openDatabaseAsync(name, { useNewConnection: true });
  try {
    const cipher = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
    if (!cipher?.cipher_version) throw new VaultError('CIPHER_MISSING');
    // Only a native-generated, fixed-format hexadecimal key reaches this literal.
    await db.execAsync(`PRAGMA key = "x'${key}'";`);
    await db.getFirstAsync('SELECT count(*) AS count FROM sqlite_master');
    await db.execAsync('PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON; PRAGMA temp_store = MEMORY;');
    return db;
  } catch {
    await db.closeAsync().catch(() => undefined);
    throw new VaultError('CIPHER_OPEN_FAILED');
  }
}
