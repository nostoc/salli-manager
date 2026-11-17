import type { Money } from '@/core/money/money';

export const BANKS = Object.freeze([
  { id: 'hnb', name: 'HNB', sender: 'HNB' },
  { id: 'commercial', name: 'Commercial Bank', sender: 'COMBANK' },
  { id: 'sampath', name: 'Sampath Bank', sender: 'SAMPCCTXN' },
  { id: 'boc', name: 'Bank of Ceylon', sender: 'BOC' },
] as const);
export type BankId = typeof BANKS[number]['id'];
export type SmsKind = 'purchase' | 'repayment' | 'bill-payment' | 'refund' | 'reversal' | 'decline' | 'unknown';
export type SmsDate = Readonly<{ date: string | null; precision: 'day' | 'century-resolved' | 'partial' | 'missing'; stated: string | null; suggestion: string | null }>;
export type ParsedSmsObservation = Readonly<{
  bank: BankId; sender: string; kind: SmsKind; parserVersion: string; suffix: string | null;
  instrumentKind: 'credit-card' | 'bank' | null; amount: Money | null; estimated: boolean;
  date: SmsDate; merchant: string | null; categoryId: string; balance: Money | null;
  warnings: readonly string[];
}>;
export type ParseResult =
  | Readonly<{ type: 'recognized' | 'needsReview'; observation: ParsedSmsObservation; sanitizedText: string }>
  | Readonly<{ type: 'rejected' | 'malformed'; reason: string }>;
export type SmsEnvelope = Readonly<{
  id: string; sourceKey: string; sender: string; body: string; receivedAt: number; sentAt: number | null;
  intakeAt: number; fingerprint: string; batchId?: string;
}>;
export type AccountInstrument = Readonly<{
  id: string; accountId: string; bank: BankId; kind: 'credit-card' | 'bank'; suffix: string;
}>;
export type SmsSettings = Readonly<{ approvedSenders: readonly string[] }>;
export const DEFAULT_SMS_SETTINGS: SmsSettings = Object.freeze({ approvedSenders: Object.freeze([]) });
export class SmsError extends Error {
  constructor(readonly code: string) { super('SMS input or import state is invalid.'); this.name = 'SmsError'; }
}
export const SOURCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SMS_BATCH_SIZE = 50;

export function normalizeSender(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9 +_-]{1,32}$/.test(value)) throw new SmsError('invalid_sender');
  return value.trim().toUpperCase();
}

export function sourceId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_:.-]{0,191}$/.test(value)) throw new SmsError('invalid_source_id');
  return value;
}
