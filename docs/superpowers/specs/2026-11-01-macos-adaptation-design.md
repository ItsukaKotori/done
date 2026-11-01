# macOS 适配（macOS Adaptation）设计规格

## 摘要

将 WhchemTodo 从 Windows 专属适配为双平台应用：macOS 上获得原生体验（红绿灯窗口按钮、模板化菜单栏图标、Cmd 系快捷键、mac 惯例的关窗行为、应用菜单、DMG 构建），同时 Windows 现状完全不变。适配深度为**完整 mac 化**；Dock 形态为**保留 Dock 图标的常规应用**；构建产物为**本地 arm64 无签名 DMG**。

## 动机

应用当前零平台分支，处处是 Windows 假设：nsis 构建 + ico 图标、`displayBalloon`（Windows 专属 API）、自绘 Windows 三键标题栏（mac 红绿灯被 `frame: false` 整个隐藏）、`Ctrl+Alt+*` 默认热键、关窗=隐藏到托盘 + 气泡提示。这些在 macOS 上要么失效（displayBalloon）、要么不符合惯例（自绘三键、Ctrl 系快捷键），且 `npm run build:mac` 不存在，无法在 Mac 上产出可安装的应用。

## 决策记录

| 决策点 | 选择 | 理由 |
|---|---|---|
| 适配深度 | 完整 mac 化 | 原生红绿灯、模板托盘图标、Cmd 系热键、mac 惯例行为；Windows 现状不变 |
| Dock 形态 | 保留 Dock 图标 | 应用有完整主窗，纯菜单栏应用不符 mac 惯例；菜单栏图标降级为快捷入口 |
| 关窗行为（mac） | 红=关窗，应用留后台 | mac 惯例（参照 Finder/Mail）；提醒链路在主进程，不受影响；重开走 Dock/菜单栏/热键 |
| 平台分支组织 | 中央 platform.ts + 局部 if | 仅 2 平台约 5 处分歧，适配器接口属过度设计（YAGNI） |
| 签名 | 不签名（`identity: null`） | 个人使用；首次打开右键→打开或 `xattr -cr` 放行 Gatekeeper |
| 架构/产物 | dmg / arm64 | 本机 Apple Silicon；zip（自动更新用）v1 不需要，`publish: null` 已预留 |
| 菜单栏图标 | 模板图（黑对勾+alpha） | 随系统明暗自动反色，mac 惯例 |
| mac 默认热键 | `Alt+Cmd+A/W/S`（Option+Cmd） | mac 全局热键惯例；与 Windows `Ctrl+Alt+*` 同构 |
| 高清图标 | 程序化重绘 1024px 母版 | 现有源图仅 256px，直接放大在 Dock/访达中发糊；图标为简单几何（圆角方块+对勾），可程序化重绘 |

## 架构总览

平台差异收敛在一处配置模块，各分歧点就地分支：

```
src/main/platform.ts          ← 新增：IS_MAC + defaultsFor(platform)（纯函数，可单测）
src/renderer/src/lib/platform.ts  ← 新增：渲染层 isMac（userAgent 判断）

分歧点（改动落点）：
src/main/windows.ts           ← 窗口参数、关窗行为、托盘图标/点击、应用菜单、destroyed 防护
src/main/index.ts             ← app.on('activate')
src/main/shortcuts.ts         ← 默认热键改从 platform.ts 取
src/renderer/src/components/Titlebar.tsx      ← mac 隐藏三键、让位红绿灯
src/renderer/src/components/HotkeyRecorder.tsx ← Cmd 键捕获显示
src/renderer/src/components/ShortcutsDialog.tsx ← 快捷键文案平台感知
src/renderer/src/lib/keyboard-nav.ts          ← ctrlKey || metaKey
scripts/make-icon.mjs         ← icns + 模板托盘图标生成
electron-builder.yml          ← mac 块
package.json                  ← build:mac 脚本
```

### `src/main/platform.ts`

```ts
export const IS_MAC = process.platform === 'darwin';

export interface PlatformDefaults {
  quickAddHotkey: string;
  showMainHotkey: string;
  toggleStripHotkey: string;
  trayIconPath: string;        // 相对 __dirname 解析
  trayIconTemplate: boolean;   // mac=true（trayTemplate.png，自动反色）
  showTrayBubble: boolean;     // Windows displayBalloon 提示，mac=false
}

export function defaultsFor(platform: NodeJS.Platform): PlatformDefaults;
export const PLATFORM: PlatformDefaults;  // = defaultsFor(process.platform)
```

`defaultsFor` 为纯函数，单测直接喂 `'darwin' | 'win32'` 断言两组默认值。

渲染层 `lib/platform.ts`：`export const isMac = /Mac/i.test(navigator.userAgent)`（sandbox 渲染层 process 不可靠；userAgent 判断是前端惯例）。

## 主窗与标题栏

### 窗口参数（`createMain`）

```ts
// mac：红绿灯保留，内容延伸到标题栏区域
titleBarStyle: 'hiddenInset',
trafficLightPosition: { x: 12, y: 12 },   // 红绿灯 12px 直径，垂直居中于 h-9（36px）标题栏
// win：维持 frame: false + titleBarStyle: 'hidden'
```

mac 分支不再传 `frame: false`（否则红绿灯被移除）。`show: false`、`ready-to-show`、崩溃自动 reload 等其余参数两平台一致。

### Titlebar.tsx（渲染层）

- mac：隐藏自绘的最小化/最大化/关闭三键（红绿灯归系统）；「收缩为长条」按钮保留在右侧；品牌铭牌 `ps` 加大到约 `ps-20`（80px）让位红绿灯区。
- Windows：现状不变。

### 关窗行为（`close` 事件）

现逻辑（`preventDefault + hide + displayBalloon 首次气泡`）整体包进 `!IS_MAC` 分支。mac 直接放行：窗口销毁，`window-all-closed` 已是 no-op，应用留后台，菜单栏图标与提醒继续。

### 重开入口（mac）

`src/main/index.ts` 增加：

```ts
if (IS_MAC) app.on('activate', () => windows?.showMain());
```

`showMain` 已有 `isDestroyed → createMain` 重建路径；菜单栏图标、全局热键、通知点击入口现成。

### destroyed 防护（顺带加固）

Windows 上主窗永不销毁（关=hide），mac 上会。`AppWindowController` 中所有 `this.main?.` 裸引用（`broadcastChanged`、`minimize`、`maximizeToggle`、`hideToTray`、`createMain` 的 close 回调等）补 `isDestroyed()` 防护，模式同现有 `showMain`。

## 应用菜单（mac 专属）

mac 在 bootstrap 阶段 `Menu.setApplicationMenu(buildMacMenu())`；Windows 维持 `main.setMenu(null)` 现状（该调用仅 win 分支执行）。

菜单结构（全部用 role，自动获得标准快捷键与本地化行为）：

- **App**：about（关于 WhchemTodo）｜ hide/hideOthers/unhide ｜ quit
- **Edit**：undo/redo/cut/copy/paste/selectAll —— 没有它 mac 输入框无法 Cmd+C/V
- **View**：reload/toggleDevTools ｜ togglefullscreen
- **Window**：minimize/zoom ｜ front

「设置…」项：点击 → `showMain({ openSettings: true })`，`ShowMainPayload` 增加可选字段 `openSettings?: boolean`，渲染层 `EventShowMain` 处理器收到后切换到 SettingsView（复用现有视图切换机制）。这是 role 之外唯一自定义项。

## 菜单栏图标（TrayManager）

- **图标**：mac 用 `trayTemplate.png`（16×16）+ `trayTemplate@2x.png`（32×32）——纯黑对勾 + alpha，文件名 `Template` 后缀使 Electron 自动置 `isTemplateImage`，随系统明暗反色。Windows 维持 `resources/icon.png` 缩至 16px 彩色图。路径与模板标记来自 `PLATFORM`。
- **点击行为**：mac 设 contextMenu 后左键只会弹菜单，故 mac 上 `click` → `showMain()`、`right-click` → `tray.popUpContextMenu(menu)`；Windows 维持 `setContextMenu` + click/double-click。菜单内容（打开主窗口/今日待办计数/暂停提醒/退出）两平台一致，仅挂载方式分叉：内部 `buildMenu(): Menu` 供两分支复用，计数刷新重建。
- **气泡**：`displayBalloon` 调用（首次关窗提示）由 `PLATFORM.showTrayBubble` 门控，mac 不弹。

## 全局快捷键

- `shortcuts.ts` 的 `DEFAULT_*` 常量改由 `PLATFORM` 提供：mac `Alt+Cmd+A / Alt+Cmd+W / Alt+Cmd+S`，win `Ctrl+Alt+A/W/S`。注册/回滚逻辑（ShortcutSlot）与 `globalShortcut` 本身跨平台，不动。
- 设置库中已存的热键字符串优先于默认值，逻辑不变（新 mac 安装库为空 → 取 mac 默认）。
- **HotkeyRecorder**：捕获映射 `{ ctrlKey→Ctrl, altKey→Alt, metaKey→Super }` 已含 Cmd（mac 上 metaKey=Cmd，accelerator `Super` 在 mac 映射为 Cmd，可注册）。仅改显示：mac 上 `Super` 显示为 `Cmd`。
- **ShortcutsDialog**：写死的 `Ctrl+Alt+A` 等行改为平台感知文案（mac 显示 `Alt+Cmd+A` 文本风格，与 HotkeyRecorder 的显示规则一致）；`Ctrl+F` 行同理（mac 显示 `Cmd+F`）。
- **keyboard-nav**：搜索/快捷键判定 `e.ctrlKey` → `(e.ctrlKey || e.metaKey)`（Windows 无感，mac 生效）。

## 图标与构建

### make-icon.mjs 扩展

现有行为（拷贝 png + 生成 ico）不变，追加 darwin 分支：

1. **程序化重绘**：SVG 字符串（圆角方块渐变底 + 白对勾 + 橙色光点，仿现有 256px 图）→ Electron 离屏 `BrowserWindow` 加载渲染 → `capturePage` 产出 1024px 母版 `build/icon-1024.png`（复用项目自身 electron 依赖，`npx electron scripts/…`，零新增 npm 依赖）。
2. **icns**：`iconset` 目录 + `sips -z` 缩出 16/32/128/256/512 及 @2x → `iconutil -c icns` → `build/icon.icns`。
3. **模板托盘图标**：对勾轮廓 SVG 同法渲染 16/32px → `build/trayTemplate{,@2x}.png`。

生成物与现有 `build/icon.{png,ico}` 一致地纳入版本库。

### electron-builder.yml

```yaml
mac:
  icon: build/icon.icns
  category: public.app-category.productivity
  identity: null            # 跳过签名
  target:
    - target: dmg
      arch: [arm64]
```

`npmRebuild: false` 与 `asarUnpack: node_modules/better-sqlite3/**` 不动：better-sqlite3@13 为 N-API prebuildify，自带 darwin-arm64 预编译二进制，Mac 上直接复用（构建时验证；若缺失再走 `db:electron` electron-rebuild，属兜底不在本规格内）。

### package.json

```json
"build:mac": "npm run make-icon && npm run build && electron-builder --mac --arm64"
```

产物：`WhchemTodo-<version>-arm64.dmg`。

## 原样保留（已确认跨平台）

数据目录（`app.getPath('appData')` → `~/Library/Application Support/whchem-todo`）、单实例锁、`setLoginItemSettings`（openAtLogin + `--hidden` 参数 mac 支持）、通知点击链路（macOS 13+ 首次通知弹系统权限授权，已有设置页警示兜底）、`powerMonitor` 睡眠唤醒重排、CSP 注入、dev HMR、quickAdd 失焦隐藏、strip 无边框自由拖拽缩放（`skipTaskbar` 在 mac 为无害 no-op）。

## 测试

### 单元测试

- `tests/unit/platform.test.ts`（新增）：`defaultsFor('darwin')` 与 `defaultsFor('win32')` 两组默认值断言（热键、图标模板标记、气泡开关）。
- `tests/unit/keyboard-nav.test.ts`（扩展）：metaKey 触发与 ctrlKey 等价的用例。
- 渲染层 `lib/platform.ts` 的 `isMac`：userAgent 串断言（Mac/Windows 样本）。

### 手动验收清单（本机 Apple Silicon macOS 27）

1. `npm run build:mac` 产出 DMG；安装（拖入 Applications）后右键→打开放行 Gatekeeper
2. 主窗红绿灯可见且垂直居中；红=关窗后应用留后台（菜单栏图标在、提醒照常）、Dock 点击重开主窗
3. 菜单栏图标为对勾模板图，浅色/深色外观下自动反色；左键开主窗、右键弹菜单（计数正确）
4. 三个全局热键（Option+Cmd+A/W/S）生效；设置页重录（含 Cmd 键）生效并持久化
5. 应用菜单：Edit roles 使输入框 Cmd+C/V 可用；「设置…」直达设置页；Cmd+Q 正常退出（托盘清理、无僵尸进程）
6. 通知：首次触发弹系统权限授权；允许后提醒送达、点击定位任务；拒绝后设置页出现警示
7. 长条：收缩/展开/拖拽/几何记忆正常；快添窗失焦隐藏
8. 数据落在 `~/Library/Application Support/whchem-todo`；自启开关生效
9. Windows 回归：`build:win` 产物行为不变（代码评审层面确认所有分支有 `IS_MAC` 门控，无 mac 逻辑泄漏进 win 路径）
