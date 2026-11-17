import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { AndroidConfig, XML } = require('expo/config-plugins');
const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('Pass the generated merged release AndroidManifest.xml path.');

const { manifest } = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
assert.equal(manifest.$.package, 'org.sallimanager.app', 'Expected the release application ID.');

const permissions = [
  ...(manifest['uses-permission'] ?? []),
  ...(manifest['uses-permission-sdk-23'] ?? []),
].map((entry) => entry.$['android:name']);
assert.ok(!permissions.includes('android.permission.INTERNET'), 'Offline releases must omit INTERNET.');
assert.ok(permissions.includes('android.permission.USE_BIOMETRIC'), 'The authenticated native vault must declare biometric access.');
const privateReceiverPermission = `${manifest.$.package}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`;
if (permissions.includes(privateReceiverPermission)) {
  const declaration = (manifest.permission ?? []).find(
    (entry) => entry.$['android:name'] === privateReceiverPermission,
  );
  assert.equal(declaration?.$['android:protectionLevel'], 'signature');
}
assert.deepEqual(
  permissions.filter((name) => name !== privateReceiverPermission && ![
    'android.permission.USE_BIOMETRIC', 'android.permission.RECEIVE_SMS', 'android.permission.READ_SMS',
    'android.permission.WAKE_LOCK', 'android.permission.RECEIVE_BOOT_COMPLETED',
  ].includes(name)),
  [],
  'Only authentication, opt-in SMS and WorkManager wake/reboot infrastructure permissions are expected.',
);

const [application] = manifest.application ?? [];
assert.ok(application, 'Missing application declaration.');
for (const name of ['android.permission.RECEIVE_SMS', 'android.permission.READ_SMS']) assert.ok(permissions.includes(name), `Missing ${name}`);
const smsReceiver = application.receiver?.find((entry) => entry.$['android:name'] === 'org.sallimanager.vault.BankSmsReceiver');
assert.equal(smsReceiver?.$['android:permission'], 'android.permission.BROADCAST_SMS');
assert.equal(smsReceiver?.$['android:enabled'], 'false', 'SMS capture must be disabled before explicit opt-in.');
assert.equal(smsReceiver?.$['android:exported'], 'true');
assert.ok(!application.service?.some((entry) => entry.$['android:name'] === 'androidx.work.impl.foreground.SystemForegroundService'));
assert.equal(application.$['android:allowBackup'], 'false');
assert.equal(application.$['android:fullBackupContent'], '@xml/salli_backup_rules');
assert.equal(application.$['android:dataExtractionRules'], '@xml/salli_data_extraction_rules');
assert.notEqual(application.$['android:debuggable'], 'true');
const legacyRules = await XML.parseXMLAsync(await readFile(new URL('../android/app/src/main/res/xml/salli_backup_rules.xml', import.meta.url), 'utf8'));
const extractionRules = await XML.parseXMLAsync(await readFile(new URL('../android/app/src/main/res/xml/salli_data_extraction_rules.xml', import.meta.url), 'utf8'));
const modern = extractionRules['data-extraction-rules'];
for (const rules of [legacyRules['full-backup-content'], modern['cloud-backup'][0], modern['device-transfer'][0]]) {
  const exclusions = new Map((rules.exclude ?? []).map((entry) => [entry.$.domain, entry.$.path]));
  for (const domain of ['root', 'file', 'database', 'sharedpref', 'external', 'device_root', 'device_file', 'device_database', 'device_sharedpref']) {
    assert.equal(exclusions.get(domain), '.', `Missing ${domain} backup/transfer exclusion.`);
  }
}

const metadata = new Map(
  (application['meta-data'] ?? []).map((entry) => [entry.$['android:name'], entry.$['android:value']]),
);
assert.equal(metadata.get('expo.modules.updates.ENABLED'), 'false');
assert.equal(metadata.get('expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH'), 'NEVER');
process.stdout.write('Merged release manifest privacy checks passed. Runtime offline tests are still required.\n');
