import { requireOptionalNativeModule } from 'expo';
import { SmsError, type SmsEnvelope } from './domain/types';
import { readNativeSmsStatus, type NativeSmsStatus } from './domain/nativeStatus';
export type { NativeSmsStatus } from './domain/nativeStatus';
export type HistoryPage = Readonly<{ envelopes: readonly SmsEnvelope[]; after: number; highWater: number; done: boolean }>;
type FinanceSms = {
  statusAsync(token: string): Promise<NativeSmsStatus>;
  setupAsync(token: string): Promise<void>;
  verifyAsync(token: string): Promise<Record<string, boolean>>;
  checkAuthorizationAsync(token: string): Promise<boolean>;
  queueSyntheticAsync(token: string, delayed: boolean): Promise<void>;
  enableAsync(token: string, enabled: boolean): Promise<void>;
  drainAsync(token: string): Promise<readonly SmsEnvelope[]>;
  ackAsync(token: string, ids: readonly string[]): Promise<void>;
  retryBlockedAsync(token: string): Promise<void>;
  discardBlockedAsync(token: string, id: string): Promise<void>;
  historyAsync(token: string, start: number, end: number, after: number, highWater: number): Promise<HistoryPage>;
  addListener(event: 'onInboxChanged', listener: () => void): { remove(): void };
};
export function nativeSms(): FinanceSms {
  const module = requireOptionalNativeModule<FinanceSms>('FinanceSms');
  if (!module) throw new SmsError('native_build_required');
  const status = async (token: string) => readNativeSmsStatus(await module.statusAsync(token));
  // Never use newer JS against an older installed security implementation.
  // Every operation rechecks the native protocol within its active session.
  return {
    statusAsync: status,
    setupAsync: async (token) => { await status(token); return module.setupAsync(token); },
    verifyAsync: async (token) => { await status(token); return module.verifyAsync(token); },
    checkAuthorizationAsync: async (token) => { await status(token); return module.checkAuthorizationAsync(token); },
    queueSyntheticAsync: async (token, delayed) => { await status(token); return module.queueSyntheticAsync(token, delayed); },
    enableAsync: async (token, enabled) => { await status(token); return module.enableAsync(token, enabled); },
    drainAsync: async (token) => { await status(token); return module.drainAsync(token); },
    ackAsync: async (token, ids) => { await status(token); return module.ackAsync(token, ids); },
    retryBlockedAsync: async (token) => { await status(token); return module.retryBlockedAsync(token); },
    discardBlockedAsync: async (token, id) => { await status(token); return module.discardBlockedAsync(token, id); },
    historyAsync: async (token, start, end, after, highWater) => { await status(token); return module.historyAsync(token, start, end, after, highWater); },
    addListener: (event, listener) => module.addListener(event, listener),
  };
}
let sessionToken: string | null = null;
export function setSmsSessionToken(value: string | null) { sessionToken = value; }
export function smsToken(): string { if (!sessionToken) throw new SmsError('locked'); return sessionToken; }
