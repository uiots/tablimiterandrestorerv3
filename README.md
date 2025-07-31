# Tab Limiter And Restorer V3

## 插件简介 | Introduction

本项目是原插件 Tab Limiter And Restorer 的 fork 并重构的 V3 版本。V3 版本进行了重大架构升级，专注于单窗口标签管理，全面支持 Chrome 插件 i18n 语言包机制，数据结构与界面均有较大优化。

This project is a fork and refactored V3 version of the original Tab Limiter And Restorer extension. V3 brings major architectural upgrades, focuses on single-window tab management, fully supports Chrome extension i18n locale mechanism, and features significant improvements in data structure and UI.

## 主要功能 | Features

- **标签数量限制**：可自定义每个窗口允许打开的最大标签数。
- **超限自动隐藏**：当标签数量超过限制时，自动隐藏最久未访问的标签。
- **空位自动恢复**：当标签数量低于限制且有隐藏标签时，自动恢复最近隐藏的标签。
- **隐藏标签队列**：可自定义隐藏标签的最大队列长度。
- **自适应标签限制**：可根据窗口宽度和每标签像素宽度自动调整标签数量上限。
- **标签页自动移动**：访问标签页后可延迟自动将其移动到窗口开头或末尾。
- **徽标显示模式**：支持显示当前打开标签数、隐藏标签数或用户标签总数。
- **多语言支持**：支持中文（简体）和英文，自动根据浏览器语言切换。

- **Tab limit**: Customize the maximum number of tabs allowed per window.
- **Auto-hide excess tabs**: Automatically hides the least recently used tabs when the limit is exceeded.
- **Auto-restore**: When there is space, automatically restores the most recently hidden tabs.
- **Hidden tabs queue**: Customize the maximum queue length for hidden tabs.
- **Adaptive tab limit**: Adjusts the tab limit based on window width and pixels per tab.
- **Auto-move tab**: Optionally move a tab to the start or end after a delay when visited.
- **Badge display modes**: Show open tab count, hidden tab count, or user tab total.
- **i18n support**: Supports Simplified Chinese and English, auto-switches based on browser language.

## 重要说明 | Important Notes

- **本版本已取消多窗口支持**，所有标签管理仅针对当前窗口。
- **近期进行了重大重构**，包括数据格式和存储结构的变更，升级后如遇兼容性问题（如旧版数据无法恢复），建议直接重载插件。
- **不再保证与旧版数据格式兼容**，如遇问题可反馈。

- **Multi-window support has been removed**; all tab management is for the current window only.
- **Major refactoring**: Data format and storage structure have changed. If you encounter compatibility issues after upgrading (e.g., old data cannot be restored), please reload the extension.
- **No guarantee of backward compatibility with old data formats**. Please report any issues.

## 安装与使用 | Installation & Usage

1. 克隆或下载本项目源码。
2. 在 Chrome 浏览器地址栏输入 `chrome://extensions/`，打开扩展管理页面。
3. 开启“开发者模式”，点击“加载已解压的扩展程序”，选择本项目根目录。
4. 安装后，点击浏览器右上角插件图标即可打开弹窗界面。
5. 在弹窗中可自定义各项设置，管理隐藏标签，体验自动隐藏与恢复功能。

1. Clone or download this repository.
2. Go to `chrome://extensions/` in your Chrome browser.
3. Enable "Developer mode", click "Load unpacked", and select the project root directory.
4. After installation, click the extension icon in the top-right to open the popup.
5. Customize settings and manage hidden tabs in the popup.

## 国际化（多语言）说明 | i18n (Locale) Support

- 插件已支持英文（en）和简体中文（zh_CN）两种语言。
- 默认显示英文，若浏览器语言为中文则自动切换为中文界面。
- 所有界面文本均通过 Chrome 插件标准 i18n 机制动态填充。

- English (en) and Simplified Chinese (zh_CN) are supported.
- English is the default; if your browser language is Chinese, the UI will switch automatically.
- All UI text is dynamically filled using the Chrome extension i18n mechanism.

## 近期主要更新（2.0.1）| Recent Updates (2.0.1)

- fork 并重构为 V3 版本，全面升级架构。
- 取消多窗口支持，专注单窗口标签管理。
- 全面支持 Chrome 插件标准多语言（locale）机制，自动根据浏览器语言切换界面。
- 所有界面文本国际化，支持中英文切换。
- 代码结构优化，国际化填充逻辑独立为 popup-i18n.js，便于维护和扩展。
- 进一步精简和优化 hiddenTabs 相关数据结构和类型检查。
- 版本号升级为 2.0.1。

- Forked and refactored as V3, with a complete architecture upgrade.
- Multi-window support removed; now focused on single-window tab management.
- Full support for Chrome extension locale (i18n) mechanism; UI auto-switches language.
- All UI text internationalized; supports both English and Chinese.
- Code structure optimized; i18n logic separated into popup-i18n.js for maintainability.
- Further streamlined and optimized hiddenTabs data structure and type checks.
- Version updated to 2.0.1.

## 目录结构简述 | Directory Structure

```
├── _locales/           # 多语言包 / Locale files
│   ├── en/messages.json
│   └── zh_CN/messages.json
├── src/
│   ├── background/background.js   # 后台主逻辑 / Background logic
│   └── popup/
│       ├── popup.html             # 弹窗页面 / Popup page
│       ├── popup.js               # 弹窗主逻辑 / Popup logic
│       └── popup-i18n.js          # 弹窗国际化填充 / Popup i18n
├── manifest.json       # 插件清单 / Manifest
└── README.md           # 项目说明 / Readme
```

## 反馈与支持 | Feedback & Support

如有建议、Bug 反馈或功能需求，欢迎通过邮箱 **uiotsution@gmail.com** 或直接提交 Issue 联系作者。

For suggestions, bug reports, or feature requests, please contact **uiotsution@gmail.com** or submit an Issue.

---

**Tab Limiter And Restorer V3** —— 让你的浏览器标签管理更高效！

**Tab Limiter And Restorer V3** — Make your browser tab management more efficient! 