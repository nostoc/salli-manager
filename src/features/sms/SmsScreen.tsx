import { useEffect, useRef, useState } from 'react';
import { Alert, PermissionsAndroid } from 'react-native';
import { router } from 'expo-router';
import { financialDateAt, addCalendarDays } from '@/core/dates/calendarMath';
import { formatMoney, parseMoney } from '@/core/money/money';
import { lockFinance, runFinance, unlockFinance, useFinance } from '@/core/security/financeSession';
import { nativeVault } from '@/core/security/nativeVault';
import { Button, Card, Choices, Copy, Field, FinanceScreen } from '@/ui/FinanceScreen';
import { DEFAULT_CATEGORIES } from '@/features/transactions/domain/categories';
import type { TransactionDraft } from '@/features/transactions/domain/ledger';
import { BANKS, type BankId } from './domain/types';
import { removeInstrument, resolveReview, saveInstrument, saveSmsSettings, type ReviewItem, type ReviewResolution } from './data/smsRepository';
import { commitHistoryChunk, createHistory, discardHistory, pauseHistory, previewHistory, stageHistoryPage, type HistoryBatch } from './data/historyRepository';
import { nativeSms, smsToken } from './nativeSms';
import { useSms } from './sessionState';
import { drainSms, refreshSms } from './smsSession';

async function action(work: () => Promise<void>) {
  useSms.setState({ working: true, error: null });
  try { await work(); await refreshSms(); }
  catch { if (useFinance.getState().status === 'unlocked') useSms.setState({ error: 'The SMS action was not completed. Check the inputs, permission and native encryption status. A changed ledger requires a fresh import preview.' }); }
  finally { useSms.setState({ working: false }); }
}
async function save(work: Parameters<typeof runFinance>[0], historical = false) {
  if (!await runFinance(work, historical ? true : undefined)) throw new Error();
}
export function SmsScreen() {
  const { snapshot, native, error, batches, working } = useSms();
  const finance = useFinance((state) => state.snapshot);
  const accounts = finance?.accounts.filter((account) => !account.archived && account.kind !== 'cash') ?? [];
  const [bank, setBank] = useState<BankId>('hnb');
  const [accountId, setAccountId] = useState('');
  const [suffix, setSuffix] = useState('');
  const today = financialDateAt(new Date());
  const [start, setStart] = useState(addCalendarDays(today, -30));
  const [end, setEnd] = useState(today);
  const selected = accounts.find((account) => account.id === accountId) ?? accounts[0];
  useEffect(() => { void refreshSms(); }, []);
  return <FinanceScreen title="Bank SMS">
    <Button label="Back to More" onPress={() => router.back()} />
    <Copy>Optional, local processing. Manual entry continues without SMS access. Sender names can be spoofed; check uncertain entries against your own records.</Copy>
    {error ? <Copy>{error}</Copy> : null}
    <Card>
      <Copy>Encrypted inbox: {native?.ready ? 'ready' : 'setup or a fresh unlock required'}. Live capture: {native?.enabled ? 'enabled' : 'disabled'}. Waiting: {native?.queued ?? 0}. Missed / expired captures: {native?.gaps ?? 0}.</Copy>
      <Copy>Locked messages wait encrypted until you unlock. Android force-stop, installer restrictions and device battery policies may prevent capture. Historical import can help recover gaps.</Copy>
      {native?.configured && !native.ready ? <Copy>The existing inbox key is unavailable. Lock and authenticate again. If it remains unavailable, leave capture disabled; existing encrypted messages are retained. Setup never replaces an existing key.</Copy> : null}
      {!native?.configured ? <Button label="Set up encrypted SMS inbox (authenticate)" disabled={working || !native} onPress={() => void action(async () => {
        await lockFinance(); await unlockFinance(false);
        await nativeSms().setupAsync(smsToken());
      })} /> : null}
      <Button label="Run native inbox encryption checks" disabled={!native?.ready || working} onPress={() => void action(async () => {
        const results = await nativeSms().verifyAsync(smsToken());
        if (!Object.values(results).every((value) => value === true)) throw new Error();
      })} />
      <Copy>Encryption checks: {native?.verified ? 'PASS on this installation' : 'required before live capture'}.</Copy>
      <Copy>After running the encryption checks, wait at least six seconds without another system unlock. Then test the authenticated SMS wrapping key. Live capture needs both checks to pass.</Copy>
      <Button label="Test SMS Keystore lock after 6 seconds" disabled={!native?.ready || working} onPress={() => void action(async () => {
        if (!await nativeSms().checkAuthorizationAsync(smsToken())) throw new Error();
      })} />
      <Button label="Allow incoming bank SMS" disabled={!native?.verified || working} onPress={() => void action(async () => {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS, { title: 'Incoming bank transactions', message: 'Allow future bank SMS to be sanitized and encrypted locally. Other messages and OTPs are discarded. Historical access is a separate choice.', buttonPositive: 'Continue', buttonNegative: 'Cancel' });
      })} />
      <Copy>Android may lock the vault during a permission dialog. Unlock again, then enable capture. If permission is denied or installer-restricted, keep using manual entry.</Copy>
      <Button label={native?.enabled ? 'Disable live capture' : 'Enable live capture'} disabled={working || (!native?.enabled && !native?.verified)} onPress={() => void action(async () => { await nativeSms().enableAsync(smsToken(), !native?.enabled); })} />
      <Button label="Retry waiting messages" disabled={working} onPress={() => void drainSms(true)} />
      {native?.blockedIds?.length ? <Copy>Unreadable encrypted captures are retained. Other messages can continue. Retry after checking device state, or explicitly discard an unreadable capture if it cannot be recovered.</Copy> : null}
      {native?.blockedIds?.map((id, index) => <Button key={id} label={`Discard unreadable capture ${index + 1}`} disabled={working} onPress={() => Alert.alert('Discard unreadable capture?', 'This deletes only the unreadable encrypted capture and counts a gap. Existing transactions and the phone’s original SMS remain. Historical import may help recover the transaction.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => void action(async () => { await nativeSms().discardBlockedAsync(smsToken(), id); }) },
      ])} />)}
      {__DEV__ ? <>
        <Copy>Development fixtures only: HNB, ending 4826, Cedar Grocery, LKR 23.75, today. Map a disposable test card before testing. These checks need no SMS permissions and do not prove real broadcast delivery.</Copy>
        <Button label="Queue synthetic HNB purchase" disabled={!native?.verified || working} onPress={() => void action(async () => { await nativeSms().queueSyntheticAsync(smsToken(), false); await drainSms(true); })} />
        <Button label="Queue fixture in 10 seconds (background app now)" disabled={!native?.verified || working} onPress={() => void action(async () => { await nativeSms().queueSyntheticAsync(smsToken(), true); })} />
      </> : null}
    </Card>
    <Card>
      <Copy>Confirm the sender names shown in your phone’s SMS details. Only confirmed senders and unambiguous mappings allow automatic pending purchases.</Copy>
      {BANKS.map((item) => <Button key={item.id} label={`${snapshot?.settings.approvedSenders.includes(item.sender) ? 'Confirmed' : 'Confirm'}: ${item.name} — ${item.sender}`} disabled={working || !snapshot} onPress={() => void action(async () => {
        const old = snapshot!.settings.approvedSenders;
        await save((db) => saveSmsSettings(db, { approvedSenders: old.includes(item.sender) ? old.filter((sender) => sender !== item.sender) : [...old, item.sender] }));
      })} />)}
    </Card>
    <Card>
      <Copy>Map a bank and last four digits to one account. Keep full account/card numbers out of every field. Collisions go to review.</Copy>
      <Choices<BankId> label="Bank" value={bank} onChange={setBank} options={BANKS.map((item) => ({ value: item.id, label: item.name }))} />
      <Choices label="Account" value={selected?.id ?? ''} onChange={setAccountId} options={accounts.map((account) => ({ value: account.id, label: `${account.name} (${account.currency})` }))} />
      <Field label="Last four digits only" maxLength={4} keyboardType="number-pad" value={suffix} onChangeText={setSuffix} />
      <Button label="Save mapping" disabled={!selected || working} onPress={() => void action(async () => {
        if (!selected || selected.kind === 'cash') throw new Error();
        const kind = selected.kind;
        await save((db) => saveInstrument(db, { id: nativeVault().newId(), accountId: selected.id, kind, bank, suffix })); setSuffix('');
      })} />
      {snapshot?.instruments.map((item) => <Card key={item.id}><Copy>{BANKS.find((bank) => bank.id === item.bank)?.name} · ending {item.suffix} · {finance?.accounts.find((account) => account.id === item.accountId)?.name}</Copy>
        <Button label="Remove mapping" disabled={working} onPress={() => void action(async () => { await save((db) => removeInstrument(db, item.id)); })} /></Card>)}
    </Card>
    <Card>
      <Copy>Historical SMS import: choose inclusive calendar dates. Scan and preview make no financial entries. Each accepted batch commits up to 50 messages; cancellation keeps completed batches. Unresolved source text expires after seven days.</Copy>
      <Button label="Allow historical SMS access" disabled={!native?.verified || working} onPress={() => void action(async () => {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, { title: 'Historical bank SMS', message: 'Read bank transactions in a date range you choose. Review a local preview before importing. No SMS will be modified or sent.', buttonPositive: 'Continue', buttonNegative: 'Cancel' });
      })} />
      <Field label="From (YYYY-MM-DD)" value={start} onChangeText={setStart} />
      <Field label="Through (YYYY-MM-DD)" value={end} onChangeText={setEnd} />
      <Button label="Create historical scan" disabled={!native?.verified || working} onPress={() => void action(async () => {
        // Colombo midnight is explicit; UTC parsing is used only after strict calendar validation.
        const first = addCalendarDays(start, 0); const next = addCalendarDays(end, 1);
        const startInstant = Date.parse(`${first}T00:00:00+05:30`);
        const endInstant = Math.min(Date.parse(`${next}T00:00:00+05:30`), Date.now());
        await save(async (db) => { await createHistory(db, nativeVault().newId(), startInstant, endInstant); });
      })} />
      {batches.map((item) => <HistoryControls key={item.id} item={item} />)}
    </Card>
    <Copy>Review queue · showing up to 200 unresolved messages. Source text disappears on resolution or after seven days; structured evidence remains encrypted.</Copy>
    {snapshot?.reviews.map((item) => <Review key={item.id} item={item} />)}
  </FinanceScreen>;
}

function HistoryControls({ item }: { item: HistoryBatch }) {
  const cancelled = useRef(false);
  const [running, setRunning] = useState(false);
  useEffect(() => () => { cancelled.current = true; }, []);
  async function scan() {
    cancelled.current = false; setRunning(true);
    try {
      let current = item;
      for (let page = 0; page < 200 && !cancelled.current && !current.scanDone; page++) {
        const result = await nativeSms().historyAsync(smsToken(), current.start, current.end, current.after, current.highWater);
        await save(async (db) => { current = await stageHistoryPage(db, item.id, result); });
        await refreshSms();
      }
    } finally { setRunning(false); }
  }
  async function commit() {
    cancelled.current = false; setRunning(true);
    try {
      let current = item;
      while (!cancelled.current && current.status === 'ready') {
        await save(async (db) => { current = await commitHistoryChunk(db, item.id, () => nativeVault().newId()); }, true);
        await refreshSms();
      }
    } finally { setRunning(false); }
  }
  return <Card>
    <Copy>{item.status} · scanned candidates {item.staged} · committed {item.committed} · discarded {item.discarded}{item.expired ? ' (retention expired)' : ''} · created {item.counts.created} · review {item.counts.review} · replayed {item.counts.replayed} · rejected {item.counts.rejected}</Copy>
    {item.preview ? <Copy>Accepted preview scope (includes any chunks committed since this preview): {item.preview.counts.created} pending purchases, {item.preview.counts.review} for review, {item.preview.counts.replayed} replays, {item.preview.counts.rejected} rejected. Pending budget reservation change: {item.preview.pendingChange.map((money) => `${money.currency} ${formatMoney(money)}`).join(', ') || 'none'}. Posted balances stay unchanged.</Copy> : null}
    {!item.scanDone ? <Button label="Scan / continue" disabled={running} onPress={() => void action(scan)} /> : null}
    {item.scanDone && item.status !== 'completed' ? <Button label="Preview remaining import" disabled={running} onPress={() => void action(async () => { await save(async (db) => { await previewHistory(db, item.id, () => nativeVault().newId()); }); })} /> : null}
    {item.status === 'ready' ? <Button label="Accept preview and import" disabled={running} onPress={() => void action(commit)} /> : null}
    {item.status !== 'completed' ? <Button label="Pause after current batch" onPress={() => { cancelled.current = true; void action(async () => { await save(async (db) => { await pauseHistory(db, item.id); }); }); }} /> : null}
    {item.status !== 'completed' && !running ? <Button label="Discard uncommitted scan" onPress={() => void action(async () => { await save(async (db) => { await discardHistory(db, item.id); }); })} /> : null}
  </Card>;
}

function Review({ item }: { item: ReviewItem }) {
  const finance = useFinance((state) => state.snapshot);
  const accounts = finance?.accounts.filter((account) => !account.archived) ?? [];
  const [kind, setKind] = useState<'expense' | 'repayment' | 'refund'>(item.observation.kind === 'repayment' ? 'repayment' : item.observation.kind === 'refund' ? 'refund' : 'expense');
  const [accountId, setAccountId] = useState('');
  const [payerId, setPayerId] = useState('');
  const [amount, setAmount] = useState(item.observation.amount ? formatMoney(item.observation.amount) : '');
  const [date, setDate] = useState(item.observation.date.date ?? '');
  const [categoryId, setCategoryId] = useState(item.observation.categoryId);
  const [originalId, setOriginalId] = useState('');
  const [existingId, setExistingId] = useState('');
  const [status, setStatus] = useState<'pending' | 'confirmed'>('pending');
  const selected = accounts.find((account) => account.id === accountId);
  const originals = finance?.entries.filter((entry) => entry.kind === 'expense' && entry.accountId === selected?.id && entry.status !== 'pending' && !entry.voided) ?? [];
  function resolve(resolution: ReviewResolution) { void action(async () => { await save((db) => resolveReview(db, item.id, resolution)); }); }
  async function create() {
    if (!selected) throw new Error();
    const base = { id: nativeVault().newId(), amount: parseMoney(amount, selected.currency), date };
    let draft: TransactionDraft;
    if (kind === 'repayment') draft = { ...base, kind: 'transfer', fromAccountId: payerId, toAccountId: selected.id };
    else if (kind === 'refund') draft = { ...base, kind, accountId: selected.id, originalExpenseId: originalId };
    else draft = { ...base, kind, accountId: selected.id, categoryId };
    await save((db) => resolveReview(db, item.id, { kind: 'create', draft, status: kind === 'expense' ? status : 'confirmed', estimated: kind === 'expense' && status === 'pending' && item.observation.estimated }));
  }
  return <Card>
    <Copy>{item.observation.sender} · {item.observation.kind} · ending {item.observation.suffix ?? 'unknown'} · {item.observation.merchant ?? 'merchant unknown'}</Copy>
    <Copy>{item.reasons.map((reason) => reason.replace(/_/g, ' ')).join('; ')}</Copy>
    <Copy>{item.text ?? 'Source text expired or removed.'}</Copy>
    {item.observation.date.suggestion ? <Copy>Receipt-date suggestion (not applied): {item.observation.date.suggestion}. Confirm the real transaction date.</Copy> : null}
    {item.candidates.map((id) => {
      const entry = finance?.entries.find((entry) => entry.id === id);
      return entry ? <Card key={id}><Copy>Possible existing entry: {entry.date} · {entry.amount.currency} {formatMoney(entry.amount)} · {entry.merchant ?? entry.kind}</Copy>
        <Button label="Attach evidence to this existing entry" onPress={() => resolve({ kind: 'link', transactionId: id })} />
        <Button label="This reverses that entry (void original)" onPress={() => resolve({ kind: 'reverse', transactionId: id })} /></Card> : null;
    })}
    <Choices label="Or select an existing transaction for evidence / reversal" value={existingId} onChange={setExistingId} options={[...(finance?.entries ?? [])].filter((entry) => !entry.voided && entry.kind !== 'opening-balance').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100).map((entry) => ({ value: entry.id, label: `${entry.date} ${entry.kind} ${entry.amount.currency} ${formatMoney(entry.amount)} ${entry.merchant ?? ''}` }))} />
    <Button label="Attach to selected existing transaction" disabled={!existingId} onPress={() => resolve({ kind: 'link', transactionId: existingId })} />
    <Button label="Reverse selected original (void it)" disabled={!existingId} onPress={() => resolve({ kind: 'reverse', transactionId: existingId })} />
    <Choices<'expense' | 'repayment' | 'refund'> label="Explicit classification" value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Purchase / bill expense' }, { value: 'repayment', label: 'Card repayment' }, { value: 'refund', label: 'Linked refund' }]} />
    <Choices label={kind === 'repayment' ? 'Receiving credit card' : 'Account (required)'} value={accountId} onChange={setAccountId} options={accounts.filter((account) => kind !== 'repayment' || account.kind === 'credit-card').map((account) => ({ value: account.id, label: `${account.name} (${account.currency})` }))} />
    {kind === 'repayment' ? <Choices label="Paying account (required)" value={payerId} onChange={setPayerId} options={accounts.filter((account) => account.kind !== 'credit-card' && account.currency === selected?.currency).map((account) => ({ value: account.id, label: account.name }))} /> : null}
    <Field label={`Confirmed amount (${selected?.currency ?? 'choose account'})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
    <Field label="Confirmed transaction date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
    {kind === 'expense' ? <><Choices label="Category" value={categoryId} onChange={setCategoryId} options={DEFAULT_CATEGORIES.map((category) => ({ value: category.id, label: category.name }))} />
      <Choices<'pending' | 'confirmed'> label="Lifecycle" value={status} onChange={setStatus} options={[{ value: 'pending', label: 'Pending authorization' }, { value: 'confirmed', label: 'Confirmed posted' }]} /></> : null}
    {kind === 'refund' ? <Choices label="Original posted purchase (required)" value={originalId} onChange={setOriginalId} options={originals.map((entry) => ({ value: entry.id, label: `${entry.date} ${entry.amount.currency} ${formatMoney(entry.amount)} ${entry.merchant ?? ''}` }))} /> : null}
    <Button label="Create a separate transaction with these details" disabled={!selected} onPress={() => void action(create)} />
    <Button label="Dismiss without financial effects" onPress={() => resolve({ kind: 'dismiss' })} />
  </Card>;
}
