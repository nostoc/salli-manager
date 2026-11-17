import { useState } from 'react';
import { financialDateAt } from '@/core/dates/calendarMath';
import { formatMoney, parseMoney, SUPPORTED_CURRENCIES, type CurrencyCode } from '@/core/money/money';
import { insertAccount, requirePrivateLabel } from '@/core/database/financeRepository';
import { runFinance, useFinance } from '@/core/security/financeSession';
import { nativeVault } from '@/core/security/nativeVault';
import { Button, Card, Choices, Copy, Field, FinanceScreen } from '@/ui/FinanceScreen';
import { createLedgerAccount, type LedgerAccount } from './domain/account';
import { createCardProfile } from './domain/cardProfile';
import type { ManualEntryDraft } from '@/features/transactions/domain/manualLedger';
import { projectLedger } from '@/features/transactions/domain/ledger';

export function AccountsScreen() {
  const snapshot = useFinance((state) => state.snapshot);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LedgerAccount['kind']>('credit-card');
  const [currency, setCurrency] = useState<CurrencyCode>('LKR');
  const [opening, setOpening] = useState('');
  const [date, setDate] = useState(financialDateAt(new Date()));
  const [limit, setLimit] = useState('');
  const [closingDay, setClosingDay] = useState('');
  const [error, setError] = useState<string | null>(null);
  const projection = snapshot ? projectLedger(snapshot.accounts, snapshot.entries) : null;
  async function save() {
    try {
      const account = { ...createLedgerAccount({ id: nativeVault().newId(), kind, currency }), name: requirePrivateLabel(name) };
      const profile = kind === 'credit-card' ? createCardProfile(account, { creditLimit: limit.trim() ? parseMoney(limit, currency) : null,
        statementClosingDay: closingDay.trim() ? (/^\d{1,2}$/.test(closingDay) ? Number(closingDay) : NaN) : null }) : undefined;
      const initial: ManualEntryDraft | undefined = opening.trim() ? { id: nativeVault().newId(), kind: 'opening-balance', accountId: account.id,
        amount: parseMoney(opening, currency), date } : undefined;
      if (await runFinance((db) => insertAccount(db, account, profile, initial))) {
        setCreating(false); setName(''); setOpening(''); setLimit(''); setClosingDay(''); setError(null);
      }
    } catch { setError('Check the account name, exact decimal amounts, complete date and closing day (1–31). Do not enter full account or card numbers.'); }
  }
  return <FinanceScreen title="Accounts">
    <Copy>Calculated balances reflect the records you enter. Bank limits are separate from personal spending budgets.</Copy>
    <Button label={creating ? 'Cancel new account' : 'Add account'} onPress={() => { setCreating(!creating); setError(null); }} />
    {creating ? <Card>
      <Field label="Account name (no full numbers)" value={name} onChangeText={setName} />
      <Choices<LedgerAccount['kind']> label="Account type" value={kind} onChange={setKind} options={[{ value: 'credit-card', label: 'Credit card' }, { value: 'bank', label: 'Bank' }, { value: 'cash', label: 'Cash' }]} />
      <Choices<CurrencyCode> label="Currency" value={currency} onChange={setCurrency} options={SUPPORTED_CURRENCIES.map((value) => ({ value, label: value }))} />
      <Field label="Opening balance (optional; signed decimal)" value={opening} onChangeText={setOpening} keyboardType="numbers-and-punctuation" />
      <Field label="Opening balance date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
      {kind === 'credit-card' ? <>
        <Copy>A positive opening balance is card debt. A negative balance is credit owed to you.</Copy>
        <Field label="Bank credit limit (optional)" value={limit} onChangeText={setLimit} keyboardType="decimal-pad" />
        <Field label="Bank statement closing day (optional, 1–31)" value={closingDay} onChangeText={setClosingDay} keyboardType="number-pad" />
      </> : null}
      {error ? <Copy>{error}</Copy> : null}
      <Button label="Save account" onPress={() => void save()} />
    </Card> : null}
    {!snapshot?.accounts.length ? <Copy>Add a credit card, bank account or cash account to get started.</Copy> : null}
    {snapshot?.accounts.map((account) => {
      const balance = projection?.balances.find((item) => item.accountId === account.id)?.balance;
      const profile = snapshot.profiles.find((item) => item.accountId === account.id);
      return <Card key={account.id}>
        <Copy>{account.name} · {account.kind} · {account.currency}{account.archived ? ' · Archived' : ''}</Copy>
        <Copy>{account.kind === 'credit-card' ? 'Calculated liability' : 'Calculated balance'}: {balance ? `${balance.currency} ${formatMoney(balance)}` : 'Unavailable'}</Copy>
        <Copy>Pending purchases: {account.currency} {formatMoney(projection!.pending.find((item) => item.accountId === account.id)!.amount)}</Copy>
        {profile ? <Copy>Bank credit limit: {profile.creditLimit ? `${profile.creditLimit.currency} ${formatMoney(profile.creditLimit)}` : 'Unknown'} · Closing day: {profile.statementClosingDay ?? 'Unknown'}</Copy> : null}
      </Card>;
    })}
  </FinanceScreen>;
}
