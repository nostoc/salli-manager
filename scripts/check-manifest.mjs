import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AndroidConfig } = require('expo/config-plugins');
const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('Pass the generated merged release AndroidManifest.xml path.');

const { manifest } = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
assert.equal(manifest.$.package, 'org.sallimanager.app', 'Expected the release application ID.');

const permissions = [
  ...(manifest['uses-permission'] ?? []),
  ...(manifest['uses-permission-sdk-23'] ?? []),
].map((entry) => entry.$['android:name']);
assert.ok(!permissions.includes('android.permission.INTERNET'), 'Offline releases must omit INTERNET.');
const privateReceiverPermission = `${manifest.$.package}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`;
if (permissions.includes(privateReceiverPermission)) {
  const declaration = (manifest.permission ?? []).find(
    (entry) => entry.$['android:name'] === privateReceiverPermission,
  );
  assert.equal(declaration?.$['android:protectionLevel'], 'signature');
}
assert.deepEqual(
  permissions.filter((name) => name !== privateReceiverPermission),
  [],
  'Only the AndroidX private-receiver signature permission is expected in this foundation.',
);

const [application] = manifest.application ?? [];
assert.ok(application, 'Missing application declaration.');
assert.equal(application.$['android:allowBackup'], 'false');
assert.notEqual(application.$['android:debuggable'], 'true');

const metadata = new Map(
  (application['meta-data'] ?? []).map((entry) => [entry.$['android:name'], entry.$['android:value']]),
);
assert.equal(metadata.get('expo.modules.updates.ENABLED'), 'false');
assert.equal(metadata.get('expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH'), 'NEVER');
process.stdout.write('Merged release manifest privacy checks passed. Runtime offline tests are still required.\n');
