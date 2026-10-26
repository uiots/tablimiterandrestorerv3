// Fresh process == fresh service worker. State is passed in a snapshot file
// so a second invocation can prove listeners exist without onInstalled.
import { readFileSync, writeFileSync } from 'node:fs';
import { createChromeMock } from './mock-chrome.js';

const stateFile = process.argv[2];
const command = process.argv[3];
const snapshot = JSON.parse(readFileSync(stateFile, 'utf8'));
const chrome = createChromeMock(snapshot);
globalThis.chrome = chrome;

const background = await import('../src/background/background.js');
await background.whenIdle();

if (command === 'overflow') {
  const win = (await chrome.windows.getAll())[0];
  for (let index = 0; index < 4; index += 1) {
    await chrome.tabs.create({
      windowId: win.id,
      url: `https://example.com/${index}`,
      active: index === 3
    });
    // Drain before the next create so this matches a person opening tabs,
    // not a single burst that interleaves with in-flight storage reads.
    await background.whenIdle();
  }
}

if (command === 'close-one') {
  const tabs = await chrome.tabs.query({});
  const victim = tabs.slice().sort((a, b) => a.id - b.id)[0];
  await chrome.tabs.remove(victim.id);
  await background.whenIdle();
}

if (command === 'close-window') {
  const windows = await chrome.windows.getAll();
  const closing = windows.find(win => win.id === snapshot.closeWindowId);
  chrome._test.closeWindow(closing.id);
  await background.whenIdle();
}

const hiddenStored = await chrome.storage.local.get('hiddenTabs');
const hiddenTabs = hiddenStored.hiddenTabs || [];
const openTabs = await chrome.tabs.query({});
writeFileSync(stateFile, JSON.stringify(chrome._test.snapshot()));

const installed = chrome.runtime.onInstalled;
const result = {
  command,
  open: openTabs.map(tab => ({ id: tab.id, windowId: tab.windowId, url: tab.url })),
  hidden: hiddenTabs.map(tab => ({ id: tab.id, windowId: tab.windowId, url: tab.url })),
  listeners: {
    created: chrome._test.listenerCount('tabs.onCreated'),
    removed: chrome._test.listenerCount('tabs.onRemoved'),
    windowRemoved: chrome._test.listenerCount('windows.onRemoved'),
    alarms: chrome._test.listenerCount('alarms.onAlarm')
  },
  installedInvocations: installed && chrome._test.invocations.onInstalled
};
writeFileSync(`${stateFile}.result`, JSON.stringify(result));
