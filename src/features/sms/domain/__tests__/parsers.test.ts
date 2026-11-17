import { describe, expect, it } from '@jest/globals';
import { parseSms } from '../../parsers/parseSms';
import { sanitizeSms } from '../sanitize';
import { parseSmsDate } from '../smsDate';

// Independently invented identifiers, merchants, dates and amounts.
const receivedAt = Date.parse('2026-06-13T08:00:00Z');
const hnb = 'HNB SMS Alert VC : XXXX4826 : Cedar Grocery LKR 2,375.40 (12-JUN-2026 09:15)';
describe('bank parser boundaries', () => {
  it.each([
    ['HNB', hnb, 'recognized', 237540, '2026-06-12'],
    ['COMBANK', 'Dear Cardholder, Purchase at Cedar Cafe for LKR 845.20 on 12/06/26 09:20 has been authorised on your credit card #XXXX4826', 'recognized', 84520, '2026-06-12'],
    ['SAMPCCTXN', 'Cr Crd no..XXXX4826 Auth Pmt LKR 3,127.60 at Cedar Market Avl Bal LKR 25,000.00 -Sampath Bank 12-JUN', 'needsReview', 312760, null],
    ['BOC', 'Purchase. Transaction approved on your Credit Card XXXX4826 for LKR 619.35 at Cedar Fuel. Balance Available LKR 24,000.00', 'needsReview', 61935, null],
  ] as const)('parses %s purchase precision without inventing dates', (sender, body, type, minorUnits, date) => {
    const result = parseSms({ sender, body, receivedAt });
    expect(result.type).toBe(type);
    if ('observation' in result) {
      expect(result.observation.amount?.minorUnits).toBe(minorUnits);
      expect(result.observation.date.date).toBe(date);
      expect(result.observation.suffix).toBe('4826');
      expect(result.observation.kind).toBe('purchase');
    } else throw new Error('Expected synthetic purchase');
  });
  it.each([
    ['HNB', 'Thank you for your payment of LKR 1,450.00 made to Card No. XXXX4826 on 12-06-26.'],
    ['COMBANK', 'Dear Cardholder, We thank you for your payment made via ComBank Digital LK for LKR 1,450.00 on 12/06/26 09:20 received towards settlement of your card ending with XXXX4826'],
    ['SAMPCCTXN', 'Cr Crd no..XXXX4826 Credited LKR 1,450.00 for PAYMENT RECEIVED -Sampath Bank 12-JUN'],
    ['BOC', 'Dear Customer, Thank you for payment of LKR 1,450.00 on 12/06/2026 for Credit Card no. XXXX4826'],
  ])('keeps %s card repayments in review until the payer is supplied', (sender, body) => {
    const result = parseSms({ sender, body, receivedAt });
    expect(result.type).toBe('needsReview');
    if ('observation' in result) {
      expect(result.observation.kind).toBe('repayment');
      expect(result.observation.warnings).toContain('payer_required');
    }
  });
  it('preserves approximate foreign authorizations and ignores malformed optional balances', () => {
    const result = parseSms({ sender: 'HNB', body: hnb.replace('LKR 2,375.40', '(Apprx) USD 23.45') + ' Av. Bal LKR broken', receivedAt });
    expect(result.type).toBe('recognized');
    if ('observation' in result) {
      expect(result.observation.estimated).toBe(true);
      expect(result.observation.amount).toEqual({ currency: 'USD', minorUnits: 2345 });
      expect(result.observation.balance).toBeNull();
      expect(result.observation.warnings).toContain('invalid_optional_balance');
    }
  });
  it.each(['0.00', '2,37.40', '1.234', '999999999999999999.00'])('reviews invalid monetary token %s', (token) => {
    expect(parseSms({ sender: 'HNB', body: hnb.replace('2,375.40', token), receivedAt }).type).toBe('needsReview');
  });
  it('reviews unsupported financial templates and incomplete bill payments', () => {
    for (const body of ['Purchase REFUND processed', 'Your card transaction was declined', 'A bill payment effected through Combank Digital. Status - Completed.']) {
      expect(parseSms({ sender: 'COMBANK', body, receivedAt }).type).toBe('needsReview');
    }
  });
  it('reviews contradictory event state and multiple instrument references', () => {
    expect(parseSms({ sender: 'HNB', body: hnb + ' Transaction reversed', receivedAt }).type).toBe('needsReview');
    expect(parseSms({ sender: 'HNB', body: hnb + ' Other Card XXXX9631', receivedAt }).type).toBe('needsReview');
  });
  it.each([
    { sender: 'OTHER', body: hnb }, { sender: 'HNB', body: 'Welcome to our bank' },
    { sender: 'HNB', body: hnb + ' OTP 524109' }, { sender: 'HNB', body: hnb + '\u202e' },
    { sender: 'HNB', body: 'x'.repeat(8193) }, { sender: 'HNB', body: '\ud800' },
  ])('rejects unrelated or unsafe input without returning text', (input) => {
    const result = parseSms({ ...input, receivedAt });
    expect(result.type).toBe('rejected');
    expect(result).not.toHaveProperty('sanitizedText');
  });
});

describe('SMS privacy and date precision', () => {
  it('strips full card/account/phone numbers, preserves exact money and is idempotent', () => {
    const result = sanitizeSms('Card 4444 5555 6666 4826 Account 111122223333 LKR 1234567.89 phone +94701234567');
    expect(result).toEqual({ text: 'Card [card:4826] Account [account:3333] LKR 1234567.89 phone [redacted]' });
    if ('text' in result) expect(sanitizeSms(result.text)).toEqual(result);
  });
  it.each(['OTP', 'PIN', 'CVV', 'password', 'one-time', 'verification code', 'OTP524109', 'OneTimePassword', 'ＯＴＰ', 'code 524109'])('drops authentication content: %s', (word) => {
    expect(sanitizeSms(`${word}: 524109 purchase`)).toEqual({ reason: 'authentication_content' });
  });
  it('bounds UTF-8 bytes independently of string length', () => {
    expect(sanitizeSms('界'.repeat(3000))).toEqual({ reason: 'invalid_size' });
  });
  it('redacts long identifiers using alternative separators and oversized money-like identifiers', () => {
    expect(sanitizeSms('Purchase 4444/5555/6666/4826 LKR 4444555566664826')).toEqual({ text: 'Purchase [redacted] [redacted]' });
  });
  it('resolves only nearby two-digit years and retains the original precision', () => {
    expect(parseSmsDate('12/06/26', receivedAt)).toEqual({ date: '2026-06-12', precision: 'century-resolved', stated: '12/06/26', suggestion: null });
    expect(parseSmsDate('12/06/24', receivedAt).date).toBeNull();
    expect(parseSmsDate('15/06/26', receivedAt).date).toBeNull();
    expect(parseSmsDate('12-JUN', receivedAt)).toMatchObject({ date: null, precision: 'partial', suggestion: '2026-06-13' });
    expect(parseSmsDate('29/02/2025', receivedAt).date).toBeNull();
    expect(parseSmsDate(null, receivedAt).precision).toBe('missing');
  });
});
