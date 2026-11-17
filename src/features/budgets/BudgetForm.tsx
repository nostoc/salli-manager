import { useState } from 'react';
import { addCalendarDays, financialDateAt } from '@/core/dates/calendarMath';
import { formatMoney, parseMoney, SUPPORTED_CURRENCIES, type CurrencyCode } from '@/core/money/money';
import { requirePrivateLabel, saveBudget, type BudgetRecord } from '@/core/database/financeRepository';
import { runFinance, useFinance } from '@/core/security/financeSession';
import { nativeVault } from '@/core/security/nativeVault';
import { Button, Card, Choices, Copy, Field } from '@/ui/FinanceScreen';
import { DEFAULT_CATEGORIES } from '@/features/transactions/domain/categories';
import { createBudgetDefinition, revisionAt, scheduleBudgetRevision, setBudgetThresholds } from './domain/budget';
import { resolveBudgetPeriod, type BudgetPeriodRule } from './domain/periods';
import { periodBaseAllowance } from './domain/history';

export function BudgetForm({ record, done }: { record?: BudgetRecord; done(): void }) {
  const snapshot = useFinance((state) => state.snapshot);
  const cards = snapshot?.accounts.filter((account) => account.kind === 'credit-card' && !account.archived) ?? [];
  const original = record?.definition;
  const initial = original?.revisions[original.revisions.length - 1];
  const today = financialDateAt(new Date(), original?.timeZone);
  const active = record?.refresh.summaries.find((item) => item.usage.state === 'active')?.period;
  const canSchedule = !record || (active && revisionAt(record.definition, active.start).rule.kind !== 'one-off' && !record.definition.archived);
  const [name, setName] = useState(original?.name ?? '');
  const [scope, setScope] = useState<'card' | 'overall' | 'category'>(original?.scope.kind ?? (cards.length ? 'card' : 'overall'));
  const [scopeId, setScopeId] = useState(original?.scope.kind === 'overall' ? '' : original?.scope.id ?? cards[0]?.id ?? 'groceries');
  const [currency, setCurrency] = useState<CurrencyCode>(original?.currency ?? 'LKR');
  const [amount, setAmount] = useState(initial ? formatMoney(initial.amount) : '');
  const [kind, setKind] = useState<BudgetPeriodRule['kind']>(initial?.rule.kind ?? 'monthly');
  const [closing, setClosing] = useState(initial?.rule.kind === 'billing' ? String(initial.rule.closingDay) : '');
  const [days, setDays] = useState(initial?.rule.kind === 'repeating' ? String(initial.rule.days) : '14');
  const [start, setStart] = useState(initial?.rule.kind === 'one-off' ? initial.rule.start : active?.end ?? today);
  const [end, setEnd] = useState(initial?.rule.kind === 'one-off' ? initial.rule.endInclusive : today);
  const [rollover, setRollover] = useState(initial?.rollover ?? false);
  const [thresholds, setThresholds] = useState((original?.thresholds ?? [50, 75, 90, 100]).join(','));
  const [error, setError] = useState<string | null>(null);
  const selectedCard = cards.find((account) => account.id === scopeId) ?? cards[0];
  const selectedCategory = DEFAULT_CATEGORIES.find((item) => item.id === scopeId)?.id ?? 'groceries';
  const effectiveCurrency = original?.currency ?? (scope === 'card' ? selectedCard?.currency ?? currency : currency);
  function rule(): BudgetPeriodRule {
    if (kind === 'billing') return { kind, closingDay: /^\d{1,2}$/.test(closing) ? Number(closing) : NaN };
    if (kind === 'repeating') return { kind, days: /^\d{1,6}$/.test(days) ? Number(days) : NaN, anchor: record ? active?.end ?? start : start };
    if (kind === 'one-off') return { kind, start: record ? active?.end ?? start : start, endInclusive: end };
    return { kind };
  }
  let preview = '';
  let previewAllowance = '';
  try {
    const firstDate = record ? active?.end ?? today : start;
    const window = resolveBudgetPeriod(rule(), firstDate);
    const actualStart = record && active && active.end > window.start ? active.end : window.start;
    preview = `${actualStart} through ${addCalendarDays(window.end, -1)} (inclusive).`;
    const base = periodBaseAllowance({ id: 'preview', effectiveFrom: actualStart, amount: parseMoney(amount, effectiveCurrency),
      rule: rule(), rollover: kind === 'one-off' ? false : rollover }, actualStart);
    previewAllowance = `${base.currency} ${formatMoney(base)}`;
  } catch { /* Show input guidance until the preview is valid. */ }
  async function save() {
    try {
      if (!snapshot) return;
      const parsedThresholds = thresholds.trim() === '' ? [] : thresholds.split(',').map((part) => {
        if (!/^\d{1,3}$/.test(part.trim())) throw new Error();
        return Number(part.trim());
      });
      let definition;
      if (!record) {
        if (scope === 'card' && !selectedCard) throw new Error();
        definition = createBudgetDefinition({ id: nativeVault().newId(), name: requirePrivateLabel(name),
          scope: scope === 'overall' ? { kind: scope } : { kind: scope, id: scope === 'card' ? selectedCard!.id : selectedCategory },
          amount: parseMoney(amount, effectiveCurrency), rule: rule(), startDate: start, rollover: kind === 'one-off' ? false : rollover,
          thresholds: parsedThresholds }, snapshot.accounts);
      } else {
        definition = { ...record.definition, name: requirePrivateLabel(name) };
        if (canSchedule && active) definition = scheduleBudgetRevision(definition, { amount: parseMoney(amount, definition.currency),
          rule: rule(), rollover: kind === 'one-off' ? false : rollover }, today, active);
        definition = setBudgetThresholds(definition, parsedThresholds);
      }
      const baseline = !record || JSON.stringify(definition.thresholds) !== JSON.stringify(record.definition.thresholds);
      if (await runFinance((db) => saveBudget(db, definition, record?.version ?? null), baseline ? definition.id : undefined)) done();
    } catch { setError('Check the name, nonnegative exact amount, complete dates, period length/closing day and unique thresholds from 1 to 100. A next period must start at the current period’s end.'); }
  }
  return <Card>
    <Copy>{record ? 'Edit budget' : 'New spending budget'}</Copy>
    <Field label="Budget name (no full account/card numbers)" value={name} onChangeText={setName} />
    {!record ? <>
      <Choices label="Budget scope" value={scope} options={[{ value: 'card', label: 'One card' }, { value: 'overall', label: 'All accounts' }, { value: 'category', label: 'One category' }]} onChange={(value) => { setScope(value); if (value === 'card' && kind === 'weekly') setKind('monthly'); if (value !== 'card' && kind === 'billing') setKind('monthly'); }} />
      {scope === 'card' ? <Choices label="Credit card" value={selectedCard?.id ?? ''} onChange={setScopeId} options={cards.map((account) => ({ value: account.id, label: `${account.name} (${account.currency})` }))} /> : null}
      {scope === 'category' ? <Choices label="Category" value={selectedCategory} onChange={setScopeId} options={DEFAULT_CATEGORIES.map((item) => ({ value: item.id, label: item.name }))} /> : null}
      {scope !== 'card' ? <Choices<CurrencyCode> label="Currency (no automatic conversion)" value={currency} onChange={setCurrency} options={SUPPORTED_CURRENCIES.map((value) => ({ value, label: value }))} /> : null}
    </> : <Copy>Scope, currency and financial timezone are preserved. Allowance, cadence and rollover changes start next period; threshold changes are prospective.</Copy>}
    {canSchedule ? <>
      <Field label={`Base allowance (${effectiveCurrency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Choices<BudgetPeriodRule['kind']> label="Period" value={kind} onChange={setKind} options={[
        { value: 'monthly', label: 'Calendar month' }, ...(scope === 'card' ? [{ value: 'billing' as const, label: 'Billing cycle' }] : [{ value: 'weekly' as const, label: 'Monday week' }]),
        { value: 'repeating', label: 'Repeating days' }, { value: 'one-off', label: 'One-off dates' },
      ]} />
      {kind === 'billing' ? <Field label="Closing day for this budget (1–31)" value={closing} onChangeText={setClosing} keyboardType="number-pad" /> : null}
      {!record ? <Field label="Start / activation date (YYYY-MM-DD)" value={start} onChangeText={setStart} /> : <Copy>Changes start: {active?.end ?? 'No active period'}. A shorter transition is prorated, rounded down to minor units.</Copy>}
      {kind === 'repeating' ? <Field label="Calendar days per period" value={days} onChangeText={setDays} keyboardType="number-pad" /> : null}
      {kind === 'one-off' ? <Field label="Last included date (YYYY-MM-DD)" value={end} onChangeText={setEnd} /> : <Choices label="Unused allowance rollover (capped at next base)" value={rollover ? 'on' : 'off'} onChange={(value) => setRollover(value === 'on')} options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]} />}
      <Copy>{preview || 'Enter valid dates to preview the period.'}</Copy>
      {previewAllowance ? <Copy>Preview base allowance: {previewAllowance}. Incoming rollover is determined when the period is issued.</Copy> : null}
      {!record && kind !== 'one-off' && kind !== 'repeating' ? <Copy>The whole current period receives the full allowance, including spending already entered.</Copy> : null}
    </> : <Copy>No next period is available. You can change the name or thresholds.</Copy>}
    <Field label="Threshold percentages, comma separated (empty disables)" value={thresholds} onChangeText={setThresholds} keyboardType="numbers-and-punctuation" />
    {error ? <Copy>{error}</Copy> : null}
    <Button label={record ? 'Save prospective changes' : 'Create budget'} onPress={() => void save()} />
    <Button label="Cancel" onPress={done} />
  </Card>;
}
