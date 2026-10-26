// Popup UI. Imports shared helpers only — never the service-worker entry.
import {
  effectiveLimit,
  isRestorableUrl,
  loadConfig,
  loadHiddenTabs,
  mergeConfig,
  saveConfig as persistConfig,
  saveHiddenTabs,
  trimQueue,
  updateBadgeCount,
  withoutHiddenId
} from '../shared/tab-state.js';

const chrome = globalThis.chrome;
let config = mergeConfig(null);

async function initPopup() {
  try {
    config = await loadConfig(chrome);
    renderSettings();
    setupConfigToggle();
    setupEventListeners();
    await updatePopupContent();
  } catch (error) {
    console.error('[tab-limiter] popup init', error);
  }
}

async function updatePopupContent() {
  try {
    await renderHiddenTabs();
    await updateBadgePreview();
    toggleAdaptiveInfo();
    if (config.adaptiveLimit) await updateAdaptiveInfo();
  } catch (error) {
    console.error('[tab-limiter] popup update', error);
  }
}

function setupConfigToggle() {
  const toggleButton = document.getElementById('toggleConfig');
  const configSection = document.getElementById('configSection');
  configSection.classList.remove('active');
  toggleButton.classList.remove('active');
  toggleButton.addEventListener('click', () => {
    configSection.classList.toggle('active');
    toggleButton.classList.toggle('active');
  });
}

function renderSettings() {
  document.getElementById('inputActive').checked = config.active;
  document.getElementById('inputTabsVisible').value = config.tabLimit;

  const queueInput = document.getElementById('inputTabsQueueLength');
  if (queueInput) queueInput.value = config.tabsQueueLength;

  const pixelsInput = document.getElementById('inputPixelsPerTab');
  if (pixelsInput) pixelsInput.value = config.pixelsPerTab;

  const adaptiveInput = document.getElementById('inputAdaptiveLimit');
  if (adaptiveInput) adaptiveInput.checked = config.adaptiveLimit;

  const hiddenMode = document.getElementById('badgeModeHidden');
  if (hiddenMode) hiddenMode.checked = config.badgeMode === 'hidden';
  const openMode = document.getElementById('badgeModeOpen');
  if (openMode) openMode.checked = config.badgeMode === 'open';
  const userMode = document.getElementById('badgeModeUser');
  if (userMode) userMode.checked = config.badgeMode === 'user';

  const autoMove = config.autoMove;
  const autoEnabled = document.getElementById('inputAutoMoveEnabled');
  if (autoEnabled) autoEnabled.checked = autoMove.enabled;
  const moveLeft = document.getElementById('inputAutoMoveDirectionLeft');
  if (moveLeft) moveLeft.checked = autoMove.direction === 'left';
  const moveRight = document.getElementById('inputAutoMoveDirectionRight');
  if (moveRight) moveRight.checked = autoMove.direction === 'right';
  const delayInput = document.getElementById('inputAutoMoveDelay');
  if (delayInput) delayInput.value = Math.round(autoMove.delay / 1000);
}

async function updateBadgePreview() {
  const tabs = await chrome.tabs.query({});
  const hiddenTabs = await loadHiddenTabs(chrome);
  const hiddenUserTabs = hiddenTabs.filter(tab => !tab.fromHistory);
  document.getElementById('badgePreviewHidden').textContent = hiddenTabs.length;
  document.getElementById('badgePreviewOpen').textContent = tabs.length;
  document.getElementById('badgePreviewUser').textContent = tabs.length + hiddenUserTabs.length;
}

async function renderHiddenTabs() {
  const listElement = document.getElementById('listHiddenTabs');
  const emptyContainer = document.getElementById('emptyTabsContainer');
  const hiddenTabs = await loadHiddenTabs(chrome);
  listElement.innerHTML = '';
  if (hiddenTabs.length === 0) {
    emptyContainer.style.display = 'flex';
    listElement.style.display = 'none';
    return;
  }

  emptyContainer.style.display = 'none';
  listElement.style.display = 'block';

  hiddenTabs.slice().reverse().forEach(tab => {
    const li = document.createElement('li');
    const tabInfo = document.createElement('div');
    tabInfo.className = 'tab-info';

    const favicon = document.createElement('img');
    if (tab.favIconUrl) favicon.src = tab.favIconUrl;
    favicon.alt = 'Favicon';
    favicon.className = 'favicon';
    tabInfo.appendChild(favicon);

    const title = document.createElement('div');
    title.className = 'tab-title';
    title.textContent = tab.title || tab.url;
    tabInfo.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'tab-actions';
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete is-small';
    deleteBtn.setAttribute('data-action', 'delete');
    actions.appendChild(deleteBtn);

    li.appendChild(tabInfo);
    li.appendChild(actions);
    li.dataset.id = tab.id;
    li.dataset.url = tab.url || '';
    li.dataset.windowId = tab.windowId == null ? '' : String(tab.windowId);
    li.dataset.restorable = isRestorableUrl(tab.url) ? '1' : '0';
    li.title = tab.title || tab.url || '';
    listElement.appendChild(li);
  });
}

async function persistAndBadge() {
  config = await persistConfig(chrome, config);
  await updateBadgeCount(chrome, config);
}

function setupEventListeners() {
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === 'sync' && changes.config) {
      config = mergeConfig(changes.config.newValue);
    }
    if ((areaName === 'sync' && changes.config) || (areaName === 'local' && changes.hiddenTabs)) {
      await updatePopupContent();
    }
  });

  document.getElementById('inputActive').addEventListener('change', async evt => {
    config.active = evt.target.checked;
    await persistAndBadge();
  });

  document.getElementById('inputAdaptiveLimit').addEventListener('change', async evt => {
    config.adaptiveLimit = evt.target.checked;
    await persistAndBadge();
  });

  document.getElementById('inputPixelsPerTab').addEventListener('change', async evt => {
    config.pixelsPerTab = Math.max(100, Math.min(500, parseInt(evt.target.value, 10) || config.pixelsPerTab));
    evt.target.value = config.pixelsPerTab;
    await persistAndBadge();
  });

  document.getElementById('inputTabsVisible').addEventListener('change', async evt => {
    config.tabLimit = Math.max(1, parseInt(evt.target.value, 10) || config.tabLimit);
    evt.target.value = config.tabLimit;
    await persistAndBadge();
  });

  const queueInput = document.getElementById('inputTabsQueueLength');
  if (queueInput) {
    queueInput.addEventListener('change', async evt => {
      config.tabsQueueLength = Math.max(1, parseInt(evt.target.value, 10) || config.tabsQueueLength);
      evt.target.value = config.tabsQueueLength;
      await persistAndBadge();
      const hiddenTabs = await loadHiddenTabs(chrome);
      if (hiddenTabs.length > config.tabsQueueLength) {
        await saveHiddenTabs(chrome, trimQueue(hiddenTabs, config.tabsQueueLength));
      }
      await renderHiddenTabs();
      await updateBadgePreview();
    });
  }

  document.getElementById('listHiddenTabs').addEventListener('click', async evt => {
    const li = evt.target.closest('li');
    if (!li) return;

    const isDelete = evt.target.classList.contains('delete');
    if (!isDelete && li.dataset.restorable !== '1') return;

    const { kept, removed } = withoutHiddenId(await loadHiddenTabs(chrome), li.dataset.id);
    if (!removed) return;

    // Drop the queue entry before creating the tab so the service worker
    // does not restore the same URL a second time.
    await saveHiddenTabs(chrome, kept);

    if (!isDelete) {
      const windowId = await resolveRestoreWindow(li.dataset.windowId);
      try {
        await chrome.tabs.create({
          url: li.dataset.url,
          active: !(evt.ctrlKey || evt.metaKey),
          windowId
        });
      } catch (error) {
        console.error('[tab-limiter] manual restore failed', error);
        const current = await loadHiddenTabs(chrome);
        await saveHiddenTabs(chrome, trimQueue(current.concat(removed), config.tabsQueueLength));
        return;
      }
    }

    await updateBadgeCount(chrome, config);
    await updatePopupContent();
  });

  document.getElementById('badgeModeHidden').addEventListener('change', async evt => {
    if (!evt.target.checked) return;
    config.badgeMode = 'hidden';
    await persistAndBadge();
  });

  document.getElementById('badgeModeOpen').addEventListener('change', async evt => {
    if (!evt.target.checked) return;
    config.badgeMode = 'open';
    await persistAndBadge();
  });

  document.getElementById('badgeModeUser').addEventListener('change', async evt => {
    if (!evt.target.checked) return;
    config.badgeMode = 'user';
    await persistAndBadge();
  });

  document.getElementById('inputAutoMoveEnabled').addEventListener('change', async evt => {
    config.autoMove.enabled = evt.target.checked;
    await persistAndBadge();
  });

  document.getElementById('inputAutoMoveDirectionLeft').addEventListener('change', async evt => {
    if (!evt.target.checked) return;
    config.autoMove.direction = 'left';
    await persistAndBadge();
  });

  document.getElementById('inputAutoMoveDirectionRight').addEventListener('change', async evt => {
    if (!evt.target.checked) return;
    config.autoMove.direction = 'right';
    await persistAndBadge();
  });

  document.getElementById('inputAutoMoveDelay').addEventListener('change', async evt => {
    const seconds = Math.max(1, Math.min(60, parseInt(evt.target.value, 10) || 3));
    config.autoMove.delay = seconds * 1000;
    evt.target.value = seconds;
    await persistAndBadge();
  });
}

async function resolveRestoreWindow(preferredId) {
  const preferred = Number(preferredId);
  if (Number.isInteger(preferred) && preferred > 0) {
    try {
      const win = await chrome.windows.get(preferred);
      if (win && (!win.type || win.type === 'normal')) return win.id;
    } catch {
      // Source window is gone; fall through to the current one.
    }
  }
  const current = await chrome.windows.getCurrent();
  return current && current.id;
}

function toggleAdaptiveInfo() {
  const containers = [
    document.getElementById('adaptiveInfoContainer'),
    document.getElementById('adaptiveInfoContainer2'),
    document.getElementById('adaptiveInfoContainer3')
  ];
  if (containers.some(node => !node)) return;
  const display = config.adaptiveLimit ? 'block' : 'none';
  for (const node of containers) node.style.display = display;
}

async function updateAdaptiveInfo() {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  let currentWindow = windows[0];
  for (const win of windows) {
    if (win.focused) {
      currentWindow = win;
      break;
    }
  }
  if (!currentWindow) return;

  const pixels = config.pixelsPerTab;
  const calculatedLimit = Math.max(5, Math.floor(currentWindow.width / pixels));
  const limit = effectiveLimit(config, currentWindow);
  document.getElementById('currentWindowWidth').value = `${currentWindow.width}px`;
  document.getElementById('calculatedTabLimit').value = `${calculatedLimit}`;
  document.getElementById('effectiveTabLimit').value = `${limit}`;
}

document.addEventListener('DOMContentLoaded', () => {
  initPopup();
});
