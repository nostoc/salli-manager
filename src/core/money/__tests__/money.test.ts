import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, MoneyError, addMoney, createMoney,
  currencyMinorDigits, formatMoney, isCurrencyCode, negateMoney, parseMoney,
  readMoney, subtractMoney, sumMoney, type CurrencyCode,
} from '../money';

describe('currency precision and exact money input', () => {
  it('defaults to LKR and uses a reviewed currency allowlist', () => {
    expect(DEFAULT_CURRENCY).toBe('LKR');
    expect(parseMoney('42.07')).toEqual({ minorUnits: 4207, currency: 'LKR' });
    expect(currencyMinorDigits('JPY')).toBe(0);
    expect(currencyMinorDigits('KWD')).toBe(3);
    for (const value of ['XYZ', 'lkr', ' LKR', '__proto__', 'constructor', '', null, 123]) {
      expect(isCurrencyCode(value)).toBe(false);
      expect(() => currencyMinorDigits(value as CurrencyCode)).toThrow(MoneyError);
    }
  });

  it.each([
    ['0', 'LKR', 0], ['0.01', 'LKR', 1], ['0.1', 'LKR', 10],
    [' 0008.40 ', 'LKR', 840], ['-8.40', 'LKR', -840], ['-0.00', 'LKR', 0],
    ['125', 'JPY', 125], ['0.001', 'KWD', 1], ['-12.345', 'KWD', -12345],
    ['7.25', 'USD', 725], ['7.25', 'EUR', 725], ['7.25', 'GBP', 725],
    ['7.25', 'INR', 725], ['7.25', 'AUD', 725],
  ] as const)('parses %s %s exactly', (text, currency, units) => {
    expect(parseMoney(text, currency)).toEqual({ minorUnits: units, currency });
  });

  it.each([
    '', ' ', '.25', '1.', '+1', '1,000.00', '1,25', '1e3', '0x10', 'Infinity',
    'NaN', '--1', '1 2', 'LKR 25.00', '1.2.3', '١٢.٣٤', '1\n2', '1'.repeat(65),
    12.34, null, undefined, {},
  ])('rejects ambiguous or malformed input', (value) => {
    expect(() => parseMoney(value)).toThrow(MoneyError);
  });

  it('rejects excess precision instead of silently rounding', () => {
    expect(() => parseMoney('1.001')).toThrow(MoneyError);
    expect(() => parseMoney('1.0', 'JPY')).toThrow(MoneyError);
    expect(() => parseMoney('1.0001', 'KWD')).toThrow(MoneyError);
  });

  it('preserves both safe-integer boundaries and rejects the next minor unit', () => {
    const limit = Number.MAX_SAFE_INTEGER;
    expect(parseMoney('90071992547409.91').minorUnits).toBe(limit);
    expect(parseMoney('-90071992547409.91').minorUnits).toBe(-limit);
    expect(parseMoney('9007199254740991', 'JPY').minorUnits).toBe(limit);
    expect(parseMoney('9007199254740.991', 'KWD').minorUnits).toBe(limit);
    for (const text of ['90071992547409.92', '-90071992547409.92', '9999999999999999999']) {
      expect(() => parseMoney(text)).toThrow(MoneyError);
    }
  });

  it.each([NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1])(
    'rejects invalid numeric minor units', (value) => expect(() => createMoney(value)).toThrow(MoneyError),
  );

  it.each([
    null, [], {}, { minorUnits: '125', currency: 'LKR' },
    { minorUnits: 12.5, currency: 'LKR' }, { minorUnits: 12, currency: 'XYZ' },
    { minorUnits: 12, currency: null }, { minorUnits: Number.MAX_SAFE_INTEGER + 1, currency: 'LKR' },
  ])('validates boundary objects before arithmetic', (value) => {
    expect(() => readMoney(value)).toThrow(MoneyError);
    expect(() => addMoney(value as ReturnType<typeof createMoney>, createMoney(1))).toThrow(MoneyError);
  });

  it('copies only valid monetary fields and normalizes negative zero', () => {
    const value = readMoney({ minorUnits: -0, currency: 'LKR', unrelated: 'synthetic-input' });
    expect(Object.is(value.minorUnits, -0)).toBe(false);
    expect(value).toEqual({ minorUnits: 0, currency: 'LKR' });
    expect(Object.isFrozen(value)).toBe(true);
    expect(JSON.stringify(value)).toBe('{"minorUnits":0,"currency":"LKR"}');
  });

  it('does not include rejected content in errors', () => {
    expect(() => parseMoney('SYNTHETIC-PRIVATE-MARKER')).toThrow('Enter a decimal amount using the currency precision.');
  });
});

describe('integer arithmetic and formatting', () => {
  it('adds fractional currency values exactly and leaves inputs unchanged', () => {
    const left = parseMoney('0.10');
    const right = parseMoney('0.20');
    expect(addMoney(left, right)).toEqual(parseMoney('0.30'));
    expect(subtractMoney(left, right)).toEqual(parseMoney('-0.10'));
    expect(left).toEqual(parseMoney('0.10'));
    expect(right).toEqual(parseMoney('0.20'));
  });

  it('rejects mixed-currency arithmetic and aggregation', () => {
    const lkr = createMoney(100);
    const usd = createMoney(100, 'USD');
    expect(() => addMoney(lkr, usd)).toThrow(MoneyError);
    expect(() => subtractMoney(lkr, usd)).toThrow(MoneyError);
    expect(() => sumMoney([lkr, usd])).toThrow(MoneyError);
    expect(sumMoney([], 'USD')).toEqual(createMoney(0, 'USD'));
  });

  it('rejects arithmetic overflow on either side of the safe range', () => {
    const maximum = createMoney(Number.MAX_SAFE_INTEGER);
    const minimum = negateMoney(maximum);
    expect(() => addMoney(maximum, createMoney(1))).toThrow(MoneyError);
    expect(() => subtractMoney(minimum, createMoney(1))).toThrow(MoneyError);
    expect(() => sumMoney([maximum, maximum])).toThrow(MoneyError);
    expect(negateMoney(minimum)).toEqual(maximum);
    // BigInt intermediates keep a valid final aggregate exact, independently of cancellation order.
    expect(sumMoney([maximum, maximum, minimum])).toEqual(maximum);
    expect(sumMoney([])).toEqual(createMoney(0));
  });

  it('round-trips deterministic synthetic amounts through every supported scale', () => {
    for (const currency of SUPPORTED_CURRENCIES) {
      for (const units of [0, 1, -1, 10, -12345, 7654321, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
        const money = createMoney(units, currency);
        expect(parseMoney(formatMoney(money), currency)).toEqual(money);
        expect(addMoney(money, negateMoney(money))).toEqual(createMoney(0, currency));
      }
    }
    expect(formatMoney(createMoney(1))).toBe('0.01');
    expect(formatMoney(createMoney(-1, 'KWD'))).toBe('-0.001');
    expect(formatMoney(createMoney(1, 'JPY'))).toBe('1');
  });
});
