import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const [variant, ...args] = process.argv.slice(2);
if (variant !== 'development' && variant !== 'release') {
  throw new Error('Select the development or release build variant.');
}
const result = spawnSync(
  process.execPath,
  [require.resolve('expo/bin/cli'), ...args],
  {
    stdio: 'inherit',
    env: { ...process.env, APP_VARIANT: variant, EXPO_NO_TELEMETRY: '1' },
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
