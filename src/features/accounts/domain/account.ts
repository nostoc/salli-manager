import { DEFAULT_CURRENCY, currencyMinorDigits, type CurrencyCode } from '@/core/money/money';

export type AccountKind = 'bank' | 'cash' | 'credit-card';

// Only the account fields needed by the ledger. Names, bank identifiers and
// card settings arrive with account management and encrypted persistence.
export type LedgerAccount = Readonly<{
  id: string;
  kind: AccountKind;
  currency: CurrencyCode;
  archived: boolean;
}>;

type AccountInput = Readonly<{
  id: string;
  kind: AccountKind;
  currency?: CurrencyCode;
  archived?: boolean;
}>;

export function createLedgerAccount(input: AccountInput): LedgerAccount {
  if (!input || typeof input !== 'object' || typeof input.id !== 'string' ||
      input.id.length > 128 || !/^[A-Za-z0-9]/.test(input.id) || /[^A-Za-z0-9_-]/.test(input.id) ||
      !['bank', 'cash', 'credit-card'].includes(input.kind) ||
      (input.archived !== undefined && typeof input.archived !== 'boolean')) {
    throw new RangeError('Invalid ledger account definition.');
  }
  const currency = input.currency === undefined ? DEFAULT_CURRENCY : input.currency;
  currencyMinorDigits(currency);
  return Object.freeze({ id: input.id, kind: input.kind, currency, archived: input.archived ?? false });
}
