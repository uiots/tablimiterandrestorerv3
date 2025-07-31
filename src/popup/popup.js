// popup.js - 简化的弹出窗口脚本
import { TabManager } from '../background/background.js';

// 初始化
async function initPopup() {
  console.log('Initializing popup...');

  try {
    // 初始化TabManager
    await TabManager.init();

    // 渲染设置
    renderSettings();

    // 设置配置部分默认折叠
    setupConfigToggle();

    // 添加事件监听器
    setupEventListeners();

    // 更新popup内容
    await updatePopupContent();

    console.log('Popup initialized');
  } catch (error) {
    console.error('Error initializing popup:', error);
  }
}

// 统一更新popup内容
async function updatePopupContent() {
  try {
    // 渲染隐藏的标签列表
    renderHiddenTabs();
    
    // 更新徽标预览
    await updateBadgePreview();
    
    // 切换自适应标签限制信息显示状态
    toggleAdaptiveInfo();
    
    // 如果自适应标签限制已启用，更新信息
    if (TabManager.config.adaptiveLimit) {
      await updateAdaptiveInfo();
    }
  } catch (error) {
    // 静默处理错误
  }
}

// 设置配置折叠功能
function setupConfigToggle() {
  const toggleButton = document.getElementById('toggleConfig');
  const configSection = document.getElementById('configSection');

  // 默认折叠
  configSection.classList.remove('active');
  toggleButton.classList.remove('active');

  // 添加点击事件
  toggleButton.addEventListener('click', async () => {
    configSection.classList.toggle('active');
    toggleButton.classList.toggle('active');
  });
}



// 渲染设置
function renderSettings() {
  // 设置复选框
  document.getElementById('inputActive').checked = TabManager.config.active;
  
  // 设置数值输入框
  document.getElementById('inputTabsVisible').value = TabManager.config.tabLimit;
  
  // 如果存在其他输入框，也设置它们
  if (document.getElementById('inputTabsQueueLength')) {
    document.getElementById('inputTabsQueueLength').value = 
      TabManager.config.tabsQueueLength || 80; // 保持兼容
  }
  
  // 自适应标签限制设置
  if (document.getElementById('inputPixelsPerTab')) {
    document.getElementById('inputPixelsPerTab').value = 
      TabManager.config.pixelsPerTab || 200;
  }
  
  if (document.getElementById('inputAdaptiveLimit')) {
    document.getElementById('inputAdaptiveLimit').checked = 
      TabManager.config.adaptiveLimit || false;
  }
  
  // 设置徽标模式单选按钮
  if (document.getElementById('badgeModeHidden')) {
    document.getElementById('badgeModeHidden').checked = 
      TabManager.config.badgeMode === 'hidden';
  }
  
  if (document.getElementById('badgeModeOpen')) {
    document.getElementById('badgeModeOpen').checked = 
      TabManager.config.badgeMode === 'open';
  }
  
  if (document.getElementById('badgeModeUser')) {
    document.getElementById('badgeModeUser').checked =
      TabManager.config.badgeMode === 'user';
  }

  // 标签页自动移动设置
  if (document.getElementById('inputAutoMoveEnabled')) {
    document.getElementById('inputAutoMoveEnabled').checked =
      TabManager.config.autoMove?.enabled || false;
  }

  if (document.getElementById('inputAutoMoveDirectionLeft')) {
    document.getElementById('inputAutoMoveDirectionLeft').checked =
      (TabManager.config.autoMove?.direction || 'right') === 'left';
  }

  if (document.getElementById('inputAutoMoveDirectionRight')) {
    document.getElementById('inputAutoMoveDirectionRight').checked =
      (TabManager.config.autoMove?.direction || 'right') === 'right';
  }

  if (document.getElementById('inputAutoMoveDelay')) {
    document.getElementById('inputAutoMoveDelay').value =
      Math.round((TabManager.config.autoMove?.delay || 3000) / 1000);
  }
}

// 更新徽标预览
async function updateBadgePreview() {
  try {
    // 获取当前窗口的标签
    const tabs = await chrome.tabs.query({});
    
    // 获取隐藏标签
    const hiddenTabs = TabManager.getHiddenTabs();
    
    // 计算用户标签数量（排除历史标签）
    const hiddenUserTabs = hiddenTabs.filter(tab => !tab.fromHistory);
    
    // 更新预览
    document.getElementById('badgePreviewHidden').textContent = hiddenTabs.length;
    document.getElementById('badgePreviewOpen').textContent = tabs.length;
    document.getElementById('badgePreviewUser').textContent = tabs.length + hiddenUserTabs.length;
    
  } catch (error) {
    // 静默处理错误
  }
}

// 渲染隐藏的标签列表
async function renderHiddenTabs() {
  const listElement = document.getElementById('listHiddenTabs');
  const emptyContainer = document.getElementById('emptyTabsContainer');
  
  // 清空列表
  listElement.innerHTML = '';
  
  // 获取隐藏标签
  const hiddenTabs = TabManager.getHiddenTabs();
  
  if (!hiddenTabs || hiddenTabs.length === 0) {
    // 显示空状态
    emptyContainer.style.display = 'flex';
    listElement.style.display = 'none';
    return;
  }
  
  // 显示列表
  emptyContainer.style.display = 'none';
  listElement.style.display = 'block';
  
  // 逆序显示（最新的在上面）
  hiddenTabs.slice().reverse().forEach(tab => {
    const li = document.createElement('li');
    
    // 创建标签信息区域
    const tabInfo = document.createElement('div');
    tabInfo.className = 'tab-info';
    
    // 添加favicon
    const favicon = document.createElement('img');
    if (tab.favIconUrl) {
      favicon.src = tab.favIconUrl;
    }
    favicon.alt = 'Favicon';
    favicon.className = 'favicon';
    tabInfo.appendChild(favicon);
    
    // 添加标题
    const title = document.createElement('div');
    title.className = 'tab-title';
    title.textContent = tab.title || tab.url;
    tabInfo.appendChild(title);
    
    // 创建操作区域
    const actions = document.createElement('div');
    actions.className = 'tab-actions';
    
    // 添加删除按钮
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete is-small';
    deleteBtn.setAttribute('data-action', 'delete');
    actions.appendChild(deleteBtn);
    
    // 组装元素
    li.appendChild(tabInfo);
    li.appendChild(actions);
    
    // 设置数据属性
    li.dataset.id = tab.id;
    li.dataset.url = tab.url;
    li.title = tab.title || tab.url;
    
    // 添加到列表
    listElement.appendChild(li);
  });
  
  // 更新徽标预览
  updateBadgePreview();
}

// 设置事件监听器
function setupEventListeners() {
  // 监听存储变化，更新界面
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    // 如果配置发生变化
    if ((areaName === 'sync' && changes.config) || 
        (areaName === 'local' && (changes.hiddenTabs || changes.activeTabHistory))) {
      // 如果是config变化，需要更新TabManager的本地config
      if (areaName === 'sync' && changes.config) {
        TabManager.config = changes.config.newValue;
      }
      
      // 如果是hiddenTabs变化，需要更新TabManager的本地hiddenTabs
      if (areaName === 'local' && changes.hiddenTabs) {
        TabManager.hiddenTabs = changes.hiddenTabs.newValue;
      }
      
      // 更新popup内容
      await updatePopupContent();
    }
  });



  // 活动状态复选框
  document.getElementById('inputActive').addEventListener('change', async evt => {
    TabManager.config.active = evt.target.checked;
    await TabManager.saveConfig();
    // 不需要手动更新，storage.onChanged事件会处理
  });
  
  // 自适应标签限制开关
  document.getElementById('inputAdaptiveLimit').addEventListener('change', async evt => {
    TabManager.config.adaptiveLimit = evt.target.checked;
    await TabManager.saveConfig();
    // 不需要手动更新，storage.onChanged事件会处理
  });
  
  // 每标签像素宽度输入框
  document.getElementById('inputPixelsPerTab').addEventListener('change', async evt => {
    const newValue = Math.max(100, Math.min(500, parseInt(evt.target.value) || 200));
    TabManager.config.pixelsPerTab = newValue;
    await TabManager.saveConfig();
    // 不需要手动更新，storage.onChanged事件会处理
  });
  
  // 标签限制输入框
  document.getElementById('inputTabsVisible').addEventListener('change', async evt => {
    const newValue = Math.max(1, parseInt(evt.target.value) || 20);
    TabManager.config.tabLimit = newValue;
    await TabManager.saveConfig();
    evt.target.value = newValue;
    // 不需要手动更新，storage.onChanged事件会处理
  });
  
  // 隐藏标签队列长度
  if (document.getElementById('inputTabsQueueLength')) {
    document.getElementById('inputTabsQueueLength').addEventListener('change', async evt => {
      const newValue = Math.max(1, parseInt(evt.target.value) || 80);
      TabManager.config.tabsQueueLength = newValue;
      await TabManager.saveConfig();
      evt.target.value = newValue;
      
      // 调整隐藏标签列表以符合新的长度限制
      const hiddenTabs = TabManager.getHiddenTabs();
      if (hiddenTabs && hiddenTabs.length > newValue) {
        // 如果当前隐藏标签数量超过新的限制，则移除多余的标签（从最旧的开始）
        TabManager.hiddenTabs = hiddenTabs.slice(hiddenTabs.length - newValue);
        await TabManager.saveHiddenTabs();
      }
      
      // 更新徽章和重新渲染隐藏标签列表
      TabManager.updateBadgeCount();
      renderHiddenTabs();
      updateBadgePreview();
    });
  }
  
  // 隐藏标签列表点击
  document.getElementById('listHiddenTabs').addEventListener('click', async evt => {
    const li = evt.target.closest('li');
    if (!li) return;
    
    const tabId = li.dataset.id;
    const url = li.dataset.url;
    const isDeleteButton = evt.target.classList.contains('delete');
    
    if (isDeleteButton) {
      // 删除隐藏标签
      if (TabManager.removeHiddenTab(tabId)) {
        await TabManager.saveHiddenTabs();
        TabManager.updateBadgeCount();
        li.remove();
        
        // 如果没有更多标签，显示空状态
        if (TabManager.getHiddenTabs().length === 0) {
          document.getElementById('emptyTabsContainer').style.display = 'flex';
          document.getElementById('listHiddenTabs').style.display = 'none';
        }
        
        // 更新徽标预览
        updateBadgePreview();
      }
    } else {
      // 恢复标签（点击其他区域）
      if (TabManager.removeHiddenTab(tabId)) {
        await TabManager.saveHiddenTabs();
        
        await chrome.tabs.create({
          active: !(evt.ctrlKey || evt.metaKey),
          url: url
        });
        
        TabManager.updateBadgeCount();
        li.remove();
        
        // 如果没有更多标签，显示空状态
        if (TabManager.getHiddenTabs().length === 0) {
          document.getElementById('emptyTabsContainer').style.display = 'flex';
          document.getElementById('listHiddenTabs').style.display = 'none';
        }
        
        // 更新徽标预览
        updateBadgePreview();
      }
    }
  });
  
  // 徽标模式选择
  document.getElementById('badgeModeHidden').addEventListener('change', async evt => {
    if (evt.target.checked) {
      TabManager.config.badgeMode = 'hidden';
      await TabManager.saveConfig();
      
      // 更新徽章
      TabManager.updateBadgeCount();
    }
  });
  
  document.getElementById('badgeModeOpen').addEventListener('change', async evt => {
    if (evt.target.checked) {
      TabManager.config.badgeMode = 'open';
      await TabManager.saveConfig();
      
      // 更新徽章
      TabManager.updateBadgeCount();
    }
  });
  
  document.getElementById('badgeModeUser').addEventListener('change', async evt => {
    if (evt.target.checked) {
      TabManager.config.badgeMode = 'user';
      await TabManager.saveConfig();

      // 更新徽章
      TabManager.updateBadgeCount();
    }
  });

  // 标签页自动移动事件监听器
  document.getElementById('inputAutoMoveEnabled').addEventListener('change', async evt => {
    if (!TabManager.config.autoMove) {
      TabManager.config.autoMove = { enabled: true, direction: 'left', delay: 3000 };
    }
    TabManager.config.autoMove.enabled = evt.target.checked;
    await TabManager.saveConfig();
  });

  document.getElementById('inputAutoMoveDirectionLeft').addEventListener('change', async evt => {
    if (evt.target.checked) {
      if (!TabManager.config.autoMove) {
        TabManager.config.autoMove = { enabled: true, direction: 'left', delay: 3000 };
      }
      TabManager.config.autoMove.direction = 'left';
      await TabManager.saveConfig();
    }
  });

  document.getElementById('inputAutoMoveDirectionRight').addEventListener('change', async evt => {
    if (evt.target.checked) {
      if (!TabManager.config.autoMove) {
        TabManager.config.autoMove = { enabled: true, direction: 'left', delay: 3000 };
      }
      TabManager.config.autoMove.direction = 'right';
      await TabManager.saveConfig();
    }
  });

  document.getElementById('inputAutoMoveDelay').addEventListener('change', async evt => {
    const newValue = Math.max(1, Math.min(60, parseInt(evt.target.value) || 3));
    if (!TabManager.config.autoMove) {
      TabManager.config.autoMove = { enabled: true, direction: 'left', delay: 3000 };
    }
    TabManager.config.autoMove.delay = newValue * 1000; // 转换为毫秒
    await TabManager.saveConfig();
    evt.target.value = newValue;
  });
}

// 切换自适应标签限制信息显示
function toggleAdaptiveInfo() {
  const adaptiveInfoContainer = document.getElementById('adaptiveInfoContainer');
  const adaptiveInfoContainer2 = document.getElementById('adaptiveInfoContainer2');
  const adaptiveInfoContainer3 = document.getElementById('adaptiveInfoContainer3');
  
  if (adaptiveInfoContainer && adaptiveInfoContainer2 && adaptiveInfoContainer3) {
    const display = TabManager.config.adaptiveLimit ? 'block' : 'none';
    adaptiveInfoContainer.style.display = display;
    adaptiveInfoContainer2.style.display = display;
    adaptiveInfoContainer3.style.display = display;
  }
}

// 更新自适应标签限制信息
async function updateAdaptiveInfo() {
  try {
    // 获取当前窗口
    const windows = await chrome.windows.getAll({windowTypes: ['normal']});
    
    // 使用当前窗口或第一个窗口
    let currentWindow = windows[0];
    for (const window of windows) {
      if (window.focused) {
        currentWindow = window;
        break;
      }
    }
    
    if (!currentWindow) return;
    
    // 获取窗口宽度
    const windowWidth = currentWindow.width;
    
    // 计算标签数量
    const pixelsPerTab = TabManager.config.pixelsPerTab;
    const calculatedLimit = Math.max(5, Math.floor(windowWidth / pixelsPerTab));
    
    // 获取实际标签限制（计算值和固定值的最小值）
    const effectiveLimit = Math.min(calculatedLimit, TabManager.config.tabLimit);
    
    // 更新UI
    document.getElementById('currentWindowWidth').value = `${windowWidth}px`;
    document.getElementById('calculatedTabLimit').value = `${calculatedLimit}`;
    document.getElementById('effectiveTabLimit').value = `${effectiveLimit}`;
  } catch (error) {
    // 静默处理错误
  }
}





// 当DOM加载完成时初始化
document.addEventListener('DOMContentLoaded', initPopup);