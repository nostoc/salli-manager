import { useCallback, type PropsWithChildren } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { recordInteraction, refreshFinance, useFinance } from '@/core/security/financeSession';

export function FinanceScreen({ title, children }: PropsWithChildren<{ title: string }>) {
  const { error, busy } = useFinance();
  useFocusEffect(useCallback(() => { void refreshFinance(); }, []));
  return <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-slate-50 dark:bg-slate-950">
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="grow gap-4 px-6 py-6">
      <Text accessibilityRole="header" className="text-3xl font-bold text-slate-950 dark:text-slate-50">{title}</Text>
      {error ? <Text accessibilityLiveRegion="polite" className="text-base text-red-700 dark:text-red-300">{error}</Text> : null}
      {busy ? <Text accessibilityLiveRegion="polite" className="text-base text-slate-600 dark:text-slate-300">Saving or refreshing…</Text> : null}
      {children}
    </ScrollView>
  </SafeAreaView>;
}
export function Copy({ children }: PropsWithChildren) { return <Text className="text-base leading-7 text-slate-800 dark:text-slate-200">{children}</Text>; }
export function Card({ children }: PropsWithChildren) { return <View className="gap-3 rounded-xl border border-slate-300 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">{children}</View>; }
export function Button({ label, onPress, disabled = false }: { label: string; onPress(): void; disabled?: boolean }) {
  const busy = useFinance((state) => state.busy);
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy} onPress={() => { recordInteraction(); onPress(); }} className="rounded-xl bg-emerald-800 px-4 py-3 disabled:opacity-50"><Text className="text-center text-base font-semibold text-white">{label}</Text></Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View className="gap-1"><Copy>{label}</Copy><TextInput accessibilityLabel={label} autoCorrect={false} maxLength={80} {...props} onChangeText={(text) => { recordInteraction(); props.onChangeText?.(text); }} className="rounded-lg border border-slate-400 bg-white px-3 py-3 text-base text-slate-950 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></View>;
}
export function Choices<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly Readonly<{ value: T; label: string }>[]; onChange(value: T): void }) {
  return <View className="gap-2"><Copy>{label}</Copy><View className="flex-row flex-wrap gap-2">{options.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: value === option.value }} onPress={() => { recordInteraction(); onChange(option.value); }} className={value === option.value ? 'rounded-lg bg-emerald-800 p-3' : 'rounded-lg bg-slate-200 p-3 dark:bg-slate-700'}><Text className={value === option.value ? 'text-base text-white' : 'text-base text-slate-950 dark:text-slate-100'}>{option.label}</Text></Pressable>)}</View></View>;
}
