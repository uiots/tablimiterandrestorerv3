import {
  clearAccessTime,
  effectiveLimit,
  hiddenRecordFromTab,
  loadAccessTimes,
  loadConfig,
  loadHiddenTabs,
  mergeConfig,
  normalizeWindowId,
  orphanWindow,
  pruneAccessTimes,
  saveHiddenTabs,
  selectTabsToHide,
  selectTabsToRestore,
  setAccessTime,
  trimQueue,
  updateBadgeCount,
  withoutHiddenIds
} from '../shared/tab-state.js';

export const AUTO_MOVE_ALARM = 'auto-move';
const AUTO_MOVE_SESSION_KEY = 'pendingAutoMove';
const RESIZE_DEBOUNCE_MS = 500;

// Per-window policy:
// - Each normal window is limited on its own. Pinned tabs are ignored.
// - Hidden tabs remember the window they came from.
// - A window restores its own tabs first (newest first), then orphans.
// - Closing a window orphans its queued tabs and offers them to other
//   normal windows that still have room. If none do, they stay queued
//   until some later window has a free slot.
export class TabController {
  constructor(chromeApi = globalThis.chrome) {
    this.chrome = chromeApi;
    this.config = mergeConfig(null);
    this.tail = Promise.resolve();
    this.depth = 0;
    this.autoMoveTimer = null;
    this.resizeTimers = new Map();
  }

  enqueue(operation) {
    this.depth += 1;
    const run = this.tail.then(async () => {
      try {
        return await operation();
      } catch (error) {
        console.error('[tab-limiter]', error);
        throw error;
      } finally {
        this.depth -= 1;
      }
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  async whenIdle() {
    let spins = 0;
    while (this.depth > 0) {
      await this.tail;
      spins += 1;
      if (spins > 1000) {
        throw new Error('Tab operations did not settle');
      }
    }
  }

  bootstrap() {
    return this.enqueue(() => this.runBootstrap());
  }

  handleTabCreated(tab) {
    return this.enqueue(() => this.onTabCreated(tab));
  }

  handleTabRemoved(tabId, removeInfo = {}) {
    return this.enqueue(() => this.onTabRemoved(tabId, removeInfo));
  }

  handleTabActivated(info) {
    return this.enqueue(() => this.onTabActivated(info));
  }

  handleWindowRemoved(windowId) {
    return this.enqueue(() => this.onWindowRemoved(windowId));
  }

  handleWindowCreated(win) {
    return this.enqueue(() => this.onWindowCreated(win));
  }

  handleWindowFocusChanged(windowId) {
    return this.enqueue(() => this.onWindowFocusChanged(windowId));
  }

  handleWindowBoundsChanged(win) {
    if (!win || win.id == null) return Promise.resolve();
    const windowId = win.id;
    const existing = this.resizeTimers.get(windowId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.resizeTimers.delete(windowId);
      this.enqueue(() => this.reconcileWindow(windowId)).catch(error => {
        console.error('[tab-limiter]', error);
      });
    }, RESIZE_DEBOUNCE_MS);
    this.resizeTimers.set(windowId, timer);
    return Promise.resolve();
  }

  handleStorageChanged(changes, areaName) {
    if (areaName !== 'sync' || !changes || !changes.config) return Promise.resolve();
    return this.enqueue(async () => {
      // Merge so a partial stored object cannot drop nested defaults.
      this.config = mergeConfig(changes.config.newValue);
      await this.reconcileAllWindows();
      await this.refreshBadge();
      await this.scheduleAutoMoveForFocusedTab();
    });
  }

  handleAlarm(alarm) {
    if (!alarm || alarm.name !== AUTO_MOVE_ALARM) return Promise.resolve();
    return this.enqueue(() => this.runAutoMove());
  }

  async runBootstrap() {
    this.config = await loadConfig(this.chrome);
    const tabs = await this.chrome.tabs.query({});
    await pruneAccessTimes(this.chrome, tabs.map(tab => tab.id));
    await this.orphanMissingWindows();
    await this.reconcileAllWindows();
    await this.resumeAutoMove();
    await this.refreshBadge();
  }

  async onTabCreated(tab) {
    if (tab && tab.id != null) await setAccessTime(this.chrome, tab.id);
    if (this.config.active && tab && tab.windowId != null) {
      await this.reconcileWindow(tab.windowId);
    }
    await this.refreshBadge();
  }

  async onTabRemoved(tabId, removeInfo) {
    await clearAccessTime(this.chrome, tabId);
    // The window is going away; restoring into it would fail. The
    // windows.onRemoved handler orphans the queue and redistributes.
    if (!removeInfo.isWindowClosing && this.config.active && removeInfo.windowId != null) {
      await this.reconcileWindow(removeInfo.windowId);
    }
    await this.refreshBadge();
  }

  async onTabActivated({ tabId } = {}) {
    if (tabId != null) await setAccessTime(this.chrome, tabId);
    await this.refreshBadge();
    await this.scheduleAutoMove(tabId);
  }

  async onWindowRemoved(windowId) {
    const pendingResize = this.resizeTimers.get(windowId);
    if (pendingResize) {
      clearTimeout(pendingResize);
      this.resizeTimers.delete(windowId);
    }
    const hidden = await loadHiddenTabs(this.chrome);
    const orphaned = orphanWindow(hidden, windowId);
    if (orphaned.changed) await saveHiddenTabs(this.chrome, orphaned.tabs);
    if (this.config.active) await this.reconcileAllWindows();
    await this.refreshBadge();
  }

  async onWindowCreated(win) {
    if (!win || (win.type && win.type !== 'normal')) return;
    if (this.config.active) await this.reconcileWindow(win.id);
    await this.refreshBadge();
  }

  async onWindowFocusChanged(windowId) {
    if (windowId === this.chrome.windows.WINDOW_ID_NONE) return;
    if (this.config.active) await this.reconcileWindow(windowId);
    await this.refreshBadge();
    try {
      const tabs = await this.chrome.tabs.query({ active: true, windowId });
      if (tabs.length > 0) await this.scheduleAutoMove(tabs[0].id);
    } catch (error) {
      console.error('[tab-limiter] focus auto-move', error);
    }
  }

  async reconcileAllWindows() {
    if (!this.config.active) return;
    const windows = await this.listNormalWindows();
    const focusedFirst = windows.slice().sort((a, b) => Number(Boolean(b.focused)) - Number(Boolean(a.focused)));
    for (const win of focusedFirst) {
      await this.reconcileWindow(win.id, win);
    }
  }

  async reconcileWindow(windowId, knownWindow) {
    if (!this.config.active) return;
    const normalized = normalizeWindowId(windowId);
    if (normalized == null) return;

    const win = knownWindow || await this.getNormalWindow(normalized);
    if (!win) return;

    const tabs = await this.chrome.tabs.query({ windowId: normalized });
    const nonPinned = tabs.filter(tab => !tab.pinned);
    const limit = effectiveLimit(this.config, win);

    if (nonPinned.length > limit) {
      const accessTimes = await loadAccessTimes(this.chrome);
      const victims = selectTabsToHide(nonPinned, accessTimes, nonPinned.length - limit);
      for (const tab of victims) {
        await this.hideTab(tab);
      }
      return;
    }

    if (nonPinned.length < limit) {
      await this.restoreInto(normalized, limit - nonPinned.length);
    }
  }

  async hideTab(tab) {
    if (!tab || tab.id == null || tab.pinned) return;
    const hidden = await loadHiddenTabs(this.chrome);
    const record = hiddenRecordFromTab(tab);
    const next = trimQueue(hidden.concat(record), this.config.tabsQueueLength);
    await saveHiddenTabs(this.chrome, next);
    await clearAccessTime(this.chrome, tab.id);

    try {
      await this.chrome.tabs.remove(tab.id);
      console.log('[tab-limiter] hid tab', tab.id, record.url);
    } catch (error) {
      let stillOpen = null;
      try {
        stillOpen = await this.chrome.tabs.get(tab.id);
      } catch {
        stillOpen = null;
      }
      if (stillOpen) {
        const rolled = withoutHiddenIds(await loadHiddenTabs(this.chrome), record.id);
        await saveHiddenTabs(this.chrome, rolled);
      }
      console.error('[tab-limiter] failed to hide tab', tab.id, error);
    }
  }

  async restoreInto(windowId, slots) {
    let remaining = Math.max(0, Number(slots) || 0);
    const attempted = new Set();

    while (remaining > 0) {
      const openWindowIds = (await this.listNormalWindows()).map(win => win.id);
      const hidden = await loadHiddenTabs(this.chrome);
      const picks = selectTabsToRestore(hidden, windowId, openWindowIds, remaining)
        .filter(tab => !attempted.has(String(tab.id)));
      if (picks.length === 0) return;

      for (const tab of picks) {
        attempted.add(String(tab.id));
        await saveHiddenTabs(this.chrome, withoutHiddenIds(await loadHiddenTabs(this.chrome), tab.id));
        try {
          const created = await this.chrome.tabs.create({
            url: tab.url,
            active: false,
            windowId
          });
          if (created && created.id != null) await setAccessTime(this.chrome, created.id);
          remaining -= 1;
          console.log('[tab-limiter] restored tab into window', windowId, tab.url);
        } catch (error) {
          console.error('[tab-limiter] restore failed', tab.url, error);
          const rolled = trimQueue((await loadHiddenTabs(this.chrome)).concat({
            ...tab,
            windowId: null,
            restoreFailures: (Number(tab.restoreFailures) || 0) + 1
          }), this.config.tabsQueueLength);
          await saveHiddenTabs(this.chrome, rolled);
        }
      }
    }
  }

  async orphanMissingWindows() {
    const openIds = new Set((await this.listNormalWindows()).map(win => win.id));
    const hidden = await loadHiddenTabs(this.chrome);
    let changed = false;
    const next = hidden.map(tab => {
      const owner = normalizeWindowId(tab.windowId);
      if (owner == null || openIds.has(owner)) return tab;
      changed = true;
      return { ...tab, windowId: null };
    });
    if (changed) await saveHiddenTabs(this.chrome, next);
  }

  async scheduleAutoMove(tabId) {
    const autoMove = this.config.autoMove;
    if (!autoMove || !autoMove.enabled || tabId == null) {
      await this.clearAutoMove();
      return;
    }

    const delay = Math.max(0, Number(autoMove.delay) || 0);
    const pending = {
      tabId,
      windowId: null,
      direction: autoMove.direction === 'right' ? 'right' : 'left',
      dueAt: Date.now() + delay
    };

    try {
      const tab = await this.chrome.tabs.get(tabId);
      pending.windowId = normalizeWindowId(tab.windowId);
    } catch {
      // The tab can disappear before the timer fires; execution rechecks.
    }

    await this.writePendingAutoMove(pending);
    this.armAutoMoveTimeout(delay);
    await this.armAutoMoveAlarm(pending.dueAt);
  }

  async scheduleAutoMoveForFocusedTab() {
    if (!this.config.autoMove || !this.config.autoMove.enabled) {
      await this.clearAutoMove();
      return;
    }
    try {
      const tabs = await this.chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) await this.scheduleAutoMove(tabs[0].id);
    } catch (error) {
      console.error('[tab-limiter] schedule auto-move', error);
    }
  }

  async resumeAutoMove() {
    const pending = await this.readPendingAutoMove();
    if (!pending) return;
    if (!this.config.autoMove || !this.config.autoMove.enabled) {
      await this.clearAutoMove();
      return;
    }
    const remaining = pending.dueAt - Date.now();
    if (remaining <= 0) {
      await this.runAutoMove();
      return;
    }
    this.armAutoMoveTimeout(remaining);
    await this.armAutoMoveAlarm(pending.dueAt);
  }

  async runAutoMove() {
    const pending = await this.readPendingAutoMove();
    if (!pending) return;

    const remaining = pending.dueAt - Date.now();
    if (remaining > 250) {
      // chrome.alarms may coalesce a short delay to its minimum. Wait for
      // the timestamp the user actually configured.
      this.armAutoMoveTimeout(remaining);
      await this.armAutoMoveAlarm(pending.dueAt);
      return;
    }

    await this.clearAutoMove();
    if (!this.config.autoMove || !this.config.autoMove.enabled) return;

    let tab = null;
    try {
      tab = await this.chrome.tabs.get(pending.tabId);
    } catch {
      return;
    }
    if (!tab || !tab.active) return;

    const index = pending.direction === 'left' ? 0 : -1;
    try {
      await this.chrome.tabs.move(tab.id, { index });
    } catch (error) {
      console.error('[tab-limiter] auto-move failed', error);
    }
  }

  armAutoMoveTimeout(delay) {
    if (this.autoMoveTimer) {
      clearTimeout(this.autoMoveTimer);
      this.autoMoveTimer = null;
    }
    this.autoMoveTimer = setTimeout(() => {
      this.autoMoveTimer = null;
      this.enqueue(() => this.runAutoMove()).catch(error => {
        console.error('[tab-limiter]', error);
      });
    }, Math.max(0, delay));
    // Node tests should not wait on this timer. Chrome has no unref; the
    // alarm is what wakes a sleeping worker.
    this.autoMoveTimer.unref?.();
  }

  async armAutoMoveAlarm(dueAt) {
    if (!this.chrome.alarms) return;
    // Chrome delivers very short alarms late (about 30s). Clamp so a short
    // delay cannot spin the worker, and keep a backup wake if it sleeps.
    const earliest = Date.now() + 30000;
    const when = Math.max(Number(dueAt) || earliest, earliest);
    try {
      await this.chrome.alarms.create(AUTO_MOVE_ALARM, { when });
    } catch (error) {
      console.error('[tab-limiter] alarm create failed', error);
    }
  }

  async clearAutoMove() {
    if (this.autoMoveTimer) {
      clearTimeout(this.autoMoveTimer);
      this.autoMoveTimer = null;
    }
    try {
      await this.chrome.storage.session.remove(AUTO_MOVE_SESSION_KEY);
    } catch (error) {
      console.error('[tab-limiter] clear auto-move session', error);
    }
    if (this.chrome.alarms) {
      try {
        await this.chrome.alarms.clear(AUTO_MOVE_ALARM);
      } catch (error) {
        console.error('[tab-limiter] alarm clear failed', error);
      }
    }
  }

  async readPendingAutoMove() {
    try {
      const stored = await this.chrome.storage.session.get(AUTO_MOVE_SESSION_KEY);
      const pending = stored && stored[AUTO_MOVE_SESSION_KEY];
      if (!pending || pending.tabId == null || pending.dueAt == null) return null;
      return pending;
    } catch (error) {
      console.error('[tab-limiter] read auto-move', error);
      return null;
    }
  }

  async writePendingAutoMove(pending) {
    await this.chrome.storage.session.set({ [AUTO_MOVE_SESSION_KEY]: pending });
  }

  async refreshBadge() {
    try {
      await updateBadgeCount(this.chrome, this.config);
    } catch (error) {
      console.error('[tab-limiter] badge', error);
    }
  }

  async listNormalWindows() {
    const windows = await this.chrome.windows.getAll({ windowTypes: ['normal'] });
    return (windows || []).filter(win => !win.type || win.type === 'normal');
  }

  async getNormalWindow(windowId) {
    try {
      const win = await this.chrome.windows.get(windowId);
      if (!win) return null;
      if (win.type && win.type !== 'normal') return null;
      return win;
    } catch {
      return null;
    }
  }
}
