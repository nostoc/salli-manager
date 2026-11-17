import { lockFinance } from '@/core/security/financeSession';
import { Button, Copy, FinanceScreen } from '@/ui/FinanceScreen';
import { router } from 'expo-router';

export default function MoreScreen() {
  return <FinanceScreen title="Privacy and settings">
    <Copy>Financial data is stored locally in an encrypted database. The vault locks when the app is backgrounded and after three minutes without interaction. Screenshots and app previews are protected.</Copy>
    <Button label="Lock now" onPress={() => void lockFinance()} />
    <Button label="Bank SMS and import review" onPress={() => router.push('/sms')} />
    <Copy>Manual accounts, entries and budgets need no SMS permission. Statements, backups, reminders and advanced reports remain later features.</Copy>
    <Copy>Keep this development installation disposable. Portable encrypted backup and recovery are not implemented. Loss of the device credential or Keystore key can make local data inaccessible.</Copy>
  </FinanceScreen>;
}
