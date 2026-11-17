import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const development = process.env.APP_VARIANT === 'development';

  return {
    ...config,
    name: development ? 'Salli Manager Dev' : 'Salli Manager',
    slug: 'salli-manager',
    version: '0.1.0',
    scheme: 'salli-manager',
    platforms: ['android'],
    userInterfaceStyle: 'automatic',
    updates: { enabled: false, checkAutomatically: 'NEVER' },
    android: {
      package: development ? 'org.sallimanager.app.dev' : 'org.sallimanager.app',
      allowBackup: false,
      permissions: [],
      blockedPermissions: [
        ...(!development ? ['android.permission.INTERNET'] : []),
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.RECORD_AUDIO',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.VIBRATE',
      ],
    },
    plugins: ['expo-router', ['expo-sqlite', { useSQLCipher: true, enableFTS: false }], './plugins/withPrivateBackup.cjs'],
  };
};
