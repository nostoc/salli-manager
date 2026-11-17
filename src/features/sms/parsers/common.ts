import { parseMoney, type CurrencyCode, SUPPORTED_CURRENCIES } from '@/core/money/money';
import type { BankId, ParsedSmsObservation, SmsKind } from '../domain/types';
import { parseSmsDate } from '../domain/smsDate';
import { safeMerchant } from '../domain/sanitize';

export type TemplateFields = { kind: SmsKind; amount?: string; currency?: string; date?: string; merchant?: string; estimated?: boolean; balance?: string; balanceCurrency?: string };
export function bankMoney(value: string | undefined, currency = 'LKR') {
  if (!value || !SUPPORTED_CURRENCIES.includes(currency as CurrencyCode) || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) return null;
  try { return parseMoney(value.replace(/,/g, ''), currency as CurrencyCode); } catch { return null; }
}
export function observation(bank: BankId, sender: string, body: string, fields: TemplateFields, receivedAt: number | null): ParsedSmsObservation {
  const amount = bankMoney(fields.amount, fields.currency);
  const date = parseSmsDate(fields.date ?? null, receivedAt);
  const markers = [...new Set([...body.matchAll(/\[(?:card|account):\d{4}\]/g)].map((match) => match[0]))];
  const suffix = markers.length === 1 ? /:(\d{4})\]/.exec(markers[0]!)![1]! : null;
  const balance = fields.balanceCurrency ? bankMoney(fields.balance, fields.balanceCurrency) : null;
  const warnings = [];
  if (!amount || amount.minorUnits <= 0) warnings.push('missing_or_invalid_amount');
  if (!date.date) warnings.push('date_confirmation_required');
  if (!suffix) warnings.push('instrument_required');
  if (fields.balance && !balance) warnings.push('invalid_optional_balance');
  if (fields.kind === 'repayment') warnings.push('payer_required');
  if (fields.estimated) warnings.push('estimated_authorization');
  const merchant = safeMerchant(fields.merchant ?? null);
  const categoryId = merchant && /grocery|super\s*market/i.test(merchant) ? 'groceries' : merchant && /taxi|transport|fuel/i.test(merchant) ? 'transport'
    : merchant && /dining|restaurant|cafe/i.test(merchant) ? 'dining' : merchant && /telecom|electric|utility/i.test(merchant) ? 'utilities' : 'uncategorized';
  return Object.freeze({ bank, sender, kind: fields.kind, parserVersion: `${bank}:1`, suffix,
    instrumentKind: fields.kind === 'bill-payment' ? 'bank' : suffix ? 'credit-card' : null,
    amount, date, merchant, categoryId, balance, estimated: fields.estimated ?? false, warnings: Object.freeze(warnings) });
}
