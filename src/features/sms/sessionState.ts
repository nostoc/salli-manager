import { create } from 'zustand';
import type { SmsSnapshot } from './data/smsRepository';
import type { HistoryBatch } from './data/historyRepository';
import type { NativeSmsStatus } from './nativeSms';
type SmsState = { snapshot: SmsSnapshot | null; batches: readonly HistoryBatch[]; native: NativeSmsStatus | null; error: string | null; working: boolean };
export const useSms = create<SmsState>(() => ({ snapshot: null, batches: [], native: null, error: null, working: false }));
export function clearSmsState() { useSms.setState({ snapshot: null, batches: [], native: null, error: null, working: false }); }
