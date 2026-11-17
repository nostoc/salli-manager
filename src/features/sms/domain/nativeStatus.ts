import { SmsError } from './types';
export const SMS_NATIVE_API_VERSION = 1;
export type NativeSmsStatus = Readonly<{ apiVersion: number; ready: boolean; configured: boolean; verified: boolean; enabled: boolean; gaps: number; queued: number; blockedIds: readonly string[] }>;
export function readNativeSmsStatus(value: unknown): NativeSmsStatus {
  if (!value || typeof value !== 'object' || (value as { apiVersion?: unknown }).apiVersion !== SMS_NATIVE_API_VERSION) throw new SmsError('native_build_outdated');
  const item = value as NativeSmsStatus;
  if (['ready', 'configured', 'verified', 'enabled'].some((key) => typeof item[key as 'ready'] !== 'boolean') ||
      !Number.isSafeInteger(item.gaps) || item.gaps < 0 || !Number.isSafeInteger(item.queued) || item.queued < 0 || item.queued > 1000 ||
      !Array.isArray(item.blockedIds) || item.blockedIds.length > 50 || item.blockedIds.some((id) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))) throw new SmsError('invalid_native_status');
  return Object.freeze({ apiVersion: SMS_NATIVE_API_VERSION, ready: item.ready, configured: item.configured, verified: item.verified,
    enabled: item.enabled, gaps: item.gaps, queued: item.queued, blockedIds: Object.freeze([...item.blockedIds]) });
}
