import { requireOptionalNativeModule } from 'expo';

type FinanceVault = {
  newId(): string;
  unlockAsync(credentialOnly: boolean): Promise<string>;
  cancelAsync(): Promise<void>;
  activateSessionAsync(): Promise<string>;
  inspectProbeAsync(): Promise<{ plaintextHeader: boolean; ordinarySQLiteRejected: boolean }>;
  checkAuthorizationAsync(): Promise<boolean>;
  addListener(event: 'onLock', listener: () => void): { remove(): void };
};

export class VaultError extends Error {
  constructor(readonly code: string) { super('The encrypted vault is unavailable or locked.'); this.name = 'VaultError'; }
}

export function nativeVault(): FinanceVault {
  const module = requireOptionalNativeModule<FinanceVault>('FinanceVault');
  if (!module) throw new VaultError('NATIVE_MODULE_MISSING');
  return module;
}

export function requireLedgerKey(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 64 || !/^[a-f0-9]{64}$/.test(value)) throw new VaultError('INVALID_KEY');
  return value;
}
