// popup-i18n.js

const i18nMap = [
  ["i18nTitle", "extName"],
  ["i18nHeaderTitle", "extName"],
  ["i18nSettingTitle", "settingTitle"],
  ["i18nBasicSetting", "basicSetting"],
  ["i18nEnableLimit", "enableLimit"],
  ["i18nTabLimit", "tabLimit"],
  ["i18nQueueLength", "queueLength"],
  ["i18nAutoMoveTitle", "autoMoveTitle"],
  ["i18nEnableAutoMove", "enableAutoMove"],
  ["i18nAutoMoveDesc", "autoMoveDesc"],
  ["i18nMoveDirection", "moveDirection"],
  ["i18nMoveToStart", "moveToStart"],
  ["i18nMoveToEnd", "moveToEnd"],
  ["i18nDelaySec", "delaySec"],
  ["i18nAdaptiveTitle", "adaptiveTitle"],
  ["i18nEnableAdaptive", "enableAdaptive"],
  ["i18nAdaptiveDesc", "adaptiveDesc"],
  ["i18nPixelsPerTab", "pixelsPerTab"],
  ["i18nCurrentWinWidth", "currentWinWidth"],
  ["i18nCalcTabLimit", "calcTabLimit"],
  ["i18nEffectiveTabLimit", "effectiveTabLimit"],
  ["i18nEffectiveDesc", "effectiveDesc"],
  ["i18nBadgeTitle", "badgeTitle"],
  ["i18nBadgeHidden", "badgeHidden"],
  ["i18nBadgeOpen", "badgeOpen"],
  ["i18nBadgeUser", "badgeUser"],
  ["i18nHiddenTabsTitle", "hiddenTabsTitle"],
  ["msgNoHiddenTabs", "msgNoHiddenTabs"],
  ["i18nEmptyDesc", "emptyDesc"]
];

document.addEventListener('DOMContentLoaded', () => {
  for (const [id, key] of i18nMap) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = chrome.i18n.getMessage(key);
    }
  }
  // title 特殊处理
  const titleEl = document.getElementById('i18nTitle');
  if (titleEl) {
    document.title = titleEl.textContent;
  }
}); 