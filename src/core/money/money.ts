// Reviewed against SIX List One on 2026-11-17. Extend this table deliberately;
// an unknown currency must never silently inherit LKR's decimal scale.
const MINOR_DIGITS = Object.freeze({
  LKR: 2, USD: 2, EUR: 2, GBP: 2, INR: 2, AUD: 2, JPY: 0, KWD: 3,
} as const);

export type CurrencyCode = keyof typeof MINOR_DIGITS;
export const DEFAULT_CURRENCY: CurrencyCode = 'LKR';
export const SUPPORTED_CURRENCIES: readonly CurrencyCode[] = Object.freeze(
  Object.keys(MINOR_DIGITS) as CurrencyCode[],
);

export type Money = Readonly<{ minorUnits: number; currency: CurrencyCode }>;
type MoneyErrorCode = 'invalid_currency' | 'invalid_amount' | 'invalid_minor_units' | 'overflow' | 'currency_mismatch';
const MESSAGES: Record<MoneyErrorCode, string> = {
  invalid_currency: 'Unsupported currency code.',
  invalid_amount: 'Enter a decimal amount using the currency precision.',
  invalid_minor_units: 'Minor units must be a safe integer.',
  overflow: 'The monetary result exceeds the supported integer range.',
  currency_mismatch: 'Amounts in different currencies cannot be combined.',
};

export class MoneyError extends Error {
  constructor(readonly code: MoneyErrorCode) {
    super(MESSAGES[code]);
    this.name = 'MoneyError';
  }
}

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MINOR_DIGITS, value);
}

export function currencyMinorDigits(currency: CurrencyCode): number {
  if (!isCurrencyCode(currency)) throw new MoneyError('invalid_currency');
  return MINOR_DIGITS[currency];
}

export function createMoney(minorUnits: number, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  currencyMinorDigits(currency);
  if (!Number.isSafeInteger(minorUnits)) throw new MoneyError('invalid_minor_units');
  return Object.freeze({ minorUnits: minorUnits === 0 ? 0 : minorUnits, currency });
}

// Use at JSON/database/native boundaries, including values bypassing TS types.
export function readMoney(value: unknown): Money {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MoneyError('invalid_minor_units');
  }
  const fields = value as Record<string, unknown>;
  if (typeof fields.minorUnits !== 'number') throw new MoneyError('invalid_minor_units');
  if (!isCurrencyCode(fields.currency)) throw new MoneyError('invalid_currency');
  return createMoney(fields.minorUnits, fields.currency);
}

const LIMIT = BigInt(Number.MAX_SAFE_INTEGER);
function fromInteger(value: bigint, currency: CurrencyCode): Money {
  if (value > LIMIT || value < -LIMIT) throw new MoneyError('overflow');
  return createMoney(Number(value), currency);
}

// Canonical input only. Locale/grouping and bank-template normalization belong
// in their own input adapters; never guess the meaning of commas or exponents.
export function parseMoney(input: unknown, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  const scale = currencyMinorDigits(currency);
  if (typeof input !== 'string' || input.length > 64) throw new MoneyError('invalid_amount');
  const text = input.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) throw new MoneyError('invalid_amount');
  const negative = text.startsWith('-');
  const [whole = '', fraction = ''] = (negative ? text.slice(1) : text).split('.');
  if (fraction.length > scale) throw new MoneyError('invalid_amount');

  let units = 0n;
  for (const digit of whole + fraction.padEnd(scale, '0')) {
    units = units * 10n + BigInt(digit);
    if (units > LIMIT) throw new MoneyError('overflow');
  }
  return fromInteger(negative ? -units : units, currency);
}

// Exact canonical decimal string, without a currency symbol or locale grouping.
export function formatMoney(value: Money): string {
  const money = readMoney(value);
  const scale = currencyMinorDigits(money.currency);
  const magnitude = BigInt(money.minorUnits) < 0n ? -BigInt(money.minorUnits) : BigInt(money.minorUnits);
  const digits = magnitude.toString().padStart(scale + 1, '0');
  const decimal = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return money.minorUnits < 0 ? `-${decimal}` : decimal;
}

function requireSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) throw new MoneyError('currency_mismatch');
}

export function addMoney(left: Money, right: Money): Money {
  const a = readMoney(left);
  const b = readMoney(right);
  requireSameCurrency(a, b);
  return fromInteger(BigInt(a.minorUnits) + BigInt(b.minorUnits), a.currency);
}

export function subtractMoney(left: Money, right: Money): Money {
  const a = readMoney(left);
  const b = readMoney(right);
  requireSameCurrency(a, b);
  return fromInteger(BigInt(a.minorUnits) - BigInt(b.minorUnits), a.currency);
}

export function negateMoney(value: Money): Money {
  const money = readMoney(value);
  return fromInteger(-BigInt(money.minorUnits), money.currency);
}

export function sumMoney(values: Iterable<Money>, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  currencyMinorDigits(currency);
  let total = 0n;
  for (const value of values) {
    const money = readMoney(value);
    if (money.currency !== currency) throw new MoneyError('currency_mismatch');
    total += BigInt(money.minorUnits);
  }
  return fromInteger(total, currency);
}
