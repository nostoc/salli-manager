import { describe, expect, it } from '@jest/globals';
import { readNativeSmsStatus } from '../nativeStatus';
const complete = { apiVersion: 1, ready: false, configured: false, verified: false, enabled: false, gaps: 0, queued: 0, blockedIds: [] };
describe('native SMS protocol boundary', () => {
  it('returns canonical frozen status for the supported native build', () => {
    const status = readNativeSmsStatus(complete);
    expect(status).toEqual(complete);
    expect(Object.isFrozen(status.blockedIds)).toBe(true);
  });
  it.each([null, {}, { ...complete, apiVersion: undefined }, { ...complete, apiVersion: 2 }])('rejects stale/missing native versions before security operations', (value) => {
    expect(() => readNativeSmsStatus(value)).toThrow();
  });
  it.each([{ ...complete, blockedIds: undefined }, { ...complete, blockedIds: ['not-an-envelope'] }, { ...complete, queued: 1001 }, { ...complete, verified: 'true' }])('rejects malformed bridge status instead of trusting TypeScript types', (value) => {
    expect(() => readNativeSmsStatus(value)).toThrow();
  });
});
