import { addCalendarDays, financialDateAt } from '@/core/dates/calendarMath';
import { isCalendarDate } from '@/core/dates/calendarDate';
import type { SmsDate } from './types';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export function parseSmsDate(stated: string | null, receivedAt: number | null): SmsDate {
  const receipt = receivedAt !== null && Number.isSafeInteger(receivedAt) && receivedAt > 0
    ? financialDateAt(new Date(receivedAt)) : null;
  const missing = (precision: 'missing' | 'partial'): SmsDate => Object.freeze({ date: null, precision, stated, suggestion: receipt });
  if (!stated) return missing('missing');
  const match = /^(\d{1,2})[-/](\d{1,2}|[A-Za-z]{3})(?:[-/](\d{2}|\d{4}))?$/.exec(stated);
  if (!match) return missing('partial');
  const day = Number(match[1]);
  const month = /^\d+$/.test(match[2]!) ? Number(match[2]) : MONTHS.indexOf(match[2]!.toUpperCase()) + 1;
  const year = match[3];
  const date = (value: number) => `${String(value).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!year) return missing('partial');
  if (year.length === 4) {
    const parsed = date(Number(year));
    return isCalendarDate(parsed) ? Object.freeze({ date: parsed, precision: 'day', stated, suggestion: null }) : missing('partial');
  }
  if (!receipt) return missing('partial');
  const century = Math.floor(Number(receipt.slice(0, 4)) / 100) * 100;
  const latest = receipt === '9999-12-31' ? receipt : addCalendarDays(receipt, 1);
  const candidates = [century - 100, century, century + 100].map((base) => date(base + Number(year)))
    .filter((value) => isCalendarDate(value) && value >= addCalendarDays(receipt, -366) && value <= latest);
  return candidates.length === 1 ? Object.freeze({ date: candidates[0]!, precision: 'century-resolved', stated, suggestion: null }) : missing('partial');
}
