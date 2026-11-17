import '../../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { VaultGate } from '@/core/security/VaultGate';
import { useFinance } from '@/core/security/financeSession';

export default function RootLayout() {
  const unlocked = useFinance((state) => state.status === 'unlocked');
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <VaultGate>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={unlocked}><Stack.Screen name="(tabs)" /><Stack.Screen name="sms" /></Stack.Protected>
          <Stack.Protected guard={!unlocked}><Stack.Screen name="lock" /></Stack.Protected>
        </Stack>
      </VaultGate>
    </SafeAreaProvider>
  );
}
