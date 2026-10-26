import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const harness = join(root, 'test', 'sw-harness.js');

function runHarness(stateFile, command) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [harness, stateFile, command], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`harness timed out\n${stderr}`));
    }, 15000);
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`harness ${command} exited ${code}\n${stderr}\n${stdout}`));
        return;
      }
      readFile(`${stateFile}.result`, 'utf8').then(
        text => resolve(JSON.parse(text)),
        error => reject(error)
      );
    });
  });
}

async function withState(initial, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'tab-limiter-'));
  const stateFile = join(dir, 'state.json');
  await writeFile(stateFile, JSON.stringify(initial));
  try {
    return await fn(stateFile);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const baseState = {
  storage: {
    sync: {
      config: {
        active: true,
        tabLimit: 3,
        tabsQueueLength: 10,
        adaptiveLimit: false,
        badgeMode: 'hidden',
        autoMove: { enabled: false, direction: 'left', delay: 3000 }
      }
    },
    local: {},
    session: {}
  },
  windows: [{ id: 1, type: 'normal', focused: true, width: 1280, height: 800 }],
  tabs: [],
  nextTabId: 1,
  nextWindowId: 2
};

test('service worker entry hides and restores without onInstalled, including after restart', async () => {
  await withState(baseState, async stateFile => {
    const first = await runHarness(stateFile, 'overflow');
    assert.equal(first.installedInvocations, 0);
    assert.ok(first.listeners.created >= 1);
    assert.ok(first.listeners.removed >= 1);
    assert.ok(first.listeners.alarms >= 1);
    assert.equal(first.open.length, 3);
    assert.equal(first.hidden.length, 1);
    assert.equal(first.hidden[0].url, 'https://example.com/0');
    assert.equal(first.hidden[0].windowId, 1);

    const second = await runHarness(stateFile, 'close-one');
    assert.equal(second.installedInvocations, 0);
    assert.equal(second.open.length, 3);
    assert.ok(second.open.some(tab => tab.url === 'https://example.com/0' && tab.windowId === 1));
    assert.equal(second.hidden.length, 0);
  });
});

test('a restarted worker still redistributes a closed window queue', async () => {
  const initial = {
    ...baseState,
    windows: [
      { id: 1, type: 'normal', focused: false, width: 1280, height: 800 },
      { id: 2, type: 'normal', focused: true, width: 1280, height: 800 }
    ],
    tabs: [
      { id: 1, windowId: 1, url: 'https://w1.example/1', active: true, index: 0, pinned: false },
      { id: 2, windowId: 1, url: 'https://w1.example/2', active: false, index: 1, pinned: false },
      { id: 3, windowId: 1, url: 'https://w1.example/3', active: false, index: 2, pinned: false },
      { id: 10, windowId: 2, url: 'https://other.example/', active: true, index: 0, pinned: false }
    ],
    storage: {
      ...baseState.storage,
      local: {
        hiddenTabs: [
          { id: 'queued', url: 'https://queued.example/', title: 'Queued', windowId: 1, hiddenAt: 5 }
        ]
      }
    },
    nextTabId: 11,
    nextWindowId: 3,
    closeWindowId: 1
  };

  await withState(initial, async stateFile => {
    const result = await runHarness(stateFile, 'close-window');
    assert.equal(result.installedInvocations, 0);
    assert.equal(result.hidden.length, 0);
    assert.ok(result.open.some(tab => tab.url === 'https://queued.example/' && tab.windowId === 2));
  });
});
