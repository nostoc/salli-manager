import { openDatabaseAsync } from 'expo-sqlite';
import { openEncryptedDatabase } from '@/core/database/encryptedConnection';
import { nativeVault, requireLedgerKey, VaultError } from './nativeVault';

export type ProbeResult = Readonly<{
  correctKey: boolean; wrongKeyRejected: boolean; noKeyRejected: boolean; encryptedHeader: boolean; ordinarySQLiteRejected: boolean;
}>;

// Development-only disposable synthetic evidence, never financial records.
export async function runSecurityProbe(credentialOnly: boolean): Promise<ProbeResult> {
  if (!__DEV__) throw new VaultError('PROBE_DISABLED');
  let key: string | null = requireLedgerKey(await nativeVault().unlockAsync(credentialOnly));
  try {
    const first = await openEncryptedDatabase('security-probe.db', key);
    try {
      await first.execAsync('CREATE TABLE IF NOT EXISTS synthetic_probe (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);');
      await first.runAsync('INSERT OR IGNORE INTO synthetic_probe(id,value) VALUES (?,?)', 1, 'synthetic-only');
    } finally { await first.closeAsync(); }
    const reopened = await openEncryptedDatabase('security-probe.db', key);
    let correctKey = false;
    try { correctKey = (await reopened.getFirstAsync<{ value: string }>('SELECT value FROM synthetic_probe WHERE id=1'))?.value === 'synthetic-only'; }
    finally { await reopened.closeAsync(); }
    key = null;
    let wrongKeyRejected = false;
    let noKeyRejected = false;
    try {
      const wrong = await openEncryptedDatabase('security-probe.db', '00'.repeat(32));
      await wrong.closeAsync();
    } catch { wrongKeyRejected = true; }
    const noKey = await openDatabaseAsync('security-probe.db', { useNewConnection: true });
    try { await noKey.getFirstAsync('SELECT count(*) FROM sqlite_master'); }
    catch { noKeyRejected = true; }
    finally { await noKey.closeAsync(); }
    const inspection = await nativeVault().inspectProbeAsync();
    const encryptedHeader = !inspection.plaintextHeader;
    const ordinarySQLiteRejected = inspection.ordinarySQLiteRejected;
    if (!correctKey || !wrongKeyRejected || !noKeyRejected || !encryptedHeader || !ordinarySQLiteRejected) throw new VaultError('PROBE_FAILED');
    return Object.freeze({ correctKey, wrongKeyRejected, noKeyRejected, encryptedHeader, ordinarySQLiteRejected });
  } finally { key = null; await nativeVault().cancelAsync().catch(() => undefined); }
}
