// Shared tab-limit helpers. No event listeners and no work at import time,
// so the popup can use this module without starting the service worker.

export const DEFAULT_CONFIG = {
  active: true,
  tabLimit: 20,
  tabsQueueLength: 80,
  badgeMode: 'open',
  adaptiveLimit: true,
  pixelsPerTab: 150,
  autoMove: {
    enabled: true,
    direction: 'left',
    delay: 3000
  }
};

const AUTO_MOVE_DEFAULTS = DEFAULT_CONFIG.autoMove;

export function mergeConfig(partial) {
  const source = partial && typeof partial === 'object' ? partial : {};
  const autoMoveSource = source.autoMove && typeof source.autoMove === 'object'
    ? source.autoMove
    : {};
  const merged = {
    ...DEFAULT_CONFIG,
    ...source,
    autoMove: {
      ...AUTO_MOVE_DEFAULTS,
      ...autoMoveSource
    }
  };

  merged.tabLimit = positiveInt(merged.tabLimit, DEFAULT_CONFIG.tabLimit);
  merged.tabsQueueLength = positiveInt(merged.tabsQueueLength, DEFAULT_CONFIG.tabsQueueLength);
  merged.pixelsPerTab = positiveInt(merged.pixelsPerTab, DEFAULT_CONFIG.pixelsPerTab);
  merged.adaptiveLimit = Boolean(merged.adaptiveLimit);
  merged.active = Boolean(merged.active);
  if (!['open', 'user', 'hidden'].includes(merged.badgeMode)) {
    merged.badgeMode = DEFAULT_CONFIG.badgeMode;
  }

  const delay = Number(merged.autoMove.delay);
  merged.autoMove.enabled = Boolean(merged.autoMove.enabled);
  merged.autoMove.direction = merged.autoMove.direction === 'right' ? 'right' : 'left';
  merged.autoMove.delay = Number.isFinite(delay) && delay >= 0 ? delay : AUTO_MOVE_DEFAULTS.delay;
  return merged;
}

function positiveInt(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) return fallback;
  return Math.floor(numeric);
}

export function normalizeWindowId(windowId) {
  if (windowId == null || windowId === '') return null;
  const numeric = Number(windowId);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

const RESTORABLE_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'ftp:']);

// chrome.tabs.create rejects privileged and empty URLs. Skip those so a
// single unrestorable entry cannot block the rest of the queue.
export function isRestorableUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (RESTORABLE_PROTOCOLS.has(parsed.protocol)) return true;
  if (parsed.protocol === 'about:' && parsed.pathname === 'blank') return true;
  if (parsed.protocol === 'chrome:') {
    return parsed.hostname === 'newtab' || parsed.hostname === 'new-tab-page';
  }
  return false;
}

export function effectiveLimit(config, win) {
  const merged = mergeConfig(config);
  const fixed = Math.max(1, Number(merged.tabLimit) || DEFAULT_CONFIG.tabLimit);
  if (!merged.adaptiveLimit) return fixed;

  const width = Number(win && win.width) || 0;
  const pixels = Math.max(1, Number(merged.pixelsPerTab) || DEFAULT_CONFIG.pixelsPerTab);
  if (!width) return fixed;

  const adaptive = Math.max(5, Math.floor(width / pixels));
  return Math.min(adaptive, fixed);
}

function accessStamp(accessTimes, tabId) {
  if (!accessTimes) return 0;
  if (accessTimes[tabId] != null) return Number(accessTimes[tabId]) || 0;
  const key = String(tabId);
  if (accessTimes[key] != null) return Number(accessTimes[key]) || 0;
  return 0;
}

// Least-recently used first. Equal timestamps fall back to the leftmost tab.
export function selectTabsToHide(tabs, accessTimes, count) {
  const needed = Math.max(0, Number(count) || 0);
  if (!needed) return [];

  const candidates = (Array.isArray(tabs) ? tabs : []).filter(tab => tab && !tab.pinned && tab.id != null);
  const sorted = candidates.slice().sort((a, b) => {
    const timeA = accessStamp(accessTimes, a.id);
    const timeB = accessStamp(accessTimes, b.id);
    if (timeA !== timeB) return timeA - timeB;
    return (Number(a.index) || 0) - (Number(b.index) || 0);
  });
  return sorted.slice(0, needed);
}

function byMostRecent(tabs) {
  return tabs.slice().sort((a, b) => (Number(b.hiddenAt) || 0) - (Number(a.hiddenAt) || 0));
}

function isEligibleForAutoRestore(tab) {
  if (!tab || !isRestorableUrl(tab.url)) return false;
  return (Number(tab.restoreFailures) || 0) < 2;
}

// Prefer this window's own hidden tabs, then tabs whose window is gone.
// Tabs still owned by another open window stay queued for that window.
export function selectTabsToRestore(hiddenTabs, windowId, openWindowIds, slots) {
  const room = Math.max(0, Number(slots) || 0);
  if (!room) return [];

  const target = normalizeWindowId(windowId);
  const open = new Set();
  for (const id of openWindowIds || []) {
    const normalized = normalizeWindowId(id);
    if (normalized != null) open.add(normalized);
  }

  const own = [];
  const orphans = [];
  for (const tab of Array.isArray(hiddenTabs) ? hiddenTabs : []) {
    if (!isEligibleForAutoRestore(tab)) continue;
    const owner = normalizeWindowId(tab.windowId);
    if (target != null && owner === target) own.push(tab);
    else if (owner == null || !open.has(owner)) orphans.push(tab);
  }

  const picked = [];
  const seen = new Set();
  for (const tab of [...byMostRecent(own), ...byMostRecent(orphans)]) {
    const key = String(tab.id);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(tab);
    if (picked.length >= room) break;
  }
  return picked;
}

export function trimQueue(hiddenTabs, maxLength) {
  const list = Array.isArray(hiddenTabs) ? hiddenTabs : [];
  const max = Math.max(0, Number(maxLength) || 0);
  if (list.length <= max) return list.slice();
  return list.slice(list.length - max);
}

export function orphanWindow(hiddenTabs, windowId) {
  const target = normalizeWindowId(windowId);
  let changed = false;
  const tabs = (Array.isArray(hiddenTabs) ? hiddenTabs : []).map(tab => {
    if (target == null || normalizeWindowId(tab.windowId) !== target) return tab;
    changed = true;
    return { ...tab, windowId: null };
  });
  return { tabs, changed };
}

export function hiddenRecordFromTab(tab, now = Date.now()) {
  const url = (tab && (tab.url || tab.pendingUrl)) || '';
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    url,
    title: (tab && tab.title) || url || '',
    favIconUrl: (tab && tab.favIconUrl) || '',
    windowId: normalizeWindowId(tab && tab.windowId),
    hiddenAt: now
  };
}

export function withoutHiddenIds(hiddenTabs, ids) {
  const drop = new Set([].concat(ids).map(id => String(id)));
  return (Array.isArray(hiddenTabs) ? hiddenTabs : []).filter(tab => !drop.has(String(tab.id)));
}

export function withoutHiddenId(hiddenTabs, id) {
  const key = String(id);
  let removed = null;
  const kept = [];
  for (const tab of Array.isArray(hiddenTabs) ? hiddenTabs : []) {
    if (removed == null && String(tab.id) === key) removed = tab;
    else kept.push(tab);
  }
  return { kept, removed };
}

async function storageGet(area, key) {
  const stored = await area.get(key);
  if (!stored || typeof stored !== 'object') return undefined;
  return stored[key];
}

export async function loadConfig(chrome) {
  const stored = await storageGet(chrome.storage.sync, 'config');
  return mergeConfig(stored);
}

export async function saveConfig(chrome, config) {
  const merged = mergeConfig(config);
  await chrome.storage.sync.set({ config: merged });
  return merged;
}

export async function loadHiddenTabs(chrome) {
  const stored = await storageGet(chrome.storage.local, 'hiddenTabs');
  return Array.isArray(stored) ? stored : [];
}

export async function saveHiddenTabs(chrome, hiddenTabs) {
  const list = Array.isArray(hiddenTabs) ? hiddenTabs : [];
  await chrome.storage.local.set({ hiddenTabs: list });
  return list;
}

export async function loadAccessTimes(chrome) {
  const stored = await storageGet(chrome.storage.local, 'tabAccessTimes');
  if (!stored || typeof stored !== 'object') return {};
  return stored;
}

export async function setAccessTime(chrome, tabId, when = Date.now()) {
  if (tabId == null) return;
  const times = { ...(await loadAccessTimes(chrome)) };
  times[String(tabId)] = when;
  await chrome.storage.local.set({ tabAccessTimes: times });
}

export async function clearAccessTime(chrome, tabId) {
  if (tabId == null) return;
  const times = { ...(await loadAccessTimes(chrome)) };
  if (times[String(tabId)] == null) return;
  delete times[String(tabId)];
  await chrome.storage.local.set({ tabAccessTimes: times });
}

export async function pruneAccessTimes(chrome, liveTabIds) {
  const live = new Set([].concat(liveTabIds).map(id => String(id)));
  const current = await loadAccessTimes(chrome);
  const next = {};
  for (const [id, stamp] of Object.entries(current)) {
    if (live.has(id)) next[id] = stamp;
  }
  await chrome.storage.local.set({ tabAccessTimes: next });
  return next;
}

export async function updateBadgeCount(chrome, config) {
  const merged = mergeConfig(config);
  const hiddenTabs = await loadHiddenTabs(chrome);
  const mode = merged.badgeMode;

  if (mode === 'open') {
    const tabs = await chrome.tabs.query({});
    await applyBadge(chrome, String(tabs.length), '#2196F3');
    return;
  }

  if (mode === 'user') {
    const tabs = await chrome.tabs.query({});
    const hiddenUserTabs = hiddenTabs.filter(tab => !tab.fromHistory);
    await applyBadge(chrome, String(tabs.length + hiddenUserTabs.length), '#4CAF50');
    return;
  }

  const count = hiddenTabs.length;
  await applyBadge(chrome, count > 0 ? String(count) : '', '#3f50b5');
}

async function applyBadge(chrome, text, color) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  if (chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: 'white' });
  }
}
