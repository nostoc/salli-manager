import { useState } from 'react';
import { financialDateAt } from '@/core/dates/calendarMath';
import { formatMoney, parseMoney } from '@/core/money/money';
import { insertManualEntry } from '@/core/database/financeRepository';
import { runFinance, useFinance } from '@/core/security/financeSession';
import { nativeVault } from '@/core/security/nativeVault';
import { Button, Card, Choices, Copy, Field, FinanceScreen } from '@/ui/FinanceScreen';
import { createManualEntry, type ManualEntryDraft } from './domain/manualLedger';
import { DEFAULT_CATEGORIES } from './domain/categories';
import { correctSmsExpense } from '@/features/sms/data/smsRepository';
import type { LedgerTransaction } from './domain/ledger';

export function TransactionsScreen() {
  const snapshot = useFinance((state) => state.snapshot);
  const accounts = snapshot?.accounts.filter((account) => !account.archived) ?? [];
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [accountId, setAccountId] = useState('');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(financialDateAt(new Date()));
  const [category, setCategory] = useState('uncategorized');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selected = accounts.find((account) => account.id === accountId) ?? accounts[0];
  const targets = accounts.filter((account) => account.id !== selected?.id && account.currency === selected?.currency);
  const target = targets.find((account) => account.id === toId) ?? targets[0];
  async function save() {
    try {
      if (!selected) throw new Error();
      const base = { id: nativeVault().newId(), amount: parseMoney(amount, selected.currency), date };
      let draft: ManualEntryDraft;
      if (kind === 'transfer') {
        if (!target) throw new Error();
        draft = { ...base, kind, fromAccountId: selected.id, toAccountId: target.id };
      } else if (kind === 'expense') draft = { ...base, kind, accountId: selected.id, categoryId: category };
      else draft = { ...base, kind, accountId: selected.id };
      const canonical = createManualEntry(accounts, draft);
      if (await runFinance((db) => insertManualEntry(db, canonical))) { setCreating(false); setAmount(''); setError(null); }
    } catch { setError('Choose valid accounts, a positive exact decimal amount and a complete date. Transfers require two accounts in the same currency.'); }
  }
  const name = (id: string) => snapshot?.accounts.find((account) => account.id === id)?.name ?? 'Unknown account';
  const entries = [...(snapshot?.entries ?? [])].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).filter((entry) => {
    const label = entry.kind === 'transfer' ? `${name(entry.fromAccountId)} ${name(entry.toAccountId)}` : name(entry.accountId);
    return `${entry.date} ${entry.kind} ${label}`.toLowerCase().includes(search.trim().toLowerCase());
  });
  return <FinanceScreen title="Transactions">
    <Copy>Credit card repayments are transfers from the paying account to the card. They never count as spending or reset budgets.</Copy>
    <Button label={creating ? 'Cancel entry' : 'Add manual entry'} disabled={!accounts.length} onPress={() => { setCreating(!creating); setError(null); }} />
    {!accounts.length ? <Copy>Add an account first. No SMS permission is needed.</Copy> : null}
    {creating ? <Card>
      <Choices<'expense' | 'income' | 'transfer'> label="Entry type" value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }, { value: 'transfer', label: 'Transfer / repayment' }]} />
      <Choices label={kind === 'transfer' ? 'From account' : 'Account'} value={selected?.id ?? ''} onChange={setAccountId} options={accounts.map((account) => ({ value: account.id, label: `${account.name} (${account.currency})` }))} />
      {kind === 'transfer' ? <Choices label="To account" value={target?.id ?? ''} onChange={setToId} options={targets.map((account) => ({ value: account.id, label: account.name }))} /> : null}
      <Field label={`Amount (${selected?.currency ?? 'LKR'})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
      {kind === 'expense' ? <Choices label="Category" value={category} onChange={setCategory} options={DEFAULT_CATEGORIES.map((item) => ({ value: item.id, label: item.name }))} /> : null}
      {error ? <Copy>{error}</Copy> : null}<Button label="Save entry" onPress={() => void save()} />
    </Card> : null}
    <Field label="Search date, type or account" value={search} onChangeText={setSearch} />
    {entries.slice(0, 100).map((entry) => <Card key={entry.id}>
      <Copy>{entry.date} · {entry.kind} · {entry.amount.currency} {formatMoney(entry.amount)}</Copy>
      <Copy>{entry.voided ? 'Voided' : entry.status}{entry.estimated ? ' · estimated authorization' : ''}{entry.merchant ? ` · ${entry.merchant}` : ''}</Copy>
      <Copy>{entry.kind === 'transfer' ? `${name(entry.fromAccountId)} → ${name(entry.toAccountId)}` : name(entry.accountId)}{entry.kind === 'expense' ? ` · ${entry.categoryId ?? 'uncategorized'}` : ''}</Copy>
      {entry.kind === 'expense' && entry.origin === 'sms' && !entry.voided && entry.status !== 'reconciled' ? <ExpenseCorrection key={JSON.stringify(entry)} entry={entry} /> : null}
    </Card>)}
    {entries.length > 100 ? <Copy>Showing the latest 100 matching entries. Refine your search to find older records.</Copy> : null}
  </FinanceScreen>;
}

function ExpenseCorrection({ entry }: { entry: LedgerTransaction }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(formatMoney(entry.amount));
  const [date, setDate] = useState(entry.date);
  const [categoryId, setCategoryId] = useState(entry.kind === 'expense' ? entry.categoryId ?? 'uncategorized' : 'uncategorized');
  return <>
    <Button label={editing ? 'Cancel correction' : 'Correct / confirm SMS purchase'} onPress={() => setEditing(!editing)} />
    {editing ? <Card>
      <Copy>Original SMS evidence stays unchanged. Enter the exact amount and transaction date from your records.</Copy>
      <Field label={`Corrected amount (${entry.amount.currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Field label="Corrected date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
      <Choices label="Corrected category" value={categoryId} onChange={setCategoryId} options={DEFAULT_CATEGORIES.map((category) => ({ value: category.id, label: category.name }))} />
      {[false, true].map((confirm) => <Button key={String(confirm)} label={confirm ? 'Save as confirmed posted expense' : 'Save correction with current status'} onPress={() => {
        let parsed: ReturnType<typeof parseMoney>;
        try { parsed = parseMoney(amount, entry.amount.currency); } catch { return; }
        void runFinance((db) => correctSmsExpense(db, entry, { amount: parsed, date, categoryId, confirm }));
      }} />)}
    </Card> : null}
  </>;
}
