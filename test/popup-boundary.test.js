import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('popup does not import the service worker and manifest is 2.0.2 with alarms', () => {
  const popup = readFileSync(join(root, 'src/popup/popup.js'), 'utf8');
  const background = readFileSync(join(root, 'src/background/background.js'), 'utf8');
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

  assert.equal(popup.includes('background/background.js'), false);
  assert.equal(popup.includes('background/controller.js'), false);
  assert.match(popup, /shared\/tab-state\.js/);
  assert.match(background, /tabs\.onCreated\.addListener/);
  assert.match(background, /alarms\.onAlarm\.addListener/);
  assert.equal(/function initialize\(/.test(background), false);

  assert.equal(manifest.version, '2.0.2');
  assert.ok(manifest.permissions.includes('alarms'));
  assert.ok(manifest.permissions.includes('storage'));
  assert.equal(manifest.background.service_worker, 'src/background/background.js');
});
