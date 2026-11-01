# macOS 适配实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 WhchemTodo 适配为 Windows/macOS 双平台应用，mac 获得原生体验（红绿灯、模板菜单栏图标、Cmd 系热键、应用菜单、DMG 构建），Windows 零回归。

**Architecture:** 平台差异收敛在 `src/main/platform.ts`（`IS_MAC` + `defaultsFor(platform)` 纯函数），各分歧点（窗口参数/关窗行为/托盘/热键默认/菜单）就地 `if` 分支。渲染层用 UA 判断。mac 图标程序化重绘（Electron 离屏渲染 → icns/模板图）。

**Tech Stack:** Electron 45 + electron-vite 6 + React 19 + TypeScript + vitest + electron-builder 26（dmg/arm64）

**Spec:** `docs/superpowers/specs/2026-11-01-macos-adaptation-design.md`（本计划依据规格编写，执行时两份一起读）

## Global Constraints

- Windows 行为零回归：所有平台分支必须经 `IS_MAC` / `PLATFORM` 门控，禁止让 mac 逻辑泄漏进 win 路径
- 不新增任何 npm 依赖；mac 图标复用项目自身 electron 依赖离屏渲染
- `src/main/platform.ts` 不得 import 任何 electron 模块（保持 vitest node 环境可测）
- Electron 加速器语法：mac 上 `Alt`=Option、`Cmd`/`Super`=Cmd；存储串保持 `Super`，显示层才转 `Cmd`
- 本机 Apple Silicon（arm64）、macOS 27；构建产物仅 arm64、不签名（`identity: null`）
- 提交信息结尾加：`Co-Authored-By: Claude Code <noreply@anthropic.com>`
- 单测命令：`npx vitest run tests/unit/<file>`；全量 `npm run typecheck && npm test`

---

### Task 1: 平台配置中枢 `src/main/platform.ts` + 快捷键默认值

**Files:**
- Create: `src/main/platform.ts`
- Modify: `src/main/shortcuts.ts:1-6`
- Test: `tests/unit/platform.test.ts`

**Interfaces:**
- Consumes: 无（全新模块，不 import electron）
- Produces: `IS_MAC: boolean`、`defaultsFor(platform: NodeJS.Platform): PlatformDefaults`、`PLATFORM: PlatformDefaults`；`PlatformDefaults = { quickAddHotkey; showMainHotkey; toggleStripHotkey; trayIconName: string; trayIconTemplate: boolean; showTrayBubble: boolean }`。后续 Task 3/4/5 直接消费。

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/platform.test.ts
import { describe, it, expect } from 'vitest';
import { defaultsFor, IS_MAC } from '../../src/main/platform';

describe('defaultsFor', () => {
  it('mac 默认热键为 Alt+Cmd 系', () => {
    const d = defaultsFor('darwin');
    expect(d.quickAddHotkey).toBe('Alt+Cmd+A');
    expect(d.showMainHotkey).toBe('Alt+Cmd+W');
    expect(d.toggleStripHotkey).toBe('Alt+Cmd+S');
  });

  it('win 默认热键为 Ctrl+Alt 系', () => {
    const d = defaultsFor('win32');
    expect(d.quickAddHotkey).toBe('Ctrl+Alt+A');
    expect(d.showMainHotkey).toBe('Ctrl+Alt+W');
    expect(d.toggleStripHotkey).toBe('Ctrl+Alt+S');
  });

  it('托盘：mac 用模板图、无气泡；win 彩色图、有气泡', () => {
    const mac = defaultsFor('darwin');
    expect(mac.trayIconName).toBe('trayTemplate.png');
    expect(mac.trayIconTemplate).toBe(true);
    expect(mac.showTrayBubble).toBe(false);
    const win = defaultsFor('win32');
    expect(win.trayIconName).toBe('icon.png');
    expect(win.trayIconTemplate).toBe(false);
    expect(win.showTrayBubble).toBe(true);
  });

  it('其余平台按 win 处理', () => {
    expect(defaultsFor('linux').quickAddHotkey).toBe('Ctrl+Alt+A');
  });

  it('IS_MAC 与进程平台一致', () => {
    expect(IS_MAC).toBe(process.platform === 'darwin');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/platform.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/main/platform.ts`**

```ts
/** 平台差异集中处：仅本文件判断 process.platform，其余模块消费 IS_MAC/PLATFORM */
export const IS_MAC = process.platform === 'darwin';

export interface PlatformDefaults {
  quickAddHotkey: string;
  showMainHotkey: string;
  toggleStripHotkey: string;
  /** 托盘图标文件名，位于打包根 resources/ 下 */
  trayIconName: string;
  /** true = 模板图（文件名 Template 后缀，Electron 自动标记，系统按明暗反色） */
  trayIconTemplate: boolean;
  /** Windows 专属：首次关窗隐藏时的 displayBalloon 提示 */
  showTrayBubble: boolean;
}

const WIN: PlatformDefaults = {
  quickAddHotkey: 'Ctrl+Alt+A',
  showMainHotkey: 'Ctrl+Alt+W',
  toggleStripHotkey: 'Ctrl+Alt+S',
  trayIconName: 'icon.png',
  trayIconTemplate: false,
  showTrayBubble: true,
};

const MAC: PlatformDefaults = {
  quickAddHotkey: 'Alt+Cmd+A',
  showMainHotkey: 'Alt+Cmd+W',
  toggleStripHotkey: 'Alt+Cmd+S',
  trayIconName: 'trayTemplate.png',
  trayIconTemplate: true,
  showTrayBubble: false,
};

export function defaultsFor(platform: NodeJS.Platform): PlatformDefaults {
  return platform === 'darwin' ? MAC : WIN;
}

export const PLATFORM: PlatformDefaults = defaultsFor(process.platform);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/platform.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: shortcuts.ts 默认值改从 PLATFORM 取**

`src/main/shortcuts.ts` 头部（1-6 行）替换为：

```ts
import { globalShortcut } from 'electron';
import log from 'electron-log/main';
import { PLATFORM } from './platform';

export const DEFAULT_HOTKEY = PLATFORM.quickAddHotkey;
export const DEFAULT_SHOW_MAIN_HOTKEY = PLATFORM.showMainHotkey;
export const DEFAULT_TOGGLE_STRIP_HOTKEY = PLATFORM.toggleStripHotkey;
```

文件其余部分（ShortcutSlot 等）不动。

- [ ] **Step 6: typecheck + 全量测试**

Run: `npm run typecheck && npm test`
Expected: 全部 PASS

- [ ] **Step 7: 提交**

```bash
git add src/main/platform.ts src/main/shortcuts.ts tests/unit/platform.test.ts
git commit -m "feat: add platform defaults module, mac hotkeys default to Alt+Cmd

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 渲染层平台判断 + 快捷键显示（HotkeyRecorder / ShortcutsDialog）

**Files:**
- Create: `src/renderer/src/lib/platform.ts`
- Modify: `src/renderer/src/components/HotkeyRecorder.tsx:23,29,44`
- Modify: `src/renderer/src/components/ShortcutsDialog.tsx:1-24`
- Test: `tests/unit/renderer-platform.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `isMacUserAgent(ua: string): boolean`、`isMac: boolean`、`displayAcceleratorFor(acc: string, mac: boolean): string`、`displayAccelerator(acc: string): string`（`@/lib/platform`）。`Ctrl+F` 等应用内快捷键已在 `AllTasksView.tsx:37`、`QuickAddView.tsx:68` 兼容 `metaKey`，无需改动。

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/renderer-platform.test.ts
import { describe, it, expect } from 'vitest';
import { isMacUserAgent, displayAcceleratorFor } from '@/lib/platform';

const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Electron/45.0.0';
const WIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Electron/45.0.0';

describe('isMacUserAgent', () => {
  it('Mac UA 命中', () => {
    expect(isMacUserAgent(MAC_UA)).toBe(true);
  });

  it('Windows UA 不命中', () => {
    expect(isMacUserAgent(WIN_UA)).toBe(false);
  });

  it('iOS「like Mac OS X」措辞不误判', () => {
    expect(isMacUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe(false);
  });
});

describe('displayAcceleratorFor', () => {
  it('mac 上 Super 显示为 Cmd', () => {
    expect(displayAcceleratorFor('Super+Alt+A', true)).toBe('Cmd+Alt+A');
  });

  it('win 原样显示', () => {
    expect(displayAcceleratorFor('Ctrl+Alt+A', false)).toBe('Ctrl+Alt+A');
  });
});
```

（注：模块顶层 `isMac` 读取 `navigator`，Node 22 自带该全局、值为 Node UA，import 不炸；测试只测纯函数。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/renderer-platform.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/renderer/src/lib/platform.ts`**

```ts
/** 渲染层平台判断：sandbox 下 process 不可靠，用 UA（Electron UA 含 "Macintosh"） */
export function isMacUserAgent(ua: string): boolean {
  return /\bMacintosh\b/.test(ua);
}

export const isMac = isMacUserAgent(navigator.userAgent);

/** 展示用：mac 上 accelerator 里的 Super 实为 Cmd 键（存储串保持 Super 不动） */
export function displayAcceleratorFor(acc: string, mac: boolean): string {
  return mac ? acc.replace(/\bSuper\b/g, 'Cmd') : acc;
}

export const displayAccelerator = (acc: string): string => displayAcceleratorFor(acc, isMac);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/renderer-platform.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: HotkeyRecorder 显示层转 Cmd**

`src/renderer/src/components/HotkeyRecorder.tsx` 三处改动：

```tsx
import { displayAccelerator } from '@/lib/platform';
```

第 29 行 toast：

```tsx
        toast.success(`快捷键已更新为 ${displayAccelerator(acc)}`);
```

第 44 行按钮文案：

```tsx
      {recording ? '按下新快捷键…（Esc 取消）' : displayAccelerator(value)}
```

第 23 行 mods 捕获逻辑不动（`metaKey→'Super'` 存储串，mac 上 Super=Cmd 可注册）。

- [ ] **Step 6: ShortcutsDialog 平台感知文案**

`src/renderer/src/components/ShortcutsDialog.tsx` 顶部数组替换为：

```tsx
import { isMac } from '@/lib/platform';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const GLOBAL_KEYS: Array<[string, string]> = isMac
  ? [
      ['Alt+Cmd+A', '快速添加窗口'],
      ['Alt+Cmd+W', '呼出主界面'],
      ['Alt+Cmd+S', '呼出 / 收起长条'],
    ]
  : [
      ['Ctrl+Alt+A', '快速添加窗口'],
      ['Ctrl+Alt+W', '呼出主界面'],
      ['Ctrl+Alt+S', '呼出 / 收起长条'],
    ];

const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: '全局（系统级）',
    items: GLOBAL_KEYS,
  },
  {
    title: '应用内',
    items: [
      [isMac ? 'Cmd+F' : 'Ctrl+F', '在「全部任务」中搜索'],
      ['j / k', '今日视图上 / 下选择任务'],
      ['x', '完成 / 取消完成选中任务'],
      ['Space', '开始 / 暂停选中任务计时'],
      ['Enter', '编辑选中任务'],
      ['Esc', '取消选择 / 清空搜索'],
      ['?', '显示本帮助'],
    ],
  },
];
```

组件体不动。

- [ ] **Step 7: typecheck + 全量测试**

Run: `npm run typecheck && npm test`
Expected: 全部 PASS

- [ ] **Step 8: 提交**

```bash
git add src/renderer/src/lib/platform.ts src/renderer/src/components/HotkeyRecorder.tsx src/renderer/src/components/ShortcutsDialog.tsx tests/unit/renderer-platform.test.ts
git commit -m "feat: renderer platform util, mac-aware hotkey display

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 主窗参数、关窗行为与销毁防护（windows.ts）

**Files:**
- Modify: `src/main/windows.ts:110-137`（createMain）、`179-207`（WindowOps 方法）
- Test: 无自动化（BrowserWindow 需运行中的 Electron，项目无此类测试基建）——验证靠 typecheck + 既有测试回归 + Task 8 打包冒烟

**Interfaces:**
- Consumes: `IS_MAC`（Task 1）
- Produces: 无新接口；`AppWindowController` 的 `broadcastChanged/minimize/maximizeToggle/hideToTray` 在主窗已销毁时变为安全 no-op（Task 4/5 依赖此防护）

- [ ] **Step 1: 引入 IS_MAC**

`src/main/windows.ts` import 区（第 8 行后）加：

```ts
import { IS_MAC } from './platform';
```

- [ ] **Step 2: createMain 窗口参数与关窗行为**

替换 `createMain`（110-137 行）为：

```ts
  createMain(hidden: boolean): BrowserWindow {
    this.main = new BrowserWindow({
      width: 1200, height: 750, minWidth: 960, minHeight: 600,
      show: false,
      backgroundColor: '#0b0b0d',
      // mac：保留系统红绿灯（hiddenInset 内容铺满全窗，微调位置垂直居中于 h-9 标题栏）
      // win：无边框自绘三键（titleBarStyle 仅 mac 生效，win 靠 frame:false）
      ...(IS_MAC
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 12 } }
        : { frame: false, titleBarStyle: 'hidden' as const }),
      webPreferences: AppWindowController.baseWebPreferences(),
    });
    this.loadWindow(this.main);
    this.main.once('ready-to-show', () => { if (!hidden) this.main?.show(); });
    // win：规格 §4.2 关窗=隐藏到托盘（退出只走托盘菜单），首次气泡提示
    // mac：红=关窗，应用留后台（window-all-closed no-op），重开走 Dock/菜单栏/热键
    this.main.on('close', (e) => {
      if (this.quitting || IS_MAC) return;
      e.preventDefault();
      this.main?.hide();
      if (!bubbleShown) {
        bubbleShown = true;
        TrayManager.instance?.tray.displayBalloon({
          title: 'WhchemTodo 在后台运行',
          content: '提醒将继续送达。彻底退出请右键托盘图标 → 退出。',
        });
      }
    });
    // 规格 §6：渲染进程崩溃自动 reload；提醒链路（主进程）不受影响
    this.main.webContents.on('render-process-gone', () => {
      if (this.main && !this.main.isDestroyed()) this.main.webContents.reload();
    });
    this.main.setMenu(null);
    return this.main;
  }
```

- [ ] **Step 3: WindowOps 销毁防护**

替换 `broadcastChanged`/`minimize`/`maximizeToggle`/`hideToTray`（179-202 行）为：

```ts
  broadcastChanged(): void {
    // mac 上主窗可被真正关闭销毁（win 永远只是 hide），发送前必须判断
    if (this.main && !this.main.isDestroyed()) this.main.webContents.send(Ipc.EventDataChanged);
    if (this.strip && !this.strip.isDestroyed()) this.strip.webContents.send(Ipc.EventDataChanged);
    this.emitter.emit('changed'); // 主进程本地订阅（托盘计数刷新）
  }

  onChangedBroadcast(cb: () => void): () => void {
    this.emitter.on('changed', cb);
    return () => this.emitter.off('changed', cb);
  }

  minimize(): void {
    if (this.main && !this.main.isDestroyed()) this.main.minimize();
  }

  maximizeToggle(): void {
    if (!this.main || this.main.isDestroyed()) return;
    if (this.main.isMaximized()) this.main.unmaximize();
    else this.main.maximize();
  }

  hideToTray(): void {
    if (this.main && !this.main.isDestroyed()) this.main.hide();
    if (this.strip && !this.strip.isDestroyed()) this.strip.hide();
  }
```

- [ ] **Step 4: typecheck + 全量测试**

Run: `npm run typecheck && npm test`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/windows.ts
git commit -m "feat: mac native traffic lights on main window, close-to-quit-window, destroyed guards

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3b: 标题栏 mac 化（Titlebar.tsx）

**Files:**
- Modify: `src/renderer/src/components/Titlebar.tsx`（全文件）
- Test: 无自动化（React 组件渲染，项目测试基建只覆盖纯函数）——验证靠 typecheck + Task 8 冒烟人眼确认

**Interfaces:**
- Consumes: `isMac`（Task 2，`@/lib/platform`）、`window.api.win.*`（现有 preload API）
- Produces: 无新接口；mac 上标题栏只保留拖拽区 + 品牌铭牌 +「收缩为长条」按钮，窗口控制归系统红绿灯

- [ ] **Step 1: 改造 Titlebar.tsx**

全文件替换为：

```tsx
import type { CSSProperties } from 'react';
import { ChevronDown, Minus, Square, X } from 'lucide-react';
import { isMac } from '@/lib/platform';

// Chromium 私有的窗口拖拽区域声明
const dragRegion = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDragRegion = { WebkitAppRegion: 'no-drag' } as CSSProperties;

/** 无边框主窗的标题栏：拖拽区 + win 自绘三键；mac 上窗口控制归系统红绿灯（规格 §5） */
export function Titlebar() {
  return (
    <div
      style={dragRegion}
      className="flex h-9 shrink-0 items-center justify-end border-b border-border"
    >
      {/* 仪器铭牌：全站唯一的品牌露出；mac 左移让位红绿灯（ps-20 ≈ 红绿灯区宽） */}
      <span className={`me-auto flex items-center gap-2 select-none ${isMac ? 'ps-20' : 'ps-3'}`}>
        <span className="size-1.5 rounded-full bg-primary" />
        <span className="font-mono text-[11px] tracking-[0.2em] text-muted-foreground">
          WHCHEMTODO
        </span>
      </span>
      <button
        style={noDragRegion}
        className="flex h-9 w-11 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="收缩为长条"
        onClick={() => void window.api.win.collapseStrip()}
      >
        <ChevronDown className="size-3.5" />
      </button>
      {/* win：自绘三键（关窗=隐藏到托盘）；mac：红绿灯归系统，红=关窗应用留后台 */}
      {!isMac && (
        <>
          <button
            style={noDragRegion}
            className="flex h-9 w-11 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="最小化"
            onClick={() => void window.api.win.minimize()}
          >
            <Minus className="size-3.5" />
          </button>
          <button
            style={noDragRegion}
            className="flex h-9 w-11 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="最大化或还原"
            onClick={() => void window.api.win.maximizeToggle()}
          >
            <Square className="size-3" />
          </button>
          <button
            style={noDragRegion}
            className="flex h-9 w-11 items-center justify-center text-muted-foreground hover:bg-overdue hover:text-white"
            aria-label="隐藏到托盘"
            onClick={() => void window.api.win.hideToTray()}
          >
            <X className="size-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: typecheck + 全量测试**

Run: `npm run typecheck && npm test`
Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/Titlebar.tsx
git commit -m "feat: titlebar defers to native traffic lights on mac

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: mac 应用菜单 + 「设置…」直达设置页

**Files:**
- Modify: `src/shared/ipc.ts:75-78`（ShowMainPayload）
- Modify: `src/main/windows.ts`（AppWindowController 新增方法）
- Modify: `src/main/index.ts:102`（createMain 之后）、`168`（second-instance 附近）
- Modify: `src/renderer/src/views/MainShell.tsx:37-51`（onShowMain 处理器）

**Interfaces:**
- Consumes: `IS_MAC`（Task 1）、`showMain(payload?: ShowMainPayload)`（现有）
- Produces: `ShowMainPayload.openSettings?: boolean`（shared/ipc.ts）；`AppWindowController.installMacAppMenu(): void`；mac Dock 点击 → `showMain()`

- [ ] **Step 1: ShowMainPayload 加字段**

`src/shared/ipc.ts` 75-78 行替换为：

```ts
export interface ShowMainPayload {
  focusTodo?: { todoId: number; date: string };
  quickAddDraft?: string; // 快添窗 Ctrl+Enter 预填标题
  openSettings?: boolean; // mac 应用菜单「设置…」直达设置页
}
```

- [ ] **Step 2: AppWindowController.installMacAppMenu**

`src/main/windows.ts` 在 `createMain` 方法之后新增：

```ts
  /** mac 专属：应用菜单（Edit roles 供输入框 Cmd+C/V；「设置…」直达设置页） */
  installMacAppMenu(): void {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: '设置…', accelerator: 'Cmd+,', click: () => this.showMain({ openSettings: true }) },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]));
  }
```

（`Menu`/`app` 该文件已 import。`createMain` 里的 `this.main.setMenu(null)` 保持现状——它只影响窗口级菜单，mac 应用菜单不受影响。）

- [ ] **Step 3: index.ts 挂钩**

import 区加 `IS_MAC`：

```ts
import { IS_MAC } from './platform';
```

`windows.createMain(hidden);`（102 行）之后加：

```ts
  if (IS_MAC) windows.installMacAppMenu();
```

`app.on('second-instance', ...)`（168 行）旁加：

```ts
  if (IS_MAC) app.on('activate', () => windows?.showMain()); // Dock 点击重开主窗
```

- [ ] **Step 4: MainShell 消费 openSettings**

`src/renderer/src/views/MainShell.tsx` onShowMain 回调（37-51 行）末尾加分支：

```ts
    const off = window.api.onShowMain((p) => {
      if (p.quickAddDraft) {
        setNav('today');
        setEditor({ open: true, draftTitle: p.quickAddDraft });
      } else if (p.focusTodo) {
        // 通知点击：切今日视图并携带定位信息（重置陈旧编辑态）
        setNav('today');
        setEditor({
          open: false,
          focusTodoId: p.focusTodo.todoId,
          focusDate: p.focusTodo.date,
        });
        toast.info('已定位到提醒任务', { description: p.focusTodo.date });
      } else if (p.openSettings) {
        setNav('settings');
      }
    });
```

- [ ] **Step 5: typecheck + 全量测试**

Run: `npm run typecheck && npm test`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add src/shared/ipc.ts src/main/windows.ts src/main/index.ts src/renderer/src/views/MainShell.tsx
git commit -m "feat: mac application menu with settings item, dock activate reopens main

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 托盘模板图标与点击行为（TrayManager）

**Files:**
- Modify: `src/main/windows.ts:305-344`（TrayManager 类）

**Interfaces:**
- Consumes: `PLATFORM`（Task 1，`trayIconName/trayIconTemplate`）
- Produces: 无新接口；行为契约——mac：左键开主窗、右键弹菜单（计数实时）、菜单不常驻；win：现状不变

- [ ] **Step 1: 改造 TrayManager**

`src/main/windows.ts` import 区加 `PLATFORM`：

```ts
import { IS_MAC, PLATFORM } from './platform';
```

`TrayManager` 类（305-344 行）替换为：

```ts
export class TrayManager {
  static instance: TrayManager | null = null;
  readonly tray: Tray;
  private count = 0;

  constructor(private win: AppWindowController, private onPause: () => void) {
    const img = nativeImage.createFromPath(join(__dirname, '../../resources', PLATFORM.trayIconName));
    // mac 模板图：文件名 Template 后缀自动标记，随明暗反色；resize 会破坏 @2x 组合，禁止
    this.tray = new Tray(PLATFORM.trayIconTemplate ? img : img.resize({ width: 16, height: 16 }));
    this.tray.setToolTip('WhchemTodo');
    this.tray.on('click', () => this.win.showMain());
    if (PLATFORM.trayIconTemplate) {
      // mac：设 contextMenu 后左键会被菜单吞掉，菜单挂右键、弹出时实时构建（计数必新）
      this.tray.on('right-click', () => this.tray.popUpContextMenu(this.buildMenu()));
    } else {
      this.tray.on('double-click', () => this.win.showMain());
    }
    TrayManager.instance = this;
    this.refresh();
    // 退出清理由 index.ts 的 before-quit 统一负责，不重复注册
  }

  /** 规格 §4.2：'今日待办 n 条' 禁用项随队列变动实时刷新 */
  setCount(n: number): void {
    this.count = n;
    this.refresh();
  }

  private buildMenu(): Menu {
    return Menu.buildFromTemplate([
      { label: '打开主窗口', click: () => this.win.showMain() },
      { label: `今日待办：${this.count} 条`, enabled: false },
      { type: 'separator' },
      { label: '暂停所有提醒 1 小时', click: () => this.onPause() },
      { type: 'separator' },
      { label: '退出 WhchemTodo', click: () => app.quit() },
    ]);
  }

  private refresh(): void {
    if (PLATFORM.trayIconTemplate) return; // mac：菜单不常驻，右键时实时构建
    this.tray.setContextMenu(this.buildMenu());
  }

  destroy(): void {
    this.tray.destroy();
    TrayManager.instance = null;
  }
}
```

- [ ] **Step 2: typecheck + 全量测试**

Run: `npm run typecheck && npm test`
Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add src/main/windows.ts
git commit -m "feat: mac tray template icon with click/right-click split

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: mac 图标生成脚本 `scripts/make-mac-icons.mjs`

**Files:**
- Create: `scripts/make-mac-icons.mjs`
- Modify: `package.json`（scripts 增加 `"icons:mac"`）
- 产出物: `build/icon-1024.png`、`build/icon.icns`、`resources/trayTemplate.png`、`resources/trayTemplate@2x.png`

**Interfaces:**
- Consumes: 项目 electron 依赖（离屏渲染）；系统 `iconutil`（macOS 自带）
- Produces: Task 7 的 `build/icon.icns`；Task 5 运行时加载的 `resources/trayTemplate{,@2x}.png`（文件名 Template 后缀 → Electron 自动标记模板图）

- [ ] **Step 1: 写脚本**

```js
// scripts/make-mac-icons.mjs
// 必须在 Electron 主进程中运行：npx electron scripts/make-mac-icons.mjs
// 产出：build/icon-1024.png（母版）、build/icon.icns、resources/trayTemplate{,@2x}.png
import { app, BrowserWindow } from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'build');
const iconsetDir = join(buildDir, 'icon.iconset');
const resourcesDir = join(root, 'resources');

// 与现有 256px 图同构：深蓝渐变圆角方块 + 白色对勾 + 橙色光点（viewBox 固定 1024，按尺寸参数化）
function iconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#26344f"/><stop offset="1" stop-color="#0c1322"/>
  </linearGradient></defs>
  <rect width="1024" height="1024" rx="224" fill="url(#bg)"/>
  <path d="M 288 540 L 456 700 L 760 330" fill="none" stroke="#ffffff"
        stroke-width="96" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="762" cy="330" r="34" fill="#f5a623" opacity="0.95"/>
</svg>`;
}

// 菜单栏模板图：仅对勾轮廓，纯黑 + alpha（系统按外观自动反色）
function templateSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <path d="M 14 34 L 26 46 L 50 18" fill="none" stroke="#000000"
        stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

async function renderPng(svg, size) {
  // show:false + 关闭节流：保证隐藏窗口也持续渲染，capturePage 不返回空图
  const win = new BrowserWindow({
    width: size, height: size, show: false, frame: false,
    webPreferences: { backgroundThrottling: false },
  });
  const html = `<html><body style="margin:0;overflow:hidden"><div style="width:${size}px;height:${size}px">${svg}</div></body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 120)); // 等一帧渲染
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  win.destroy();
  if (img.isEmpty()) throw new Error(`capturePage 返回空图（size=${size}）`);
  return img;
}

async function main() {
  await app.whenReady();
  mkdirSync(buildDir, { recursive: true });
  mkdirSync(resourcesDir, { recursive: true });

  // 母版 1024
  const master = await renderPng(iconSvg(1024), 1024);
  writeFileSync(join(buildDir, 'icon-1024.png'), master.toPNG());

  // iconset（同尺寸去重渲染）
  mkdirSync(iconsetDir, { recursive: true });
  const cache = new Map();
  const imgFor = async (px) => {
    if (!cache.has(px)) cache.set(px, px === 1024 ? master : await renderPng(iconSvg(px), px));
    return cache.get(px);
  };
  const iconset = [
    ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
  ];
  for (const [name, px] of iconset) {
    writeFileSync(join(iconsetDir, name), (await imgFor(px)).toPNG());
  }
  const r = spawnSync('iconutil', ['-c', 'icns', iconsetDir, '-o', join(buildDir, 'icon.icns')], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('iconutil 生成 icns 失败');

  // 模板托盘图标：2 倍尺寸渲染再缩小，边缘更平滑
  for (const [name, px] of [['trayTemplate.png', 16], ['trayTemplate@2x.png', 32]]) {
    const big = await renderPng(templateSvg(px * 2), px * 2);
    writeFileSync(join(resourcesDir, name), big.resize({ width: px, height: px }).toPNG());
  }

  console.log('build/icon.icns、resources/trayTemplate{,@2x}.png 生成完成');
  app.quit();
}

main().catch((err) => {
  console.error('[make-mac-icons] failed:', err);
  app.exit(1);
});
```

（若 capturePage 仍返回空图：把 `BrowserWindow` 参数换成 `{ show: true, x: -32000, y: 0, frame: false, width: size, height: size }` 移到屏外可见渲染——构建期闪窗可接受。）

- [ ] **Step 2: package.json 加脚本**

`scripts` 中加一行（放 `"make-icon"` 后）：

```json
    "make-icon": "node scripts/make-icon.mjs",
    "icons:mac": "electron scripts/make-mac-icons.mjs",
```

- [ ] **Step 3: 运行脚本**

Run: `npm run icons:mac`
Expected: 输出「生成完成」，退出码 0

- [ ] **Step 4: 验证产物**

Run: `ls -la build/icon.icns build/icon-1024.png resources/trayTemplate.png resources/trayTemplate@2x.png`
Expected: 四个文件存在且 >0 字节。

用 Read 工具查看 `resources/trayTemplate.png` 与 `build/icon-1024.png`：模板图为透明底黑色对勾；母版与现有 256px 图风格一致（深蓝圆角方块 + 白对勾 + 橙点）。

- [ ] **Step 5: 提交**

```bash
git add scripts/make-mac-icons.mjs package.json build/icon.icns build/icon-1024.png resources/trayTemplate.png resources/trayTemplate@2x.png
git commit -m "feat: mac icon pipeline, hi-res icns and menu bar template icon

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: electron-builder mac 块 + build:mac 脚本

**Files:**
- Modify: `electron-builder.yml`（win/nsis 块之后）
- Modify: `package.json`（scripts 增加 `"build:mac"`）

**Interfaces:**
- Consumes: Task 6 的 `build/icon.icns`
- Produces: `dist/WhchemTodo-<version>-arm64.dmg`；`npm run build:mac`

- [ ] **Step 1: electron-builder.yml 加 mac 块**

在 `nsis:` 块之后、`publish: null` 之前加：

```yaml
mac:
  icon: build/icon.icns
  category: public.app-category.productivity
  identity: null   # 个人使用，跳过签名（首次打开右键→打开放行 Gatekeeper）
  target:
    - target: dmg
      arch: [arm64]
```

- [ ] **Step 2: package.json 加 build:mac**

`scripts` 中 `"build:win"` 后加：

```json
    "build:win": "npm run make-icon && npm run build && electron-builder --win nsis --x64",
    "build:mac": "npm run make-icon && npm run icons:mac && npm run build && electron-builder --mac",
```

（`--mac` 目标/arch 以 yml 为准；make-icon 继续拷贝 `resources/icon.png` 供打包，ico 生成在 mac 上无害。）

- [ ] **Step 3: 全量构建**

Run: `npm run build:mac`
Expected: 构建成功，产物 `dist/WhchemTodo-0.1.0-arm64.dmg`

Run: `ls -la dist/*.dmg`
Expected: dmg 文件存在且 >50MB

- [ ] **Step 4: 验证包内资源**

Run: `npx asar list dist/mac-arm64/WhchemTodo.app/Contents/Resources/app.asar | grep -E "trayTemplate|icon.png"`
Expected: `resources/trayTemplate.png`、`resources/trayTemplate@2x.png`、`resources/icon.png` 在列表中（模板图随包，Task 5 运行时加载）

Run: `ls dist/mac-arm64/WhchemTodo.app/Contents/Resources/*.icns`
Expected: `electron.icns`（应用图标由 electron-builder 替换为主图标，此处确认包结构完整即可；Dock/访达显示的图标在 Task 8 冒烟时人眼确认）

- [ ] **Step 5: 提交**

```bash
git add electron-builder.yml package.json
git commit -m "feat: unsigned arm64 dmg build target for mac

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: 全量验证与打包冒烟

**Files:**
- 无代码改动；验证 + 验收清单交接

**Interfaces:**
- Consumes: 全部前序任务
- Produces: 验证结论 + 用户手动验收清单

- [ ] **Step 1: 类型与测试**

Run: `npm run typecheck && npm test`
Expected: 全部 PASS

- [ ] **Step 2: 打包冒烟（不装 DMG，直接跑 .app 二进制）**

```bash
"dist/mac-arm64/WhchemTodo.app/Contents/MacOS/WhchemTodo" --hidden >/tmp/whchem-smoke.log 2>&1 &
sleep 6
pgrep -fl WhchemTodo
```

Expected: 进程存活。然后检查日志无致命错误：

Run: `tail -5 ~/Library/Logs/whchem-todo/main.log 2>/dev/null; tail -20 /tmp/whchem-smoke.log`
Expected: 无 uncaught 异常刷屏；better-sqlite3 加载失败会在这里现形。

再验证数据库目录落点：

Run: `ls ~/Library/Application\ Support/whchem-todo/ 2>/dev/null`
Expected: `todo.db` 存在

清理：

```bash
pkill -f "WhchemTodo.app/Contents/MacOS/WhchemTodo"
```

- [ ] **Step 3: 代码层面确认 Windows 零回归**

Run: `git diff f02c1a7..HEAD --stat` 逐文件过一遍改动，确认：
- 每个 `IS_MAC`/`PLATFORM` 分支 win 侧行为与改前一致（热键串、托盘 setContextMenu+click/double-click、关窗 hide+气泡、frame:false 自绘三键）
- `resources/icon.png`、`build/icon.ico` 生成链未动

- [ ] **Step 4: 交用户手动验收**

告知用户以下清单（规格 §测试）：
1. 安装 DMG（挂载拖入 Applications），首次右键→打开
2. 主窗红绿灯可见居中；红=关窗后应用留后台，Dock 点击重开
3. 菜单栏对勾图标浅色/深色自动反色；左键开主窗、右键菜单计数正确
4. Option+Cmd+A/W/S 三个热键生效；设置页重录（含 Cmd）持久化
5. 应用菜单：输入框 Cmd+C/V 可用；「设置…」直达设置页；Cmd+Q 干净退出
6. 通知权限流程与点击定位
7. 长条收缩/展开/拖拽/几何记忆；快添失焦隐藏
8. 系统设置→登录项 开关生效
9. 确认后推送 GitHub（`git push`）

---

## Self-Review 记录

- **Spec coverage**：platform.ts（§平台配置中枢）→T1；渲染层判断/录制器/对话框（§快捷键）→T2；窗口参数/关窗/防护（§主窗与标题栏·主进程侧）→T3；Titlebar mac 化（§主窗与标题栏·渲染层侧）→T3b；应用菜单+openSettings+activate（§应用菜单）→T4；托盘（§菜单栏图标）→T5；图标（§make-mac-icons.mjs）→T6；构建（§electron-builder.yml/package.json）→T7；验收（§测试）→T8。首版漏掉 Titlebar.tsx，自审时发现并补为 T3b。
- **Placeholder scan**：无 TBD/TODO；所有代码步骤给出完整代码。
- **Type consistency**：`PLATFORM.trayIconName/trayIconTemplate/showTrayBubble`、`IS_MAC`、`displayAccelerator`、`openSettings` 各任务间签名一致。
