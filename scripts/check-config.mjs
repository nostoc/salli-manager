import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [require.resolve('expo/bin/cli'), 'config', '--type', 'public', '--json'],
  {
    encoding: 'utf8',
    env: { ...process.env, APP_VARIANT: 'release', EXPO_NO_TELEMETRY: '1' },
  },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const config = JSON.parse(result.stdout);
assert.deepEqual(config.platforms, ['android']);
assert.equal(config.android.allowBackup, false);
assert.equal(config.updates.enabled, false);
assert.equal(config.updates.checkAutomatically, 'NEVER');
assert.ok(config.android.blockedPermissions.includes('android.permission.INTERNET'));
assert.deepEqual(config.android.permissions, []);
assert.equal(config.android.package, 'org.sallimanager.app');
assert.equal(config.runtimeVersion, undefined);
assert.equal(config.updates.url, undefined);
const sqlitePlugin = config.plugins.find((entry) => Array.isArray(entry) && entry[0] === 'expo-sqlite');
assert.equal(sqlitePlugin?.[1]?.useSQLCipher, true, 'SQLCipher must be compiled into Android builds.');
process.stdout.write('Release config checks passed. Final merged-manifest verification is still required.\n');
