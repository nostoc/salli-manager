import { readMoney, type Money } from '@/core/money/money';
import { createLedgerAccount, type LedgerAccount } from './account';

export type CardProfile = Readonly<{
  accountId: string;
  creditLimit: Money | null;
  statementClosingDay: number | null;
}>;

// Bank-issued information is deliberately independent of spending allowances.
// Unknown values stay unknown; neither a budget nor an SMS balance supplies them.
export function createCardProfile(account: LedgerAccount, input: Readonly<{
  creditLimit?: Money | null; statementClosingDay?: number | null;
}> = {}): CardProfile {
  const card = createLedgerAccount(account);
  if (card.kind !== 'credit-card') throw new RangeError('A credit card account is required.');
  const creditLimit = input.creditLimit == null ? null : readMoney(input.creditLimit);
  if (creditLimit && (creditLimit.currency !== card.currency || creditLimit.minorUnits < 0)) {
    throw new RangeError('Invalid bank credit limit.');
  }
  const statementClosingDay = input.statementClosingDay ?? null;
  if (statementClosingDay !== null && (!Number.isInteger(statementClosingDay) || statementClosingDay < 1 || statementClosingDay > 31)) {
    throw new RangeError('Invalid statement closing day.');
  }
  return Object.freeze({ accountId: card.id, creditLimit, statementClosingDay });
}
