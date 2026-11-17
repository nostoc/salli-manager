import { describe, expect, it } from '@jest/globals';
import { MoneyError, createMoney, parseMoney } from '@/core/money/money';
import { createLedgerAccount, type LedgerAccount } from '@/features/accounts/domain/account';
import { LedgerError, createManualEntry, projectManualLedger, type ManualEntryDraft, type LedgerProjection } from '../manualLedger';

// Independently synthetic accounts and amounts. No supplied SMS records.
const bank = createLedgerAccount({ id: 'bank-a', kind: 'bank' });
const cash = createLedgerAccount({ id: 'cash-a', kind: 'cash' });
const card = createLedgerAccount({ id: 'card-a', kind: 'credit-card' });
const accounts = Object.freeze([bank, cash, card]);
const date = '2001-01-15';

function entry(id: string, kind: 'opening-balance' | 'expense' | 'income', amount: string, accountId = bank.id): ManualEntryDraft {
  return { id, kind, amount: parseMoney(amount), date, accountId };
}
function transfer(id: string, amount: string, fromAccountId = bank.id, toAccountId = card.id): ManualEntryDraft {
  return { id, kind: 'transfer', amount: parseMoney(amount), date, fromAccountId, toAccountId };
}
function balance(result: LedgerProjection, accountId: string) {
  const found = result.balances.find((value) => value.accountId === accountId);
  if (!found) throw new Error('Missing synthetic test account.');
  return found.balance;
}
function lkr(result: LedgerProjection) {
  const found = result.totals.find((value) => value.currency === 'LKR');
  if (!found) throw new Error('Missing synthetic test currency.');
  return found;
}

describe('ledger account definitions', () => {
  it('defaults to LKR, remains immutable and permits an empty ledger', () => {
    expect(bank).toEqual({ id: 'bank-a', kind: 'bank', currency: 'LKR', archived: false });
    expect(Object.isFrozen(bank)).toBe(true);
    expect(projectManualLedger([], [])).toEqual({ balances: [], totals: [] });
    expect(balance(projectManualLedger(accounts, []), card.id)).toEqual(createMoney(0));
  });

  it.each([
    null, {}, { id: '', kind: 'bank' }, { id: 'bank-a\n', kind: 'bank' },
    { id: ' bank-a', kind: 'bank' }, { id: 'a'.repeat(129), kind: 'bank' },
    { id: 'bank-a', kind: 'unknown' }, { id: 'bank-a', kind: 'bank', archived: 'true' },
    { id: 'bank-a', kind: 'bank', archived: null },
  ])('rejects malformed account definitions', (value) => {
    expect(() => createLedgerAccount(value as Parameters<typeof createLedgerAccount>[0])).toThrow(RangeError);
  });

  it('rejects unsupported currencies and duplicate account IDs', () => {
    expect(() => createLedgerAccount({ id: 'bank-a', kind: 'bank', currency: 'XYZ' as LedgerAccount['currency'] })).toThrow(MoneyError);
    expect(() => projectManualLedger([bank, bank], [])).toThrow(LedgerError);
  });
});

describe('opening balances and posting signs', () => {
  it('recognizes assets and card liabilities without inventing income or expenses', () => {
    const result = projectManualLedger(accounts, [
      entry('open-bank', 'opening-balance', '1000.00'),
      entry('open-cash', 'opening-balance', '100.00', cash.id),
      entry('open-card', 'opening-balance', '100.00', card.id),
    ]);
    expect(balance(result, bank.id)).toEqual(parseMoney('1000.00'));
    expect(balance(result, card.id)).toEqual(parseMoney('100.00'));
    expect(lkr(result)).toEqual({ currency: 'LKR', income: createMoney(0), expenses: createMoney(0), netWorth: parseMoney('1000.00') });
  });

  it('supports bank overdrafts, card credit balances and zero openings', () => {
    const result = projectManualLedger(accounts, [
      entry('open-bank', 'opening-balance', '-100.00'),
      entry('open-card', 'opening-balance', '-25.00', card.id),
      entry('open-cash', 'opening-balance', '0', cash.id),
    ]);
    expect(balance(result, bank.id)).toEqual(parseMoney('-100.00'));
    expect(balance(result, card.id)).toEqual(parseMoney('-25.00'));
    expect(balance(result, cash.id)).toEqual(createMoney(0));
    expect(lkr(result).netWorth).toEqual(parseMoney('-75.00'));
    expect(createManualEntry(accounts, entry('open-zero', 'opening-balance', '0', card.id)).postings).toEqual([]);
    expect(createManualEntry(accounts, entry('open-card-positive', 'opening-balance', '2', card.id)).postings[0]?.direction).toBe('debit');
  });

  it('rejects a second opening balance even with a different entry ID', () => {
    expect(() => projectManualLedger(accounts, [entry('a', 'opening-balance', '0'), entry('b', 'opening-balance', '1')]))
      .toThrow(LedgerError);
  });
});

describe('manual expenses, income and transfers', () => {
  it('debits bank/cash expenses and credits income without counting transfers twice', () => {
    const result = projectManualLedger(accounts, [
      entry('opening', 'opening-balance', '1000'), entry('salary', 'income', '100'),
      transfer('withdrawal', '150', bank.id, cash.id), entry('purchase', 'expense', '30', cash.id),
    ]);
    expect(balance(result, bank.id)).toEqual(parseMoney('950'));
    expect(balance(result, cash.id)).toEqual(parseMoney('120'));
    expect(lkr(result).income).toEqual(parseMoney('100'));
    expect(lkr(result).expenses).toEqual(parseMoney('30'));
    expect(lkr(result).netWorth).toEqual(parseMoney('1070'));
  });

  it.each([['20', '30', '980'], ['50', '0', '950'], ['60', '-10', '940']])(
    'treats a %s card repayment as a transfer, preserving purchase spending', (paid, outstanding, bankBalance) => {
      const before = [entry('opening', 'opening-balance', '1000'), entry('purchase', 'expense', '50', card.id)];
      const result = projectManualLedger(accounts, [...before, transfer('repayment', paid)]);
      expect(balance(result, card.id)).toEqual(parseMoney(outstanding));
      expect(balance(result, bank.id)).toEqual(parseMoney(bankBalance));
      expect(lkr(result).expenses).toEqual(lkr(projectManualLedger(accounts, before)).expenses);
      expect(lkr(result).expenses).toEqual(parseMoney('50'));
      expect(lkr(result).income).toEqual(createMoney(0));
      expect(lkr(result).netWorth).toEqual(parseMoney('950'));
    },
  );

  it('records a card cash advance as a transfer and its fee as a separate expense', () => {
    const result = projectManualLedger(accounts, [
      transfer('advance', '100', card.id, cash.id), entry('fee', 'expense', '4', card.id),
    ]);
    expect(balance(result, card.id)).toEqual(parseMoney('104'));
    expect(balance(result, cash.id)).toEqual(parseMoney('100'));
    expect(lkr(result).expenses).toEqual(parseMoney('4'));
    expect(lkr(result).income).toEqual(createMoney(0));
    expect(lkr(result).netWorth).toEqual(parseMoney('-4'));
  });

  it('keeps multiple credit card balances separate', () => {
    const secondCard = createLedgerAccount({ id: 'card-b', kind: 'credit-card' });
    const result = projectManualLedger([...accounts, secondCard], [
      entry('opening', 'opening-balance', '1000'),
      entry('first', 'expense', '40', card.id), entry('second', 'expense', '70', secondCard.id),
      transfer('payment', '10'),
    ]);
    expect(balance(result, card.id)).toEqual(parseMoney('30'));
    expect(balance(result, secondCard.id)).toEqual(parseMoney('70'));
    expect(lkr(result).expenses).toEqual(parseMoney('110'));
    expect(lkr(result).netWorth).toEqual(parseMoney('890'));
  });

  it('handles explicit manual income credited to a card as a reduction of its liability', () => {
    const result = projectManualLedger(accounts, [entry('income', 'income', '5', card.id)]);
    expect(balance(result, card.id)).toEqual(parseMoney('-5'));
    expect(lkr(result).income).toEqual(parseMoney('5'));
    expect(lkr(result).netWorth).toEqual(parseMoney('5'));
  });

  it('reports each currency separately and rejects implicit conversion', () => {
    const usdAccount = createLedgerAccount({ id: 'usd-bank', kind: 'bank', currency: 'USD' });
    const all = [...accounts, usdAccount];
    const result = projectManualLedger(all, [
      entry('lkr-income', 'income', '44'),
      { id: 'usd-income', kind: 'income', accountId: usdAccount.id, amount: parseMoney('22', 'USD'), date },
    ]);
    expect(result.totals.map((total) => [total.currency, total.income.minorUnits])).toEqual([['LKR', 4400], ['USD', 2200]]);
    expect(() => createManualEntry(all, transfer('fx', '10', bank.id, usdAccount.id))).toThrow(LedgerError);
    expect(() => createManualEntry(all, { id: 'wrong-currency', kind: 'expense', accountId: bank.id, amount: parseMoney('10', 'USD'), date }))
      .toThrow(LedgerError);
  });
});

describe('ledger integrity and historical records', () => {
  it('rejects replayed IDs while preserving genuinely repeated equal purchases', () => {
    const purchase = entry('purchase-a', 'expense', '12.50', card.id);
    expect(() => projectManualLedger(accounts, [purchase, purchase])).toThrow(LedgerError);
    const result = projectManualLedger(accounts, [purchase, entry('purchase-b', 'expense', '12.50', card.id)]);
    expect(lkr(result).expenses).toEqual(parseMoney('25.00'));
  });

  it('prevents new transactions on archived accounts while retaining their history', () => {
    const archived = createLedgerAccount({ ...bank, archived: true });
    const purchase = entry('purchase', 'expense', '20');
    expect(() => createManualEntry([archived], purchase)).toThrow(LedgerError);
    const result = projectManualLedger([archived], [entry('opening', 'opening-balance', '100'), purchase]);
    expect(balance(result, bank.id)).toEqual(parseMoney('80'));
  });

  it.each(['0', '-1'])('rejects a nonpositive manual amount', (amount) => {
    for (const draft of [entry('expense', 'expense', amount), entry('income', 'income', amount), transfer('transfer', amount)]) {
      expect(() => createManualEntry(accounts, draft)).toThrow(LedgerError);
    }
  });

  it('rejects invalid dates, identities, missing accounts, unknown kinds and malformed money', () => {
    const valid = entry('valid', 'expense', '10');
    const invalid = [
      null, { ...valid, id: '' }, { ...valid, id: 'bad\n' }, { ...valid, id: 'a'.repeat(129) },
      { ...valid, date: '2001-02-29' }, { ...valid, accountId: 'unknown' },
      { ...valid, kind: 'refund' }, { ...valid, amount: { minorUnits: 1.5, currency: 'LKR' } },
    ];
    for (const draft of invalid) {
      expect(() => createManualEntry(accounts, draft as ManualEntryDraft)).toThrow();
    }
    expect(() => createManualEntry(accounts, transfer('same', '10', bank.id, bank.id))).toThrow(LedgerError);
    expect(() => createManualEntry(accounts, transfer('external', '10', 'unknown', card.id))).toThrow(LedgerError);
  });

  it('returns immutable records and discards unrelated input fields', () => {
    const draft = { ...entry('purchase', 'expense', '10'), unrelated: 'SYNTHETIC-PRIVATE-MARKER' };
    const created = createManualEntry(accounts, draft);
    expect(created).not.toHaveProperty('unrelated');
    expect(created.status).toBe('confirmed');
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.postings)).toBe(true);
    expect(Object.isFrozen(created.postings[0])).toBe(true);
    const result = projectManualLedger(accounts, [draft]);
    expect(Object.isFrozen(result.balances)).toBe(true);
    expect(Object.isFrozen(result.totals[0])).toBe(true);
    expect(accounts).toEqual([bank, cash, card]);
    expect(draft.amount).toEqual(parseMoney('10'));
  });

  it('rejects account, expense-total and net-worth overflow', () => {
    const maximum = createMoney(Number.MAX_SAFE_INTEGER);
    const opening: ManualEntryDraft = { id: 'opening', kind: 'opening-balance', accountId: bank.id, amount: maximum, date };
    expect(() => projectManualLedger(accounts, [opening, entry('income', 'income', '0.01')])).toThrow(MoneyError);
    expect(() => projectManualLedger(accounts, [opening, { ...opening, id: 'second-opening', accountId: cash.id }])).toThrow(MoneyError);
    const hugeExpense: ManualEntryDraft = { id: 'large-expense', kind: 'expense', accountId: bank.id, amount: maximum, date };
    expect(() => projectManualLedger(accounts, [hugeExpense, { ...hugeExpense, id: 'other-expense', accountId: cash.id }])).toThrow(MoneyError);
    // A failed projection cannot mutate state used by a subsequent valid calculation.
    expect(lkr(projectManualLedger(accounts, [opening])).netWorth).toEqual(maximum);
  });
});
