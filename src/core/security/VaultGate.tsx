import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { lockFinance, unlockFinance, useFinance } from './financeSession';
import { nativeVault } from './nativeVault';
import { SecurityProbeScreen } from './SecurityProbeScreen';
import { drainSms } from '@/features/sms/smsSession';
import { nativeSms } from '@/features/sms/nativeSms';

const INACTIVITY_MS = 180_000;

export function VaultGate({ children }: PropsWithChildren) {
  const status = useFinance((state) => state.status);
  const lastInteraction = useFinance((state) => state.lastInteraction);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  function touch() {
    if (timeout.current) clearTimeout(timeout.current);
    if (useFinance.getState().status === 'unlocked') timeout.current = setTimeout(() => void lockFinance(), INACTIVITY_MS);
  }
  useEffect(() => {
    const lockOnLeave = () => {
      const current = useFinance.getState().status;
      if (current === 'unlocked' || current === 'opening') void lockFinance();
    };
    const appState = AppState.addEventListener('change', (next) => { if (next !== 'active') lockOnLeave(); });
    let nativeSubscription: { remove(): void } | undefined;
    try { nativeSubscription = nativeVault().addListener('onLock', lockOnLeave); } catch { /* Missing native build remains locked. */ }
    return () => { appState.remove(); nativeSubscription?.remove(); if (timeout.current) clearTimeout(timeout.current); void lockFinance(); };
  }, []);
  useEffect(() => { touch(); }, [status, lastInteraction]);
  useEffect(() => {
    if (status !== 'unlocked') return;
    void drainSms(true);
    const interval = setInterval(() => void drainSms(), 5000);
    let subscription: { remove(): void } | undefined;
    try { subscription = nativeSms().addListener('onInboxChanged', () => void drainSms()); } catch { /* Fail closed until rebuilt. */ }
    return () => { clearInterval(interval); subscription?.remove(); };
  }, [status]);
  return <View className="flex-1" onTouchStart={touch} onAccessibilityTap={touch}>{children}</View>;
}

export function LockedScreen() {
  const { status, error } = useFinance();
  const [probe, setProbe] = useState(false);
    if (__DEV__ && probe) return <View className="flex-1"><Pressable accessibilityRole="button" onPress={() => setProbe(false)} className="bg-slate-700 p-4"><Text className="text-center text-white">Back to locked vault</Text></Pressable><SecurityProbeScreen /></View>;
    const pending = status !== 'locked';
    return (
      <SafeAreaView className="flex-1 justify-center bg-slate-50 px-6 dark:bg-slate-950">
        <Text accessibilityRole="header" className="text-3xl font-bold text-slate-950 dark:text-slate-50">Salli Manager is locked</Text>
        <Text className="mt-4 text-base leading-7 text-slate-700 dark:text-slate-300">Unlock local encrypted data using your Android screen lock. Your banking PIN is never needed. Data stays on this device.</Text>
        <Pressable accessibilityRole="button" disabled={pending} accessibilityState={{ disabled: pending }} onPress={() => void unlockFinance(false)} className="mt-8 rounded-xl bg-emerald-800 p-4">
          <Text className="text-center text-base font-semibold text-white">{pending ? 'Unlocking…' : 'Unlock'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={pending} accessibilityState={{ disabled: pending }} onPress={() => void unlockFinance(true)} className="mt-4 rounded-xl bg-slate-700 p-4">
          <Text className="text-center text-base font-semibold text-white">Use device credential</Text>
        </Pressable>
        {error ? <Text accessibilityLiveRegion="polite" className="mt-6 text-base text-red-700 dark:text-red-300">{error}</Text> : null}
        {__DEV__ && !pending ? <Pressable accessibilityRole="button" onPress={() => setProbe(true)} className="mt-4 p-4"><Text className="text-center text-emerald-800 dark:text-emerald-300">Development security checks</Text></Pressable> : null}
      </SafeAreaView>
    );
}
