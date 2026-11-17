import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { runSecurityProbe } from './securityProbe';
import { nativeVault, VaultError } from './nativeVault';

export function SecurityProbeScreen() {
  const [status, setStatus] = useState('Ready for a synthetic storage and authentication check.');
  const [busy, setBusy] = useState(false);
  async function check(credentialOnly: boolean) {
    setBusy(true);
    setStatus('Complete the Android authentication prompt on this device.');
    try {
      await runSecurityProbe(credentialOnly);
      setStatus('PASS: authenticated key access, encrypted file header, correct-key reopen, wrong-key rejection, no-key rejection and ordinary Android SQLite rejection.');
    } catch (error) {
      setStatus(error instanceof VaultError && error.code === 'NATIVE_MODULE_MISSING'
        ? 'Open Salli Manager Dev. Expo Go does not contain the native Keystore module or SQLCipher build.'
        : 'Vault remains locked. Authentication was cancelled or a native security check failed. No financial data was stored.');
    } finally { setBusy(false); }
  }
  async function checkLockedKey() {
    setBusy(true);
    try {
      setStatus(await nativeVault().checkAuthorizationAsync()
        ? 'PASS: Android Keystore refused key decryption without fresh authentication.'
        : 'Key authorization is still active. Wait at least 6 seconds without unlocking the device, then try again.');
    } catch { setStatus('Key check unavailable. Run an authenticated storage check first.'); }
    finally { setBusy(false); }
  }
  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-slate-50 dark:bg-slate-950">
      <ScrollView contentContainerClassName="grow px-6 py-8">
        <Text accessibilityRole="header" className="text-3xl font-bold text-slate-950 dark:text-slate-50">Security prerequisite</Text>
        <Text className="mt-4 text-base leading-7 text-slate-700 dark:text-slate-300">
          Development check using a disposable synthetic record. Financial entry remains unavailable while native security is being verified.
          This is your Android screen lock, never a banking PIN.
        </Text>
        <View className="mt-6 gap-4">
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void check(false)} className="rounded-xl bg-emerald-800 p-4">
            <Text className="text-center text-base font-semibold text-white">Test biometric or device unlock</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void check(true)} className="rounded-xl bg-slate-700 p-4">
            <Text className="text-center text-base font-semibold text-white">Test device credential fallback</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void checkLockedKey()} className="rounded-xl bg-slate-700 p-4">
            <Text className="text-center text-base font-semibold text-white">Check Keystore lock after 6 seconds</Text>
          </Pressable>
          <Text accessibilityLiveRegion="polite" className="text-base leading-7 text-slate-950 dark:text-slate-50">{status}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
