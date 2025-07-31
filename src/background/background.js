// background.js - 标签限制器的全部逻辑

// TabManager - 标签管理模块
const TabManager = {
  // 配置存储（sync）
  config: {
    active: true,
    tabLimit: 20,
    tabsQueueLength: 80,
    badgeMode: 'open',
    adaptiveLimit: true,
    pixelsPerTab: 150,
    autoMove: {
      enabled: true,
      direction: 'left', // 'left' 或 'right'
      delay: 3000 // 延迟时间（毫秒）
    }
  },

  // 隐藏标签存储
  hiddenTabs: [],

  // 标签访问记录
  tabAccessTimes: {},

  // 窗口大小变化的定时器ID
  resizeTimeoutId: null,

  // 操作锁和队列
  operationLock: false,
  operationQueue: [],

  // 标签页自动移动相关
  autoMoveTimerId: null,
  autoMoveTargetTabId: null,



  // 安全执行操作，防止并发冲突
  async executeOperation(operation) {
    return new Promise((resolve, reject) => {
      this.operationQueue.push({ operation, resolve, reject });
      this.processQueue();
    });
  },

  // 处理操作队列
  async processQueue() {
    if (this.operationLock || this.operationQueue.length === 0) {
      return;
    }

    this.operationLock = true;

    try {
      while (this.operationQueue.length > 0) {
        const { operation, resolve, reject } = this.operationQueue.shift();
        try {
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }
    } finally {
      this.operationLock = false;
    }
  },

  // 获取当前实际标签状态（实时查询）
  async getCurrentTabState() {
    try {
      const tabs = await chrome.tabs.query({});
      const nonPinnedTabs = tabs.filter(tab => !tab.pinned);
      const pinnedTabs = tabs.filter(tab => tab.pinned);
      const effectiveLimit = await this.getEffectiveTabLimit();

      const state = {
        timestamp: Date.now(),
        allTabs: tabs,
        nonPinnedTabs,
        pinnedTabs,
        effectiveLimit,
        hiddenTabsCount: this.hiddenTabs.length,
        needsHiding: nonPinnedTabs.length > effectiveLimit,
        canRestore: nonPinnedTabs.length < effectiveLimit && this.hiddenTabs.length > 0,
        totalTabCount: tabs.length,
        nonPinnedCount: nonPinnedTabs.length,
        pinnedCount: pinnedTabs.length
      };

      return state;
    } catch (error) {
      throw error;
    }
  },





  // 初始化
  async init() {
    try {
      const {config = {}} = await chrome.storage.sync.get('config');
      const {hiddenTabs = []} = await chrome.storage.local.get('hiddenTabs');
      const {tabAccessTimes = {}} = await chrome.storage.local.get('tabAccessTimes');
      
      this.config = {...this.config, ...config};
      
      this.hiddenTabs = hiddenTabs;
      
      // 加载标签访问时间记录
      this.tabAccessTimes = tabAccessTimes;
      
      console.log('TabManager initialized');
      return this;
    } catch (error) {
      console.error('Error initializing TabManager:', error);
      return this;
    }
  },
  
  // 保存配置
  async saveConfig() {
    try {
      await chrome.storage.sync.set({config: this.config});
    } catch (error) {
      console.error('Error saving config:', error);
    }
  },

  // 保存隐藏标签
  async saveHiddenTabs() {
    try {
      await chrome.storage.local.set({hiddenTabs: this.hiddenTabs});
    } catch (error) {
      // 静默处理错误
    }
  },

  // 保存标签访问时间记录
  async saveTabAccessTimes() {
    try {
      await chrome.storage.local.set({tabAccessTimes: this.tabAccessTimes});
    } catch (error) {
      // 静默处理错误
    }
  },
  
  // 更新标签访问时间
  updateTabAccessTime(tabId) {
    this.tabAccessTimes[tabId] = Date.now();
    this.saveTabAccessTimes();
  },

  // 获取隐藏标签 - 不再需要窗口ID
  getHiddenTabs() {
    return this.hiddenTabs || [];
  },

  // 添加隐藏标签
  addHiddenTab(tab) {
    this.hiddenTabs.push({
      url: tab.url || tab.pendingUrl,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      id: Date.now() + Math.random() * 1000 // 生成唯一ID
    });
    
    // 限制队列长度
    if (this.hiddenTabs.length > this.config.tabsQueueLength) {
      this.hiddenTabs.shift();
    }
  },

  // 删除隐藏标签
  removeHiddenTab(tabId) {
    const index = this.hiddenTabs.findIndex(tab => tab.id == tabId);
    if (index === -1) return false;
    
    this.hiddenTabs.splice(index, 1);
    return true;
  },

  // 获取要隐藏的标签
  async getTabsToHide(maxCount = 1) {
    try {
      const state = await this.getCurrentTabState();

      if (!state.needsHiding) {
        return [];
      }

      const excessCount = Math.min(maxCount, state.nonPinnedTabs.length - state.effectiveLimit);
      if (excessCount <= 0) {
        return [];
      }

      // 按访问时间排序，最早访问的在前面
      const sortedTabs = state.nonPinnedTabs.slice().sort((a, b) => {
        const timeA = this.tabAccessTimes[a.id] || 0;
        const timeB = this.tabAccessTimes[b.id] || 0;

        // 如果访问时间相同，按索引排序（左边的优先）
        if (timeA === timeB) {
          return a.index - b.index;
        }

        return timeA - timeB;
      });

      const tabsToHide = sortedTabs.slice(0, excessCount);

      return tabsToHide;
    } catch (error) {
      return [];
    }
  },


  
  // 获取有效的标签限制数量（考虑窗口宽度）- 不再需要窗口ID
  async getEffectiveTabLimit() {
    if (!this.config.adaptiveLimit) {
      return this.config.tabLimit; // 如果未启用自适应限制，返回固定值
    }
    
    try {
      // 获取当前窗口信息
      const windows = await chrome.windows.getAll({windowTypes: ['normal']});
      if (!windows || !windows.length) return this.config.tabLimit;
      
      // 使用当前活动窗口或第一个窗口
      let currentWindow = windows[0];
      for (const window of windows) {
        if (window.focused) {
          currentWindow = window;
          break;
        }
      }
      
      // 根据窗口宽度计算可显示的标签数量
      const availableWidth = currentWindow.width;
      const adaptiveLimit = Math.max(5, Math.floor(availableWidth / this.config.pixelsPerTab));
      
      // 返回自适应限制和固定限制中较小的值
      return Math.min(adaptiveLimit, this.config.tabLimit);
    } catch (error) {
      return this.config.tabLimit; // 出错时返回固定值
    }
  },

  // 更新徽章
  async updateBadgeCount() {
    try {
      switch (this.config.badgeMode) {
        case 'open': 
          // 显示打开的标签数量（蓝色）
          const tabs = await chrome.tabs.query({});
          const openCount = tabs.length;
          chrome.action.setBadgeText({ text: String(openCount) });
          chrome.action.setBadgeBackgroundColor({ color: '#2196F3' }); // 蓝色
          chrome.action.setBadgeTextColor({ color: 'white' }); // 确保文字是白色
          break;
          
        case 'user':
          // 显示用户标签数量（绿色）
          const userTabs = await chrome.tabs.query({});
          const hiddenUserTabs = this.hiddenTabs.filter(tab => !tab.fromHistory);
          const userCount = userTabs.length + hiddenUserTabs.length;
          chrome.action.setBadgeText({ text: String(userCount) });
          chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
          chrome.action.setBadgeTextColor({ color: 'white' });
          break;
          
        case 'hidden':
        default:
          // 显示隐藏标签数量（紫色）
          const count = this.hiddenTabs.length;
          const text = count > 0 ? String(count) : '';
          chrome.action.setBadgeText({ text });
          chrome.action.setBadgeBackgroundColor({ color: '#3f50b5' });
          chrome.action.setBadgeTextColor({ color: 'white' });
          break;
      }
    } catch (error) {
      // 静默处理错误
    }
  },
  


  // 标签页自动移动功能
  startAutoMoveTimer(tabId) {
    if (!this.config.autoMove.enabled) return;

    // 清除之前的计时器
    this.clearAutoMoveTimer();

    // 保存目标标签ID
    this.autoMoveTargetTabId = tabId;

    // 启动新的计时器
    this.autoMoveTimerId = setTimeout(() => {
      this.executeAutoMove();
    }, this.config.autoMove.delay);
  },

  clearAutoMoveTimer() {
    if (this.autoMoveTimerId) {
      clearTimeout(this.autoMoveTimerId);
      this.autoMoveTimerId = null;
    }
    this.autoMoveTargetTabId = null;
  },

  async executeAutoMove() {
    try {
      if (!this.config.autoMove.enabled || !this.autoMoveTargetTabId) {
        return;
      }

      // 获取当前激活的标签
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs.length) {
        console.log('No active tab found, auto move cancelled');
        this.clearAutoMoveTimer();
        return;
      }

      const activeTab = tabs[0];

      // 确保移动的是正确的标签
      if (activeTab.id !== this.autoMoveTargetTabId) {
        console.log('Active tab changed, auto move cancelled');
        this.clearAutoMoveTimer();
        return;
      }

      console.log('Executing auto move for tab:', activeTab.id, 'direction:', this.config.autoMove.direction);

      // 执行移动操作
      if (this.config.autoMove.direction === 'left') {
        await chrome.tabs.move(activeTab.id, { index: 0 });
      } else {
        await chrome.tabs.move(activeTab.id, { index: -1 });
      }

      // 清理计时器
      this.clearAutoMoveTimer();
    } catch (error) {
      console.error('Error executing auto move:', error);
      this.clearAutoMoveTimer();
    }
  }
};

// 初始化
async function initialize() {
  console.log('Initializing background script...');

  // 初始化TabManager
  await TabManager.init();

  // 添加事件监听器
  setupEventListeners();

  // 应用当前配置到系统状态
  await applyConfigChanges();

  // 扩展启动时，为当前激活的标签启动自动移动计时器
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      TabManager.startAutoMoveTimer(tabs[0].id);
    }
  } catch (error) {
    // 静默处理错误
  }

  console.log('Initialization complete');
}



// 设置事件监听器
function setupEventListeners() {
  // 标签事件
  chrome.tabs.onCreated.addListener(handleTabCreated);
  chrome.tabs.onRemoved.addListener(handleTabRemoved);
  chrome.tabs.onActivated.addListener(handleTabActivated);
  
  // 窗口事件
  chrome.windows.onFocusChanged.addListener(handleWindowFocusChanged);
  chrome.windows.onBoundsChanged.addListener(() => {
    // 防抖处理，避免频繁调用
    if (TabManager.resizeTimeoutId) {
      clearTimeout(TabManager.resizeTimeoutId);
    }

    TabManager.resizeTimeoutId = setTimeout(() => {
      handleWindowResized();
    }, 500); // 500ms防抖延迟
  });
  
  // 运行时事件
  chrome.runtime.onStartup.addListener(initialize);
  
  // 存储变化事件
  chrome.storage.onChanged.addListener(handleStorageChanged);
}

// 处理标签创建
async function handleTabCreated(tab) {
  console.log('Tab created:', tab.id);

  // 立即记录新标签的访问时间
  TabManager.updateTabAccessTime(tab.id);

  // 更新徽章以反映新标签
  TabManager.updateBadgeCount();

  if (!TabManager.config.active) return;

  // 使用安全操作机制处理标签限制
  TabManager.executeOperation(async () => {
    try {
      const state = await TabManager.getCurrentTabState();

      if (!state.needsHiding) {
        return;
      }

      const tabsToHide = await TabManager.getTabsToHide(1);

      if (tabsToHide.length === 0) {
        return;
      }

      const tabToHide = tabsToHide[0];
      console.log('Hiding tab due to limit:', tabToHide.id, tabToHide.title?.substring(0, 30));

      // 添加到隐藏列表
      TabManager.addHiddenTab(tabToHide);
      await TabManager.saveHiddenTabs();

      // 移除标签
      await chrome.tabs.remove(tabToHide.id);

      // 更新徽章
      TabManager.updateBadgeCount();
    } catch (error) {
      console.error('Error in tab creation operation:', error);
    }
  }).catch(error => {
    // 静默处理错误
  });
}

// 处理标签关闭
async function handleTabRemoved(tabId, {isWindowClosing}) {
  console.log('Tab removed:', tabId);

  if (TabManager.tabAccessTimes[tabId]) {
    delete TabManager.tabAccessTimes[tabId];
    await TabManager.saveTabAccessTimes();
  }

  // 更新徽章
  TabManager.updateBadgeCount();

  if (isWindowClosing || !TabManager.config.active) return;

  // 使用安全操作机制处理标签恢复
  TabManager.executeOperation(async () => {
    try {
      const state = await TabManager.getCurrentTabState();

      if (!state.canRestore) {
        return;
      }

      const tabsToRestore = Math.min(
        state.effectiveLimit - state.nonPinnedTabs.length,
        state.hiddenTabsCount
      );

      if (tabsToRestore <= 0) {
        return;
      }

      for (let i = 0; i < tabsToRestore; i++) {
        const tabToRestore = TabManager.hiddenTabs.pop();
        if (!tabToRestore) break;

        try {
          console.log('Restoring tab:', tabToRestore.url?.substring(0, 50));
          const newTab = await chrome.tabs.create({
            url: tabToRestore.url,
            active: false
          });

          // 记录新标签的访问时间
          TabManager.updateTabAccessTime(newTab.id);
        } catch (error) {
          console.error('Error restoring tab:', error);
          // 如果恢复失败，将标签重新放回隐藏列表
          TabManager.hiddenTabs.push(tabToRestore);
        }
      }

      await TabManager.saveHiddenTabs();
      TabManager.updateBadgeCount();
    } catch (error) {
      // 静默处理错误
    }
  }).catch(error => {
    // 静默处理错误
  });
}

// 处理标签激活
async function handleTabActivated({tabId, windowId}) {


  try {
    // 更新徽章
    TabManager.updateBadgeCount();

    // 获取当前标签信息并记录访问时间
    const tabs = await chrome.tabs.query({windowId});
    const activeTab = tabs.find(t => t.active);

    if (!activeTab) return;

    // 更新标签访问时间
    TabManager.updateTabAccessTime(tabId);

    // 启动自动移动计时器
    TabManager.startAutoMoveTimer(tabId);
  } catch (error) {
    // 静默处理错误
  }
}

// 处理窗口焦点变化 - 简化为只更新徽章
async function handleWindowFocusChanged(windowId) {

  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    TabManager.updateBadgeCount();

    // 当窗口重新获得焦点时，启动自动移动计时器
    try {
      const tabs = await chrome.tabs.query({ active: true, windowId });
      if (tabs.length > 0) {
        TabManager.startAutoMoveTimer(tabs[0].id);
      }
    } catch (error) {
      // 静默处理错误
    }
  }
}

// 处理存储变化
function handleStorageChanged(changes, areaName) {
  if (areaName === 'sync' && changes.config) {
    console.log('Config changed');
    TabManager.config = changes.config.newValue;
    applyConfigChanges();
  } else if (areaName === 'local' && changes.hiddenTabs) {
    TabManager.hiddenTabs = changes.hiddenTabs.newValue;
  } else if (areaName === 'local' && changes.tabAccessTimes) {
    TabManager.tabAccessTimes = changes.tabAccessTimes.newValue;
  }
}

// 应用配置到当前状态
async function applyConfigChanges() {
  try {
    TabManager.updateBadgeCount();
    await applyTabLimitChanges();

    // 配置变更时，为当前激活的标签启动自动移动计时器
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) {
        TabManager.startAutoMoveTimer(tabs[0].id);
      }
    } catch (error) {
      // 静默处理错误
    }
  } catch (error) {
    // 静默处理错误
  }
}

// 应用标签限制
async function applyTabLimitChanges() {
  return TabManager.executeOperation(async () => {
    try {
      if (!TabManager.config.active) {
        return;
      }

      const state = await TabManager.getCurrentTabState();

      if (state.needsHiding) {
        const excessCount = state.nonPinnedTabs.length - state.effectiveLimit;

        const tabsToHide = await TabManager.getTabsToHide(excessCount);

        if (tabsToHide.length > 0) {

          for (const tab of tabsToHide) {
            TabManager.addHiddenTab(tab);
          }

          await TabManager.saveHiddenTabs();

          for (const tab of tabsToHide) {
            try {
              await chrome.tabs.remove(tab.id);
            } catch (error) {
              console.error(`Error removing tab ${tab.id}:`, error);
            }
          }

          TabManager.updateBadgeCount();
        }
      }
      // 如果当前标签数量少于限制，恢复隐藏的标签
      else if (state.canRestore) {
        const tabsToRestore = Math.min(
          state.effectiveLimit - state.nonPinnedTabs.length,
          state.hiddenTabsCount
        );

        const restoredTabs = [];
        for (let i = 0; i < tabsToRestore; i++) {
          const tabToRestore = TabManager.hiddenTabs.pop();
          if (!tabToRestore) break;

          try {
            const newTab = await chrome.tabs.create({
              url: tabToRestore.url,
              active: false
            });

            // 记录新标签的访问时间
            TabManager.updateTabAccessTime(newTab.id);
            restoredTabs.push(newTab);
          } catch (error) {
            // 如果恢复失败，将标签重新放回隐藏列表
            TabManager.hiddenTabs.push(tabToRestore);
          }
        }

        if (restoredTabs.length > 0) {
          await TabManager.saveHiddenTabs();
          TabManager.updateBadgeCount();
        }
      }
    } catch (error) {
      throw error;
    }
  });
}

// 为了支持popup.js使用TabManager
export { TabManager };



// 处理窗口大小变化 - 使用安全操作机制
async function handleWindowResized() {
  if (!TabManager.config.active || !TabManager.config.adaptiveLimit) return;

  // 使用安全操作机制处理窗口大小变化
  TabManager.executeOperation(async () => {
    try {
      const state = await TabManager.getCurrentTabState();

      // 如果当前标签数量超过限制，隐藏多余的标签
      if (state.needsHiding) {
        const excessCount = state.nonPinnedTabs.length - state.effectiveLimit;

        const tabsToHide = await TabManager.getTabsToHide(excessCount);

        if (tabsToHide.length > 0) {

          // 批量添加到隐藏列表
          for (const tab of tabsToHide) {
            TabManager.addHiddenTab(tab);
          }

          await TabManager.saveHiddenTabs();

          // 批量移除标签
          for (const tab of tabsToHide) {
            try {
              await chrome.tabs.remove(tab.id);
            } catch (error) {
              // 静默处理错误
            }
          }

          TabManager.updateBadgeCount();
        }
      }
      // 如果当前标签数量少于限制，恢复隐藏的标签
      else if (state.canRestore) {
        const tabsToRestore = Math.min(
          state.effectiveLimit - state.nonPinnedTabs.length,
          state.hiddenTabsCount
        );

        for (let i = 0; i < tabsToRestore; i++) {
          const tabToRestore = TabManager.hiddenTabs.pop();
          if (!tabToRestore) break;

          try {
            const newTab = await chrome.tabs.create({
              url: tabToRestore.url,
              active: false
            });

            // 记录新标签的访问时间
            TabManager.updateTabAccessTime(newTab.id);
          } catch (error) {
            // 如果恢复失败，将标签重新放回隐藏列表
            TabManager.hiddenTabs.push(tabToRestore);
          }
        }

        if (tabsToRestore > 0) {
          await TabManager.saveHiddenTabs();
          TabManager.updateBadgeCount();
        }
      }
    } catch (error) {
      // 静默处理错误
    }
  }).catch(error => {
    // 静默处理错误
  });
}

// 添加onInstalled监听器，在安装/更新时初始化
chrome.runtime.onInstalled.addListener(initialize);
