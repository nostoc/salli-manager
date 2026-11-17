import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const [variant, ...args] = process.argv.slice(2);
if (variant !== 'development' && variant !== 'release') {
  throw new Error('Select the development or release build variant.');
}
process.env.APP_VARIANT = variant;
process.env.EXPO_NO_TELEMETRY = '1';
const cli = require.resolve('expo/bin/cli');
process.argv = [process.execPath, cli, ...args];
// Run Expo in this process so its terminal, signals and exit handling stay
// attached to the caller instead of sitting behind a synchronous child process.
require(cli);
