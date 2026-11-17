import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type FoundationScreenProps = {
  title: string;
  description: string;
};

export function FoundationScreen({ title, description }: FoundationScreenProps) {
  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-slate-50 dark:bg-slate-950">
      <ScrollView contentContainerClassName="grow px-6 py-8">
        <Text className="text-sm font-semibold tracking-wide text-emerald-800 dark:text-emerald-300">
          SALLI MANAGER
        </Text>
        <Text accessibilityRole="header" className="mt-3 text-3xl font-bold text-slate-950 dark:text-slate-50">
          {title}
        </Text>
        <Text className="mt-4 text-base leading-7 text-slate-700 dark:text-slate-300">
          {description}
        </Text>
        <View className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <Text accessibilityRole="header" className="text-lg font-semibold text-slate-950 dark:text-slate-50">
            Foundation build
          </Text>
          <Text className="mt-2 text-base leading-7 text-slate-700 dark:text-slate-300">
            Navigation is ready to explore. Financial features are being built in stages.
            This build does not collect SMS or store financial records.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
