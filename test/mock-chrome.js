function clone(value) {
  return value == null ? value : structuredClone(value);
}

function createArea(store, areaName, emit) {
  return {
    async get(keys) {
      const result = {};
      if (keys == null) {
        for (const [key, value] of Object.entries(store)) result[key] = clone(value);
        return result;
      }
      if (typeof keys === 'string') {
        if (Object.prototype.hasOwnProperty.call(store, keys)) result[keys] = clone(store[keys]);
        return result;
      }
      if (Array.isArray(keys)) {
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = clone(store[key]);
        }
        return result;
      }
      for (const [key, fallback] of Object.entries(keys)) {
        result[key] = Object.prototype.hasOwnProperty.call(store, key) ? clone(store[key]) : clone(fallback);
      }
      return result;
    },
    async set(values) {
      const changes = {};
      for (const [key, value] of Object.entries(values || {})) {
        const oldValue = Object.prototype.hasOwnProperty.call(store, key) ? clone(store[key]) : undefined;
        store[key] = clone(value);
        changes[key] = { oldValue, newValue: clone(value) };
      }
      emit(areaName, changes);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const changes = {};
      for (const key of list) {
        if (!Object.prototype.hasOwnProperty.call(store, key)) continue;
        const oldValue = clone(store[key]);
        delete store[key];
        changes[key] = { oldValue, newValue: undefined };
      }
      if (Object.keys(changes).length) emit(areaName, changes);
    }
  };
}

export function createChromeMock(initial = {}) {
  const storage = {
    local: clone(initial.storage?.local || initial.local || {}) || {},
    sync: clone(initial.storage?.sync || initial.sync || {}) || {},
    session: clone(initial.storage?.session || initial.session || {}) || {}
  };
  const windows = new Map();
  const tabs = new Map();
  let nextWindowId = initial.nextWindowId || 1;
  let nextTabId = initial.nextTabId || 1;

  const listeners = {
    'tabs.onCreated': [],
    'tabs.onRemoved': [],
    'tabs.onActivated': [],
    'windows.onCreated': [],
    'windows.onRemoved': [],
    'windows.onFocusChanged': [],
    'windows.onBoundsChanged': [],
    'runtime.onInstalled': [],
    'runtime.onStartup': [],
    'storage.onChanged': [],
    'alarms.onAlarm': []
  };
  const invocations = {
    onInstalled: 0,
    onStartup: 0
  };
  const alarms = new Map();
  const moved = [];
  const badge = { text: '', color: '' };

  function emit(name, ...args) {
    for (const listener of listeners[name]) {
      listener(...args);
    }
  }

  function tabsIn(windowId) {
    return [...tabs.values()]
      .filter(tab => tab.windowId === windowId)
      .sort((a, b) => a.index - b.index);
  }

  function reindex(windowId) {
    tabsIn(windowId).forEach((tab, index) => {
      tab.index = index;
    });
  }

  function currentWindow() {
    return [...windows.values()].find(win => win.focused) || [...windows.values()][0] || null;
  }

  for (const win of initial.windows || []) {
    windows.set(win.id, { type: 'normal', state: 'normal', focused: false, width: 1200, ...clone(win) });
    nextWindowId = Math.max(nextWindowId, win.id + 1);
  }
  for (const tab of initial.tabs || []) {
    tabs.set(tab.id, { pinned: false, active: false, index: 0, title: tab.url || '', ...clone(tab) });
    nextTabId = Math.max(nextTabId, tab.id + 1);
  }

  function addWindow(props = {}) {
    const id = props.id || nextWindowId++;
    nextWindowId = Math.max(nextWindowId, id + 1);
    const win = {
      id,
      type: props.type || 'normal',
      state: props.state || 'normal',
      focused: Boolean(props.focused),
      width: props.width || 1200,
      height: props.height || 800
    };
    if (win.focused) {
      for (const other of windows.values()) other.focused = false;
    }
    windows.set(id, win);
    emit('windows.onCreated', { ...win });
    return { ...win };
  }

  function addTab(props = {}) {
    const windowId = props.windowId || currentWindow()?.id;
    if (!windows.has(windowId)) throw new Error(`No window ${windowId}`);
    const id = props.id || nextTabId++;
    nextTabId = Math.max(nextTabId, id + 1);
    const siblings = tabsIn(windowId);
    const tab = {
      id,
      windowId,
      url: props.url || 'chrome://newtab/',
      pendingUrl: props.pendingUrl || props.url || '',
      title: props.title || props.url || 'New Tab',
      favIconUrl: props.favIconUrl || '',
      pinned: Boolean(props.pinned),
      active: props.active !== false,
      index: siblings.length
    };
    if (tab.active) {
      for (const sibling of siblings) sibling.active = false;
    }
    tabs.set(id, tab);
    emit('tabs.onCreated', { ...tab });
    if (tab.active) emit('tabs.onActivated', { tabId: id, windowId });
    return { ...tab };
  }

  async function removeTabs(idOrIds, info = {}) {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    for (const id of ids) {
      const tab = tabs.get(id);
      if (!tab) continue;
      tabs.delete(id);
      reindex(tab.windowId);
      emit('tabs.onRemoved', id, {
        windowId: tab.windowId,
        isWindowClosing: Boolean(info.isWindowClosing)
      });
    }
  }

  function closeWindow(windowId) {
    const closing = tabsIn(windowId);
    for (const tab of closing) {
      tabs.delete(tab.id);
      emit('tabs.onRemoved', tab.id, { windowId, isWindowClosing: true });
    }
    windows.delete(windowId);
    emit('windows.onRemoved', windowId);
  }

  const api = {
    storage: {
      local: createArea(storage.local, 'local', (area, changes) => emit('storage.onChanged', changes, area)),
      sync: createArea(storage.sync, 'sync', (area, changes) => emit('storage.onChanged', changes, area)),
      session: createArea(storage.session, 'session', (area, changes) => emit('storage.onChanged', changes, area)),
      onChanged: {
        addListener(fn) { listeners['storage.onChanged'].push(fn); }
      }
    },
    tabs: {
      async query(query = {}) {
        let list = [...tabs.values()];
        if (query.windowId != null) list = list.filter(tab => tab.windowId === query.windowId);
        if (query.active != null) list = list.filter(tab => Boolean(tab.active) === Boolean(query.active));
        if (query.pinned != null) list = list.filter(tab => Boolean(tab.pinned) === Boolean(query.pinned));
        if (query.currentWindow) {
          const win = currentWindow();
          list = win ? list.filter(tab => tab.windowId === win.id) : [];
        }
        return list.map(tab => ({ ...tab }));
      },
      async get(id) {
        const tab = tabs.get(id);
        if (!tab) {
          const error = new Error(`No tab with id: ${id}`);
          throw error;
        }
        return { ...tab };
      },
      async create(props = {}) {
        return addTab(props);
      },
      async remove(idOrIds) {
        await removeTabs(idOrIds);
      },
      async move(id, moveProps) {
        const tab = tabs.get(id);
        if (!tab) throw new Error(`No tab with id: ${id}`);
        const siblings = tabsIn(tab.windowId).filter(item => item.id !== id);
        let index = moveProps.index;
        if (index < 0) index = siblings.length;
        index = Math.max(0, Math.min(index, siblings.length));
        siblings.splice(index, 0, tab);
        siblings.forEach((item, position) => {
          item.index = position;
        });
        moved.push({ id, index: tab.index, windowId: tab.windowId });
        return { ...tab };
      },
      onCreated: { addListener(fn) { listeners['tabs.onCreated'].push(fn); } },
      onRemoved: { addListener(fn) { listeners['tabs.onRemoved'].push(fn); } },
      onActivated: { addListener(fn) { listeners['tabs.onActivated'].push(fn); } }
    },
    windows: {
      WINDOW_ID_NONE: -1,
      async get(id) {
        const win = windows.get(id);
        if (!win) throw new Error(`No window with id: ${id}`);
        return { ...win };
      },
      async getCurrent() {
        const win = currentWindow();
        if (!win) throw new Error('No current window');
        return { ...win };
      },
      async getAll(query = {}) {
        let list = [...windows.values()];
        if (query.windowTypes) {
          list = list.filter(win => query.windowTypes.includes(win.type || 'normal'));
        }
        return list.map(win => ({ ...win }));
      },
      onCreated: { addListener(fn) { listeners['windows.onCreated'].push(fn); } },
      onRemoved: { addListener(fn) { listeners['windows.onRemoved'].push(fn); } },
      onFocusChanged: { addListener(fn) { listeners['windows.onFocusChanged'].push(fn); } },
      onBoundsChanged: { addListener(fn) { listeners['windows.onBoundsChanged'].push(fn); } }
    },
    runtime: {
      onInstalled: {
        addListener(fn) { listeners['runtime.onInstalled'].push(fn); },
        dispatch() {
          invocations.onInstalled += 1;
          emit('runtime.onInstalled', { reason: 'install' });
        }
      },
      onStartup: {
        addListener(fn) { listeners['runtime.onStartup'].push(fn); },
        dispatch() {
          invocations.onStartup += 1;
          emit('runtime.onStartup', {});
        }
      }
    },
    alarms: {
      async create(name, info) {
        alarms.set(name, { ...info });
      },
      async clear(name) {
        return alarms.delete(name);
      },
      async get(name) {
        const alarm = alarms.get(name);
        return alarm ? { name, ...alarm } : undefined;
      },
      onAlarm: {
        addListener(fn) { listeners['alarms.onAlarm'].push(fn); }
      }
    },
    action: {
      async setBadgeText({ text }) { badge.text = text; },
      async setBadgeBackgroundColor({ color }) { badge.color = color; },
      async setBadgeTextColor() {}
    },
    _test: {
      addWindow,
      addTab,
      closeWindow,
      moved,
      badge,
      alarms,
      listeners,
      invocations,
      listenerCount(name) { return listeners[name].length; },
      resetListeners() {
        for (const bucket of Object.values(listeners)) bucket.length = 0;
      },
      async fireAlarm(name) {
        const alarm = alarms.get(name);
        emit('alarms.onAlarm', { name, scheduledTime: alarm ? alarm.when : Date.now() });
      },
      snapshot() {
        return {
          storage: clone(storage),
          windows: [...windows.values()].map(win => clone(win)),
          tabs: [...tabs.values()].map(tab => clone(tab)),
          nextTabId,
          nextWindowId
        };
      }
    }
  };

  return api;
}
