import type { LedgerAccount } from '@/features/accounts/domain/account';
import { addCalendarDays } from '@/core/dates/calendarMath';
import { createTransaction, type LedgerTransaction } from '@/features/transactions/domain/ledger';
import { BANKS, SmsError, type AccountInstrument, type ParsedSmsObservation, type SmsSettings } from './types';

export function readInstrument(value: AccountInstrument, accounts: readonly LedgerAccount[]): AccountInstrument {
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.id) || !BANKS.some((bank) => bank.id === value.bank) ||
      !/^\d{4}$/.test(value.suffix) || !['credit-card', 'bank'].includes(value.kind)) throw new SmsError('invalid_instrument');
  const account = accounts.find((item) => item.id === value.accountId);
  if (!account || account.kind !== value.kind) throw new SmsError('invalid_instrument_account');
  return Object.freeze({ id: value.id, accountId: account.id, bank: value.bank, kind: value.kind, suffix: value.suffix });
}
export function readSmsSettings(value: SmsSettings): SmsSettings {
  if (!value || !Array.isArray(value.approvedSenders) || value.approvedSenders.length > BANKS.length ||
      new Set(value.approvedSenders).size !== value.approvedSenders.length || value.approvedSenders.some((sender) => !BANKS.some((bank) => bank.sender === sender))) throw new SmsError('invalid_settings');
  return Object.freeze({ approvedSenders: Object.freeze([...value.approvedSenders]) });
}

export type IngestionDecision = Readonly<{ transaction: LedgerTransaction | null; reasons: readonly string[]; candidates: readonly string[] }>;
export function decidePurchase(input: Readonly<{
  id: string; observation: ParsedSmsObservation; accounts: readonly LedgerAccount[]; instruments: readonly AccountInstrument[];
  settings: SmsSettings; entries: readonly LedgerTransaction[]; fingerprintCandidates?: readonly string[];
}>): IngestionDecision {
  const { observation: item, accounts, entries } = input;
  const reasons: string[] = [];
  if (!readSmsSettings(input.settings).approvedSenders.includes(item.sender)) reasons.push('sender_confirmation_required');
  if (item.kind !== 'purchase') reasons.push(item.kind === 'repayment' ? 'payer_required' : 'unsupported_or_incomplete_template');
  if (!item.amount || item.amount.minorUnits <= 0) reasons.push('amount_required');
  if (!item.date.date) reasons.push('date_required');
  const matching = input.instruments.map((instrument) => readInstrument(instrument, accounts))
    .filter((instrument) => instrument.bank === item.bank && instrument.suffix === item.suffix && instrument.kind === item.instrumentKind);
  const account = matching.length === 1 ? accounts.find((candidate) => candidate.id === matching[0]!.accountId) : undefined;
  if (!account || account.archived) reasons.push(matching.length > 1 ? 'ambiguous_instrument' : 'account_mapping_required');
  if (account && item.amount && account.currency !== item.amount.currency) reasons.push('currency_mismatch');
  const candidates = new Set(input.fingerprintCandidates ?? []);
  if (account && item.amount && item.date.date) for (const entry of entries) {
    if (entry.voided || entry.kind !== 'expense' || entry.accountId !== account.id || entry.amount.currency !== item.amount.currency || entry.amount.minorUnits !== item.amount.minorUnits) continue;
    // Calendar-date bounds avoid device timezone and millisecond arithmetic.
    const earliest = item.date.date < '0001-01-04' ? '0001-01-01' : addCalendarDays(item.date.date, -3);
    const latest = item.date.date > '9999-12-28' ? '9999-12-31' : addCalendarDays(item.date.date, 3);
    if (entry.date >= earliest && entry.date <= latest) candidates.add(entry.id);
  }
  if (candidates.size) reasons.push('possible_duplicate');
  const transaction = reasons.length === 0 && account && item.amount && item.date.date ? createTransaction(accounts, {
    id: input.id, kind: 'expense', accountId: account.id, amount: item.amount, date: item.date.date,
    categoryId: item.categoryId, merchant: item.merchant, estimated: item.estimated, status: 'pending', origin: 'sms',
  }) : null;
  return Object.freeze({ transaction, reasons: Object.freeze(reasons), candidates: Object.freeze([...candidates]) });
}
