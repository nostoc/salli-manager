import { AppState } from 'react-native';
import { create } from 'zustand';
import type { SQLiteDatabase } from 'expo-sqlite';
import { loadFinance, type FinanceSnapshot } from '@/core/database/financeRepository';
import { openEncryptedDatabase } from '@/core/database/encryptedConnection';
import { migrateDatabase } from '@/core/database/schema';
import { nativeVault, VaultError } from './nativeVault';
import { VaultSession } from './vaultSession';
import { setSmsSessionToken } from '@/features/sms/nativeSms';
import { clearSmsState } from '@/features/sms/sessionState';
import { pauseHistoryOnUnlock } from '@/features/sms/data/historyRepository';
import { expireSourceText } from '@/features/sms/data/smsRepository';

type SessionState = {
  status: 'locked' | 'authenticating' | 'opening' | 'unlocked'; snapshot: FinanceSnapshot | null;
  busy: boolean; error: string | null;
  lastInteraction: number;
};
// No persistence middleware, devtools or financial content in route parameters.
export const useFinance = create<SessionState>(() => ({ status: 'locked', snapshot: null, busy: false, error: null, lastInteraction: 0 }));
export function recordInteraction() { useFinance.setState({ lastInteraction: Date.now() }); }
export const financeSession = new VaultSession({
  authorize: (credentialOnly) => nativeVault().unlockAsync(credentialOnly),
  cancel: () => nativeVault().cancelAsync(),
  open: async (key) => {
    if (AppState.currentState !== 'active') throw new VaultError('LOCKED');
    useFinance.setState({ status: 'opening' });
    return openEncryptedDatabase('ledger.db', key);
  },
  initialize: async (db) => {
    if (AppState.currentState !== 'active') throw new VaultError('LOCKED');
    await migrateDatabase(db);
    await db.execAsync('BEGIN IMMEDIATE');
    try {
      await pauseHistoryOnUnlock(db);
      await expireSourceText(db, Date.now());
      await loadFinance(db);
      await db.execAsync('COMMIT');
    } catch (failure) { await db.execAsync('ROLLBACK').catch(() => undefined); throw failure; }
    if (AppState.currentState !== 'active') throw new VaultError('LOCKED');
    const token = await nativeVault().activateSessionAsync();
    if (AppState.currentState !== 'active') throw new VaultError('LOCKED');
    setSmsSessionToken(token);
  },
  changed: (unlocked) => {
    if (!unlocked) { setSmsSessionToken(null); clearSmsState(); }
    if (unlocked && AppState.currentState !== 'active') { void lockFinance(); return; }
    useFinance.setState({ status: unlocked ? 'unlocked' : 'locked', snapshot: null, busy: false });
  },
});

export async function unlockFinance(credentialOnly: boolean) {
  try { nativeVault(); }
  catch {
    useFinance.setState({ status: 'locked', error: 'Open Salli Manager Dev, the installed native development build. Expo Go cannot run the encrypted vault or Keystore module.' });
    return;
  }
  useFinance.setState({ status: 'authenticating', error: null });
  try {
    await financeSession.unlock(credentialOnly);
    if (!await refreshFinance()) { await lockFinance(); throw new VaultError('INVALID_RECORD'); }
  }
  catch { useFinance.setState({ error: 'Unlock was cancelled or the encrypted data is unavailable. Existing data has not been replaced.' }); }
}
export async function lockFinance() {
  await financeSession.lock().catch(() => undefined);
}

// Commands receive only the session-owned connection while inside its queue.
// Do not retain it or start unawaited work from a command.
export async function runFinance(command?: (db: SQLiteDatabase) => Promise<void>, baselineBudgetId?: string | true): Promise<boolean> {
  if (useFinance.getState().status !== 'unlocked') return false;
  useFinance.setState({ busy: true, error: null });
  try {
    const snapshot = await financeSession.transact(async (db) => {
      if (command) await command(db);
      return loadFinance(db, new Date(), baselineBudgetId);
    });
    useFinance.setState({ snapshot });
    return true;
  } catch {
    if (useFinance.getState().status === 'unlocked') useFinance.setState({ error: 'The change could not be saved. Check the inputs and refresh before retrying.' });
    return false;
  } finally { useFinance.setState({ busy: false }); }
}
export function refreshFinance() { return runFinance(); }
