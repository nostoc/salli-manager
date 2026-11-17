import { useState } from 'react';
import { addCalendarDays } from '@/core/dates/calendarMath';
import { formatMoney, SUPPORTED_CURRENCIES, type Money } from '@/core/money/money';
import { saveBudget } from '@/core/database/financeRepository';
import { refreshFinance, runFinance, useFinance } from '@/core/security/financeSession';
import { Button, Card, Copy, FinanceScreen } from '@/ui/FinanceScreen';
import { archiveBudget } from './domain/budget';
import { BudgetForm } from './BudgetForm';

const display = (money: Money) => `${money.currency} ${formatMoney(money)}`;

export function BudgetsScreen() {
  const snapshot = useFinance((state) => state.snapshot);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const selected = snapshot?.budgets.find((record) => record.definition.id === selectedId);
  return <FinanceScreen title="Spending budgets">
    <Copy>Card, category and overall budgets are parallel guardrails. Their totals overlap. Repayments never reset spending.</Copy>
    <Button label="Refresh periods and spending" onPress={() => void refreshFinance()} />
    {!selected && !creating ? <Button label="Create budget" onPress={() => setCreating(true)} /> : null}
    {creating ? <BudgetForm done={() => setCreating(false)} /> : null}
    {selected ? <>
      <Button label="Back to overview" onPress={() => { setSelectedId(null); setEditing(false); }} />
      <Copy>{selected.definition.name} · {selected.definition.currency} · {selected.definition.timeZone}{selected.definition.archived ? ' · Archived' : ''}</Copy>
      {selected.refresh.catchUpPending ? <Copy>History is catching up in bounded batches. Refresh again before relying on a current allowance.</Copy> : null}
      {!selected.definition.archived && !selected.refresh.catchUpPending ? <Button label={editing ? 'Cancel editing' : 'Edit budget'} onPress={() => setEditing(!editing)} /> : null}
      {editing ? <BudgetForm key={selected.version} record={selected} done={() => setEditing(false)} /> : null}
      {selected.definition.revisions.length > 1 ? <Copy>Latest revision effective from {selected.definition.revisions[selected.definition.revisions.length - 1]?.effectiveFrom}. Issued history is preserved.</Copy> : null}
      {!selected.refresh.periods.length ? <Copy>Upcoming budget. Its first period has not started; no allowance has been issued yet.</Copy> : null}
      {[...selected.refresh.summaries].reverse().map(({ period, usage, correction }) => <Card key={period.id}>
        <Copy>{period.start} through {addCalendarDays(period.end, -1)} · {usage.state}</Copy>
        <Copy>Base {display(period.baseAllowance)} · Incoming rollover {display(period.rollover)}</Copy>
        <Copy>Issued allowance {display(period.allowance)}</Copy>
        <Copy>Posted {display(usage.posted)} · Pending {display(usage.pending)} · Refunds {display(usage.refunds)}</Copy>
        <Copy>Used {display(usage.used)} · Remaining {display(usage.remaining)}</Copy>
        <Copy>Overspending {display(usage.overspending)} · Daily allowance {usage.dailyAllowance ? display(usage.dailyAllowance) : 'Not active'}</Copy>
        <Copy>Utilization {usage.utilizationPercent === null ? 'No percentage for zero allowance' : `${usage.utilizationPercent}%`}</Copy>
        {correction && (correction.usageDifference.minorUnits !== 0 || correction.rolloverDifference.minorUnits !== 0) ? <Copy>Late correction: previous usage changed by {display(correction.usageDifference)}. Recalculated carry differs by {display(correction.rolloverDifference)}. Issued rollover stays unchanged.</Copy> : null}
      </Card>)}
      {!selected.definition.archived ? <Button label="Archive budget (keep history)" onPress={() => void runFinance((db) => saveBudget(db, archiveBudget(selected.definition), selected.version))} /> : null}
    </> : !creating ? SUPPORTED_CURRENCIES.map((currency) => {
      const records = snapshot?.budgets.filter((record) => record.definition.currency === currency) ?? [];
      if (!records.length) return null;
      return <Card key={currency}><Copy>{currency} budgets</Copy>{records.map((record) => {
        const current = record.refresh.summaries.find((item) => item.usage.state === 'active');
        return <Card key={record.definition.id}>
          <Copy>{record.definition.name} · {record.definition.scope.kind}{record.definition.archived ? ' · Archived' : ''}</Copy>
          <Copy>{record.refresh.catchUpPending ? 'Catching up: refresh again' : current ? `Used ${display(current.usage.used)} · Remaining ${display(current.usage.remaining)}` : record.refresh.periods.length ? 'Ended / archived history' : 'Upcoming'}</Copy>
          <Button label={`View ${record.definition.name}`} onPress={() => setSelectedId(record.definition.id)} />
        </Card>;
      })}</Card>;
    }) : null}
    {!snapshot?.budgets.length && !creating ? <Copy>Create a personal allowance for a card, all accounts, or a category. A bank credit limit is never required.</Copy> : null}
  </FinanceScreen>;
}
