import { isCalendarDate } from './calendarDate';

export const DEFAULT_FINANCIAL_TIME_ZONE = 'Asia/Colombo';
const DAY_MS = 86_400_000;

export function requireCalendarDate(value: string): string {
  if (!isCalendarDate(value)) throw new RangeError('A valid complete calendar date is required.');
  return value;
}

// UTC is used solely as a Gregorian ordinal calculator, never to reinterpret a
// transaction's local date. setUTCFullYear avoids Date.UTC's special years 0–99.
export function calendarOrdinal(value: string): number {
  requireCalendarDate(value);
  const date = new Date(0);
  date.setUTCFullYear(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8)));
  return date.getTime() / DAY_MS;
}

export function dateFromOrdinal(ordinal: number): string {
  if (!Number.isSafeInteger(ordinal)) throw new RangeError('Invalid calendar ordinal.');
  const date = new Date(ordinal * DAY_MS);
  const year = date.getUTCFullYear();
  if (!Number.isFinite(date.getTime()) || year < 1 || year > 9999) throw new RangeError('Calendar date is out of range.');
  return `${String(year).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function addCalendarDays(date: string, days: number): string {
  if (!Number.isSafeInteger(days)) throw new RangeError('Calendar days must be an integer.');
  return dateFromOrdinal(calendarOrdinal(date) + days);
}

export function daysBetween(start: string, end: string): number {
  return calendarOrdinal(end) - calendarOrdinal(start);
}

export function anchoredMonthDate(date: string, monthOffset: number, anchorDay: number): string {
  requireCalendarDate(date);
  if (!Number.isSafeInteger(monthOffset) || !Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    throw new RangeError('Invalid month or closing day.');
  }
  const serial = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 + monthOffset;
  const year = Math.floor(serial / 12);
  const month = serial - year * 12 + 1;
  if (year < 1 || year > 9999) throw new RangeError('Calendar date is out of range.');
  const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-`;
  for (let day = anchorDay; day >= 1; day--) {
    const candidate = prefix + String(day).padStart(2, '0');
    if (isCalendarDate(candidate)) return candidate;
  }
  throw new RangeError('Invalid calendar month.');
}

export function validateFinancialTimeZone(timeZone: string): string {
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 128) throw new RangeError('Invalid financial timezone.');
  try { new Intl.DateTimeFormat('en', { timeZone }).format(0); }
  catch { throw new RangeError('Invalid financial timezone.'); }
  return timeZone;
}

export function financialDateAt(instant: Date, timeZone = DEFAULT_FINANCIAL_TIME_ZONE): string {
  validateFinancialTimeZone(timeZone);
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) throw new RangeError('Invalid financial clock.');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', era: 'short',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  if (get('era') !== 'AD') throw new RangeError('Calendar date is out of range.');
  return requireCalendarDate(`${get('year')?.padStart(4, '0')}-${get('month')}-${get('day')}`);
}
