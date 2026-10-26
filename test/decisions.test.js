import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  effectiveLimit,
  isRestorableUrl,
  mergeConfig,
  orphanWindow,
  selectTabsToHide,
  selectTabsToRestore,
  trimQueue
} from '../src/shared/tab-state.js';

test('mergeConfig fills missing nested autoMove fields', () => {
  const merged = mergeConfig({ tabLimit: 5, autoMove: { delay: 1500 } });
  assert.equal(merged.tabLimit, 5);
  assert.equal(merged.active, DEFAULT_CONFIG.active);
  assert.equal(merged.autoMove.delay, 1500);
  assert.equal(merged.autoMove.enabled, true);
  assert.equal(merged.autoMove.direction, 'left');
});

test('mergeConfig tolerates empty and non-object input', () => {
  assert.deepEqual(mergeConfig(undefined).autoMove, DEFAULT_CONFIG.autoMove);
  assert.deepEqual(mergeConfig(null).autoMove, DEFAULT_CONFIG.autoMove);
  assert.equal(mergeConfig('nope').tabLimit, DEFAULT_CONFIG.tabLimit);
  const clamped = mergeConfig({ tabLimit: 0, tabsQueueLength: -4, badgeMode: 'nope', autoMove: { direction: 'up', delay: -1 } });
  assert.equal(clamped.tabLimit, DEFAULT_CONFIG.tabLimit);
  assert.equal(clamped.tabsQueueLength, DEFAULT_CONFIG.tabsQueueLength);
  assert.equal(clamped.badgeMode, DEFAULT_CONFIG.badgeMode);
  assert.equal(clamped.autoMove.direction, 'left');
  assert.equal(clamped.autoMove.delay, DEFAULT_CONFIG.autoMove.delay);
});

test('isRestorableUrl allows web pages and rejects privileged or empty urls', () => {
  assert.equal(isRestorableUrl('https://example.com/a'), true);
  assert.equal(isRestorableUrl('http://example.com'), true);
  assert.equal(isRestorableUrl('file:///tmp/a.html'), true);
  assert.equal(isRestorableUrl('about:blank'), true);
  assert.equal(isRestorableUrl('chrome://newtab/'), true);
  assert.equal(isRestorableUrl('chrome://new-tab-page/'), true);
  assert.equal(isRestorableUrl('chrome://settings/'), false);
  assert.equal(isRestorableUrl('chrome://extensions/'), false);
  assert.equal(isRestorableUrl('chrome-extension://abc/page.html'), false);
  assert.equal(isRestorableUrl('edge://settings'), false);
  assert.equal(isRestorableUrl('devtools://devtools/bundled/inspector.html'), false);
  assert.equal(isRestorableUrl('javascript:alert(1)'), false);
  assert.equal(isRestorableUrl(''), false);
  assert.equal(isRestorableUrl('   '), false);
  assert.equal(isRestorableUrl(undefined), false);
  assert.equal(isRestorableUrl(null), false);
});

test('effectiveLimit is per window and respects the fixed cap', () => {
  const adaptive = { ...DEFAULT_CONFIG, adaptiveLimit: true, tabLimit: 20, pixelsPerTab: 150 };
  assert.equal(effectiveLimit(adaptive, { width: 1200 }), 8);
  assert.equal(effectiveLimit(adaptive, { width: 400 }), 5);
  assert.equal(effectiveLimit({ ...adaptive, adaptiveLimit: false, tabLimit: 4 }, { width: 400 }), 4);
  assert.equal(effectiveLimit({ tabLimit: 6 }, null), 6);
});

test('selectTabsToHide picks the least recently used unpinned tabs', () => {
  const tabs = [
    { id: 1, index: 0, pinned: false },
    { id: 2, index: 1, pinned: true },
    { id: 3, index: 2, pinned: false },
    { id: 4, index: 3, pinned: false }
  ];
  const access = { 1: 30, 3: 10, 4: 10 };
  const hidden = selectTabsToHide(tabs, access, 2);
  assert.deepEqual(hidden.map(tab => tab.id), [3, 4]);
});

test('selectTabsToRestore stays inside the window until that window is gone', () => {
  const hidden = [
    { id: 'a', url: 'https://a.example', windowId: 1, hiddenAt: 1 },
    { id: 'b', url: 'https://b.example', windowId: 2, hiddenAt: 5 },
    { id: 'c', url: 'chrome://settings/', windowId: null, hiddenAt: 9 },
    { id: 'd', url: 'https://d.example', windowId: null, hiddenAt: 4 },
    { id: 'e', url: 'https://e.example', windowId: 1, hiddenAt: 8 }
  ];

  const ownOnly = selectTabsToRestore(hidden, 2, [1, 2], 1);
  assert.deepEqual(ownOnly.map(tab => tab.id), ['b']);

  const withOrphan = selectTabsToRestore(hidden, 2, [1, 2], 3);
  assert.deepEqual(withOrphan.map(tab => tab.id), ['b', 'd']);

  const forWindow1 = selectTabsToRestore(hidden, 1, [1, 2], 3);
  assert.deepEqual(forWindow1.map(tab => tab.id), ['e', 'a', 'd']);
});

test('orphanWindow releases a closed window and trimQueue keeps the newest entries', () => {
  const hidden = [
    { id: 'old', url: 'https://old.example', windowId: 7, hiddenAt: 1 },
    { id: 'new', url: 'https://new.example', windowId: 7, hiddenAt: 2 }
  ];
  const orphaned = orphanWindow(hidden, 7);
  assert.equal(orphaned.changed, true);
  assert.equal(orphaned.tabs[0].windowId, null);
  assert.deepEqual(trimQueue(orphaned.tabs, 1).map(tab => tab.id), ['new']);

  const restored = selectTabsToRestore(orphaned.tabs, 3, [3], 1);
  assert.equal(restored[0].id, 'new');
});
