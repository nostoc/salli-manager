import { formatMoney } from '@/core/money/money';
import { projectLedger } from '@/features/transactions/domain/ledger';
import { refreshFinance, runFinance, useFinance } from '@/core/security/financeSession';
import { Button, Card, Copy, FinanceScreen } from '@/ui/FinanceScreen';

export default function HomeScreen() {
  const snapshot = useFinance((state) => state.snapshot);
  const projection = snapshot ? projectLedger(snapshot.accounts, snapshot.entries) : null;
  return <FinanceScreen title="Your finances">
    <Copy>Calculated from your entered records. Each currency is shown separately; no exchange rate or bank completeness is assumed.</Copy>
    <Button label="Refresh" onPress={() => void refreshFinance()} />
    {projection?.totals.map((total) => <Card key={total.currency}>
      <Copy>{total.currency} · Entered income {formatMoney(total.income)} · Entered expenses {formatMoney(total.expenses)}</Copy>
      <Copy>Calculated net worth {total.currency} {formatMoney(total.netWorth)}</Copy>
    </Card>)}
    {!snapshot?.accounts.length ? <Copy>Start in Accounts, add a manual entry in Transactions, then create a personal spending allowance in Budgets.</Copy> : null}
    {snapshot?.signals.map((signal) => <Card key={`${signal.periodId}:${signal.highest}`}>
      <Copy>{snapshot.budgets.find((record) => record.definition.id === signal.budgetId)?.definition.name ?? 'Budget'} reached {signal.highest}% · {signal.date}</Copy>
      <Copy>New thresholds: {signal.thresholds.map((threshold) => `${threshold}%`).join(', ')}. Repayments do not reset this allowance.</Copy>
      <Button label="Dismiss alert" onPress={() => void runFinance(async (db) => { await db.runAsync('UPDATE budget_signals SET acknowledged=1 WHERE id=?', `${signal.periodId}:${signal.highest}`); })} />
    </Card>)}
  </FinanceScreen>;
}
