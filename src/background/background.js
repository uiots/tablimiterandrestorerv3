// MV3 service worker entry. Chrome re-runs this file after every idle kill.
// Listeners have to be registered during that evaluation. onInstalled does
// not fire on a restart, so registration must not live inside it.

import { TabController } from './controller.js';

const chrome = globalThis.chrome;

if (!chrome?.tabs || !chrome?.runtime || !chrome?.windows || !chrome?.storage || !chrome?.alarms) {
  throw new Error('Tab Limiter service worker requires the chrome extension APIs');
}

const controller = new TabController(chrome);

function guard(work) {
  return Promise.resolve(work).catch(error => {
    console.error('[tab-limiter]', error);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  guard(controller.bootstrap());
});

chrome.runtime.onStartup.addListener(() => {
  guard(controller.bootstrap());
});

chrome.tabs.onCreated.addListener(tab => {
  guard(controller.handleTabCreated(tab));
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  guard(controller.handleTabRemoved(tabId, removeInfo));
});

chrome.tabs.onActivated.addListener(activeInfo => {
  guard(controller.handleTabActivated(activeInfo));
});

chrome.windows.onCreated.addListener(win => {
  guard(controller.handleWindowCreated(win));
});

chrome.windows.onRemoved.addListener(windowId => {
  guard(controller.handleWindowRemoved(windowId));
});

chrome.windows.onFocusChanged.addListener(windowId => {
  guard(controller.handleWindowFocusChanged(windowId));
});

chrome.windows.onBoundsChanged.addListener(win => {
  guard(controller.handleWindowBoundsChanged(win));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  guard(controller.handleStorageChanged(changes, areaName));
});

chrome.alarms.onAlarm.addListener(alarm => {
  guard(controller.handleAlarm(alarm));
});

// Load storage and reconcile open windows on every worker start.
guard(controller.bootstrap());

export function whenIdle() {
  return controller.whenIdle();
}
