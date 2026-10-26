import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_MOVE_ALARM, TabController } from '../src/background/controller.js';
import { createChromeMock } from './mock-chrome.js';

function limitedChrome(extra = {}) {
  return createChromeMock({
    sync: {
      config: {
        active: true,
        tabLimit: 3,
        tabsQueueLength: 10,
        adaptiveLimit: false,
        autoMove: { enabled: false, direction: 'left', delay: 3000 },
        ...extra
      }
    }
  });
}

function wire(chrome, controller) {
  chrome.tabs.onCreated.addListener(tab => controller.handleTabCreated(tab));
  chrome.tabs.onRemoved.addListener((tabId, info) => controller.handleTabRemoved(tabId, info));
  chrome.tabs.onActivated.addListener(info => controller.handleTabActivated(info));
  chrome.windows.onCreated.addListener(win => controller.handleWindowCreated(win));
  chrome.windows.onRemoved.addListener(windowId => controller.handleWindowRemoved(windowId));
  chrome.windows.onFocusChanged.addListener(windowId => controller.handleWindowFocusChanged(windowId));
  chrome.storage.onChanged.addListener((changes, area) => controller.handleStorageChanged(changes, area));
  chrome.alarms.onAlarm.addListener(alarm => controller.handleAlarm(alarm));
}

async function hiddenUrls(chrome) {
  const { hiddenTabs = [] } = await chrome.storage.local.get('hiddenTabs');
  return hiddenTabs;
}

async function openTabs(chrome, windowId) {
  return chrome.tabs.query(windowId == null ? {} : { windowId });
}

async function boot(extra) {
  const chrome = limitedChrome(extra);
  const controller = new TabController(chrome);
  wire(chrome, controller);
  await controller.bootstrap();
  return { chrome, controller };
}

async function addTab(controller, props) {
  const tab = controller.chrome._test.addTab(props);
  await controller.whenIdle();
  return tab;
}

test('hide and restore stay inside the window that changed', async () => {
  const { chrome, controller } = await boot();
  const windowA = chrome._test.addWindow({ focused: true, width: 1000 });
  const windowB = chrome._test.addWindow({ focused: false, width: 1000 });
  await controller.whenIdle();

  for (let index = 0; index < 4; index += 1) {
    await addTab(controller, {
      windowId: windowA.id,
      url: `https://a.example/${index}`,
      active: index === 3
    });
  }
  await addTab(controller, { windowId: windowB.id, url: 'https://b.example/only', active: true });

  const openA = await openTabs(chrome, windowA.id);
  const openB = await openTabs(chrome, windowB.id);
  assert.equal(openA.length, 3);
  assert.equal(openB.length, 1);
  const queued = await hiddenUrls(chrome);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].windowId, windowA.id);
  assert.equal(queued[0].url, 'https://a.example/0');

  await chrome.tabs.remove(openA[0].id);
  await controller.whenIdle();

  const reopened = await openTabs(chrome, windowA.id);
  assert.equal(reopened.length, 3);
  assert.ok(reopened.some(tab => tab.url === 'https://a.example/0' && tab.windowId === windowA.id));
  assert.equal((await hiddenUrls(chrome)).length, 0);
  assert.equal((await openTabs(chrome, windowB.id)).length, 1);
});

test('a second controller restores after the first instance is discarded', async () => {
  const { chrome, controller: first } = await boot();
  const win = chrome._test.addWindow({ focused: true });
  await first.whenIdle();
  for (let index = 0; index < 4; index += 1) {
    await addTab(first, { windowId: win.id, url: `https://restart.example/${index}`, active: index === 3 });
  }
  assert.equal((await hiddenUrls(chrome)).length, 1);

  chrome._test.resetListeners();
  const second = new TabController(chrome);
  wire(chrome, second);
  await second.bootstrap();
  const open = await openTabs(chrome, win.id);
  assert.equal(open.length, 3, 'bootstrap must not require onInstalled to load the limit');

  await chrome.tabs.remove(open[0].id);
  await second.whenIdle();
  const after = await openTabs(chrome, win.id);
  assert.equal(after.length, 3);
  assert.ok(after.some(tab => tab.url === 'https://restart.example/0'));
  assert.equal((await hiddenUrls(chrome)).length, 0);
});

test('closing a full window does not trap its queue when another window has room', async () => {
  const { chrome, controller } = await boot();
  const crowded = chrome._test.addWindow({ focused: true });
  const spacious = chrome._test.addWindow({ focused: false });
  await controller.whenIdle();

  for (let index = 0; index < 4; index += 1) {
    await addTab(controller, { windowId: crowded.id, url: `https://gone.example/${index}`, active: index === 3 });
  }
  await addTab(controller, { windowId: spacious.id, url: 'https://stay.example/1', active: true });
  assert.equal((await hiddenUrls(chrome))[0].url, 'https://gone.example/0');

  chrome._test.closeWindow(crowded.id);
  await controller.whenIdle();

  const remaining = await openTabs(chrome, spacious.id);
  assert.ok(remaining.some(tab => tab.url === 'https://gone.example/0' && tab.windowId === spacious.id));
  assert.equal((await hiddenUrls(chrome)).length, 0);
});

test('a closed window queue waits when every other window is already full', async () => {
  const { chrome, controller } = await boot();
  const closing = chrome._test.addWindow({ focused: false });
  const full = chrome._test.addWindow({ focused: true });
  await controller.whenIdle();

  for (let index = 0; index < 4; index += 1) {
    await addTab(controller, { windowId: closing.id, url: `https://wait.example/${index}`, active: index === 3 });
  }
  for (let index = 0; index < 3; index += 1) {
    await addTab(controller, { windowId: full.id, url: `https://full.example/${index}`, active: index === 2 });
  }

  chrome._test.closeWindow(closing.id);
  await controller.whenIdle();

  const queued = await hiddenUrls(chrome);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].windowId, null);
  assert.equal(queued[0].url, 'https://wait.example/0');
  assert.equal((await openTabs(chrome, full.id)).length, 3);

  const open = await openTabs(chrome, full.id);
  await chrome.tabs.remove(open[0].id);
  await controller.whenIdle();

  const after = await openTabs(chrome, full.id);
  assert.equal(after.length, 3);
  assert.ok(after.some(tab => tab.url === 'https://wait.example/0' && tab.windowId === full.id));
  assert.equal((await hiddenUrls(chrome)).length, 0);
});

test('unrestorable urls are skipped and do not block a restorable tab', async () => {
  const { chrome, controller } = await boot({ tabLimit: 2 });
  const win = chrome._test.addWindow({ focused: true });
  await controller.whenIdle();
  await addTab(controller, { windowId: win.id, url: 'https://open.example/1', active: true });
  await addTab(controller, { windowId: win.id, url: 'https://open.example/2', active: false });

  await chrome.storage.local.set({
    hiddenTabs: [
      { id: 'bad', url: 'chrome://extensions/', title: 'Extensions', windowId: win.id, hiddenAt: 2 },
      { id: 'good', url: 'https://restore.example/page', title: 'Page', windowId: win.id, hiddenAt: 1 }
    ]
  });

  const open = await openTabs(chrome, win.id);
  await chrome.tabs.remove(open[0].id);
  await controller.whenIdle();

  const after = await openTabs(chrome, win.id);
  assert.equal(after.length, 2);
  assert.ok(after.some(tab => tab.url === 'https://restore.example/page'));
  assert.equal(after.some(tab => String(tab.url).startsWith('chrome://')), false);
  const queued = await hiddenUrls(chrome);
  assert.deepEqual(queued.map(tab => tab.url), ['chrome://extensions/']);
});

test('a tabs.create failure does not consume the only free slot', async () => {
  const { chrome, controller } = await boot({ tabLimit: 1 });
  const win = chrome._test.addWindow({ focused: true });
  await controller.whenIdle();
  await addTab(controller, { windowId: win.id, url: 'https://open.example/', active: true });

  const original = chrome.tabs.create.bind(chrome.tabs);
  chrome.tabs.create = async props => {
    if (String(props.url).includes('fail.example')) throw new Error('blocked');
    return original(props);
  };
  await chrome.storage.local.set({
    hiddenTabs: [
      { id: 'bad', url: 'https://fail.example/nope', title: 'Fail', windowId: win.id, hiddenAt: 2 },
      { id: 'good', url: 'https://ok.example/yes', title: 'Ok', windowId: win.id, hiddenAt: 1 }
    ]
  });

  const open = await openTabs(chrome, win.id);
  await chrome.tabs.remove(open[0].id);
  await controller.whenIdle();

  const after = await openTabs(chrome, win.id);
  assert.ok(after.some(tab => tab.url === 'https://ok.example/yes' && tab.windowId === win.id));
  const queued = await hiddenUrls(chrome);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].url, 'https://fail.example/nope');
  assert.ok(queued[0].restoreFailures >= 1);
});

test('storage config merges with defaults before it is applied', async () => {
  const { chrome, controller } = await boot();
  const win = chrome._test.addWindow({ focused: true, width: 1400 });
  await controller.whenIdle();
  for (let index = 0; index < 3; index += 1) {
    await addTab(controller, { windowId: win.id, url: `https://limit.example/${index}`, active: index === 2 });
  }
  assert.equal((await openTabs(chrome, win.id)).length, 3);

  await chrome.storage.sync.set({ config: { tabLimit: 2, active: true } });
  await controller.whenIdle();

  assert.equal(controller.config.tabLimit, 2);
  assert.equal(controller.config.autoMove.enabled, true);
  assert.equal(controller.config.autoMove.direction, 'left');
  assert.equal(controller.config.autoMove.delay, 3000);
  assert.equal(controller.config.pixelsPerTab, 150);
  assert.equal(controller.config.adaptiveLimit, true);
  assert.equal((await openTabs(chrome, win.id)).length, 2);
  assert.equal((await hiddenUrls(chrome)).length, 1);
});

test('auto-move survives a new controller via session storage and alarms', async () => {
  const { chrome, controller: first } = await boot({
    autoMove: { enabled: true, direction: 'left', delay: 45000 }
  });
  const win = chrome._test.addWindow({ focused: true });
  await first.whenIdle();
  const tab = await addTab(first, { windowId: win.id, url: 'https://move.example/', active: true });

  const stored = await chrome.storage.session.get('pendingAutoMove');
  assert.equal(stored.pendingAutoMove.tabId, tab.id);
  assert.ok(chrome._test.alarms.has(AUTO_MOVE_ALARM));

  stored.pendingAutoMove.dueAt = Date.now() - 5;
  await chrome.storage.session.set({ pendingAutoMove: stored.pendingAutoMove });

  chrome._test.resetListeners();
  const second = new TabController(chrome);
  await second.bootstrap();
  assert.equal(chrome._test.moved.length, 1);
  assert.equal(chrome._test.moved[0].id, tab.id);
  assert.equal(chrome._test.moved[0].index, 0);
  const cleared = await chrome.storage.session.get('pendingAutoMove');
  assert.equal(cleared.pendingAutoMove, undefined);
});

test('pinned tabs are not hidden and do not consume the limit', async () => {
  const { chrome, controller } = await boot({ tabLimit: 2 });
  const win = chrome._test.addWindow({ focused: true });
  await controller.whenIdle();
  await addTab(controller, { windowId: win.id, url: 'https://pin.example/', pinned: true, active: false });
  await addTab(controller, { windowId: win.id, url: 'https://free.example/1', active: true });
  await addTab(controller, { windowId: win.id, url: 'https://free.example/2', active: false });
  await addTab(controller, { windowId: win.id, url: 'https://free.example/3', active: false });

  const open = await openTabs(chrome, win.id);
  assert.equal(open.filter(tab => tab.pinned).length, 1);
  assert.equal(open.filter(tab => !tab.pinned).length, 2);
  assert.equal((await hiddenUrls(chrome)).length, 1);
  assert.equal((await hiddenUrls(chrome))[0].url, 'https://free.example/1');
});
