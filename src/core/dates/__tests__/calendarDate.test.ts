import { describe, expect, it } from '@jest/globals';
import { isCalendarDate } from '../calendarDate';

describe('explicit local calendar dates', () => {
  it.each(['2026-11-17', '2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31', '2026-04-30'])(
    'accepts a valid complete date %s', (date) => expect(isCalendarDate(date)).toBe(true),
  );
  it.each([
    '2026-02-29', '1900-02-29', '2100-02-29', '2026-04-31', '2026-06-31',
    '2026-00-01', '2026-13-01', '2026-01-00', '0000-01-01', '2026-01-32',
    '26-11-17', '2026-1-01', '2026-01-1', '2026-11', '2026-11-17T00:00:00Z',
    ' 2026-11-17', '2026-11-17\n', '', null, undefined, 20261117,
  ])('rejects missing, impossible or noncanonical dates', (date) => {
    expect(isCalendarDate(date)).toBe(false);
  });
});
