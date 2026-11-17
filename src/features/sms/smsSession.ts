import { financeSession, runFinance, useFinance } from '@/core/security/financeSession';
import { nativeVault } from '@/core/security/nativeVault';
import { loadFinance } from '@/core/database/financeRepository';
import { ingestSmsBatch, loadSms } from './data/smsRepository';
import { purgeExpiredHistory, readHistory } from './data/historyRepository';
import { nativeSms, smsToken } from './nativeSms';
import { useSms } from './sessionState';
import { SmsError } from './domain/types';
const rebuildMessage = 'The installed SMS module is older than this JavaScript. Rebuild Salli Manager Dev with npm run prebuild:development, then npm run android -- --no-bundler. Existing data must not be cleared.';
let draining = false;
let failures = 0;
export async function refreshSms() {
  if (useFinance.getState().status !== 'unlocked') return;
  const token = smsToken();
  try {
    const data = await financeSession.transact(async (db) => {
      const finance = await loadFinance(db);
      await purgeExpiredHistory(db);
      return { snapshot: await loadSms(db, finance.accounts), batches: await readHistory(db) };
    });
    const status = await nativeSms().statusAsync(token);
    if (useFinance.getState().status === 'unlocked' && smsToken() === token) useSms.setState({ ...data, native: status });
  } catch (error) {
    if (useFinance.getState().status === 'unlocked') useSms.setState({ native: null, error: error instanceof SmsError && error.code === 'native_build_outdated' ? rebuildMessage : 'SMS data is unavailable. Rebuild the native development app if the module is missing. Existing data has not been replaced.' });
  }
}
export async function drainSms(manual = false) {
  if (draining || useFinance.getState().status !== 'unlocked') return;
  if (manual) failures = 0;
  if (failures >= 3) return;
  draining = true;
  const token = smsToken();
  try {
    const status = await nativeSms().statusAsync(token);
    if (manual) await nativeSms().retryBlockedAsync(token);
    if (!status.ready || !status.verified) return;
    // Bounded per turn. Additional backlog drains on the next event/poll.
    const envelopes = await nativeSms().drainAsync(token);
    if (envelopes.length) {
      const saved = await runFinance(async (db) => { await ingestSmsBatch(db, envelopes, () => nativeVault().newId()); });
      if (!saved || smsToken() !== token) throw new Error();
      await nativeSms().ackAsync(token, envelopes.map((item) => item.id));
    }
    failures = 0;
    await refreshSms();
  } catch (error) {
    failures++;
    if (useFinance.getState().status === 'unlocked') useSms.setState({ error: error instanceof SmsError && error.code === 'native_build_outdated' ? rebuildMessage : 'SMS intake paused. Encrypted messages were retained for retry. Check permissions and encryption checks, then retry intake.' });
  } finally { draining = false; }
}
