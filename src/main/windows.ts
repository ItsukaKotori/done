import {
  app, BrowserWindow, Menu, Tray, nativeImage, screen, type WebContents,
} from 'electron';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { Ipc, type ShowMainPayload } from '@shared/ipc';
import type { WindowOps } from './ipc';
import type { SettingsDao } from './db/dao';
import { IS_MAC, PLATFORM } from './platform';

const QUICK_W = 560;
const QUICK_H = 120;
const STRIP_W = 600;
const STRIP_H_COLLAPSED = 32;
const STRIP_H_EXPANDED = 380;
const STRIP_MIN_W = 320;
const STRIP_MIN_EXPANDED_H = 240; // 展开高度的下限：低于此值不能算"展开"
const STRIP_KEY = 'strip_geometry';

/** 长条窗位置与尺寸（持久化到 settings） */
interface StripGeometry {
  x: number; y: number; w: number; expandedH: number;
}

// 规格 §4.2：首次"关窗=最小化"气泡只提示一次（内存级，重启后再提示可接受）
let bubbleShown = false;

export class AppWindowController implements WindowOps {
  private main: BrowserWindow | null = null;
  private quickAdd: BrowserWindow | null = null;
  private strip: BrowserWindow | null = null;
  private stripExpanded = false;
  private geoPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private quitting = false;
  private emitter = new EventEmitter();

  constructor(private settings: SettingsDao) {
    app.on('before-quit', () => { this.quitting = true; });
  }

  // ---- Strip 几何持久化 ----

  private readStripGeometry(): StripGeometry | null {
    const g = this.settings.get<StripGeometry>(STRIP_KEY);
    return g && typeof g.x === 'number' && typeof g.y === 'number' && typeof g.w === 'number'
      ? g
      : null;
  }

  /** 位置仍在任一显示器可见区域内则复用，否则回落默认 */
  private insideSomeDisplay(g: StripGeometry): boolean {
    return screen.getAllDisplays().some(({ workArea: a }) =>
      g.x < a.x + a.width && g.x + g.w > a.x && g.y < a.y + a.height && g.y + 40 > a.y,
    );
  }

  private defaultStripGeometry(): StripGeometry {
    const display = screen.getPrimaryDisplay();
    const { x, y, width } = display.workArea;
    return {
      x: Math.round(x + (width - STRIP_W) / 2),
      y,
      w: STRIP_W,
      expandedH: STRIP_H_EXPANDED,
    };
  }

  private persistStripGeometry(): void {
    if (!this.strip || this.strip.isDestroyed()) return;
    const b = this.strip.getBounds();
    const prev = this.readStripGeometry();
    this.settings.set<StripGeometry>(STRIP_KEY, {
      x: b.x,
      y: b.y,
      w: Math.max(STRIP_MIN_W, b.width),
      // 只有"有意义地撑开"才记为新展开高度，避免微小拖动/DPI 取整把 expandedH 写成 ~32
      expandedH: b.height >= STRIP_MIN_EXPANDED_H
        ? b.height
        : (prev?.expandedH ?? STRIP_H_EXPANDED),
    });
  }

  /** 拖动/缩放期间高频触发，防抖写入 settings */
  private schedulePersist(): void {
    if (this.geoPersistTimer) clearTimeout(this.geoPersistTimer);
    this.geoPersistTimer = setTimeout(() => {
      this.geoPersistTimer = null;
      this.persistStripGeometry();
    }, 300);
  }

  private loadWindow(win: BrowserWindow, query?: Record<string, string>): void {
    const url = process.env['ELECTRON_RENDERER_URL'];
    if (url) {
      const qs = query ? new URLSearchParams(query).toString() : '';
      void win.loadURL(qs ? `${url}?${qs}` : url);
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'), query ? { query } : undefined);
    }
  }

  private static baseWebPreferences(): Electron.WebPreferences {
    return {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    };
  }

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

  getMainWindow(): BrowserWindow | null { return this.main; }

  showMain(payload?: ShowMainPayload): void {
    if (!this.main || this.main.isDestroyed()) this.createMain(false);
    if (this.main!.isMinimized()) this.main!.restore();
    this.main!.show();
    this.main!.focus();
    if (payload) this.main!.webContents.send(Ipc.EventShowMain, payload);
  }

  /** 规格 §5.6：首次唤起创建、之后复用隐藏；唤起位置=光标所在显示器居中 */
  showQuickAdd(): void {
    if (!this.quickAdd || this.quickAdd.isDestroyed()) {
      this.quickAdd = new BrowserWindow({
        width: QUICK_W, height: QUICK_H, frame: false, resizable: false,
        alwaysOnTop: true, skipTaskbar: true, show: false,
        maximizable: false, minimizable: false,
        webPreferences: AppWindowController.baseWebPreferences(),
      });
      this.loadWindow(this.quickAdd, { win: 'quickadd' });
      this.quickAdd.once('ready-to-show', () => {
        this.quickAdd?.show();
        this.quickAdd?.focus();
      });
      this.quickAdd.on('blur', () => { if (!this.quickAdd?.isDestroyed()) this.quickAdd?.hide(); });
      this.quickAdd.on('closed', () => { this.quickAdd = null; });
    } else {
      const cursor = screen.getCursorScreenPoint();
      const d = screen.getDisplayNearestPoint(cursor);
      this.quickAdd.setPosition(
        Math.round(d.bounds.x + (d.bounds.width - QUICK_W) / 2),
        Math.round(d.bounds.y + (d.bounds.height - QUICK_H) / 2),
      );
      this.quickAdd.show();
      this.quickAdd.focus();
    }
    this.quickAdd.webContents.send(Ipc.EventQuickAddFocusInput);
  }

  // ---- WindowOps 实现 ----
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

  hideWindow(wc: WebContents): void {
    if (this.quickAdd && wc === this.quickAdd.webContents) this.quickAdd.hide();
  }

  closeQuickAdd(): void { this.quickAdd?.hide(); }

  openEditorFromQuickAdd(title: string): void {
    this.showMain({ quickAddDraft: title }); // 主窗渲染层监听 EventShowMain 打开预填对话框
    this.quickAdd?.hide();
  }

  focusTodo(todoId: number, date: string): void {
    this.strip?.hide();
    this.stripExpanded = false;
    this.showMain({ focusTodo: { todoId, date } });
  }

  // ---- Strip 收缩长条 ----

  collapseToStrip(): void {
    if (!this.main || this.main.isDestroyed()) return;
    if (this.main.isMinimized()) this.main.restore();
    this.main.hide();

    if (!this.strip || this.strip.isDestroyed()) {
      const saved = this.readStripGeometry();
      const g = saved && this.insideSomeDisplay(saved) ? saved : this.defaultStripGeometry();
      this.strip = new BrowserWindow({
        x: g.x, y: g.y, width: Math.max(STRIP_MIN_W, g.w), height: STRIP_H_COLLAPSED,
        frame: false, resizable: true, movable: true,
        alwaysOnTop: true, skipTaskbar: true,
        closable: false, minimizable: false, maximizable: false,
        show: false,
        backgroundColor: '#10141b',
        webPreferences: AppWindowController.baseWebPreferences(),
      });
      this.loadWindow(this.strip, { win: 'strip' });
      this.strip.once('ready-to-show', () => this.strip?.show());
      // 自由缩放/拖动：同步展开态并按防抖持久化几何
      this.strip.on('resize', () => this.onStripResized());
      this.strip.on('move', () => this.schedulePersist());
      this.strip.on('blur', () => {
        if (this.stripExpanded) this.setStripExpanded(false);
      });
      this.strip.on('closed', () => {
        if (this.geoPersistTimer) { clearTimeout(this.geoPersistTimer); this.geoPersistTimer = null; }
        this.strip = null;
        this.stripExpanded = false;
      });
    } else {
      // 复用：先回到收起态（同时同步渲染层），再显示
      this.setStripExpanded(false);
      this.strip.show();
      this.strip.focus();
    }
  }

  /** 用户拖拽改变高度：>收起高度即视为展开；同步渲染层并持久化 */
  private onStripResized(): void {
    if (!this.strip || this.strip.isDestroyed()) return;
    const expanded = this.strip.getBounds().height > STRIP_H_COLLAPSED + 4;
    if (expanded !== this.stripExpanded) {
      this.stripExpanded = expanded;
      this.strip.webContents.send(Ipc.EventStripState, { expanded });
    }
    this.schedulePersist();
  }

  toggleStrip(): void {
    // 以真实窗口高度判断（不依赖内存态，避免与渲染层/几何不同步）
    const h = this.strip?.getBounds().height ?? STRIP_H_COLLAPSED;
    this.setStripExpanded(h <= STRIP_H_COLLAPSED + 4);
  }

  expandFromStrip(): void {
    this.strip?.hide();
    this.stripExpanded = false;
    this.showMain();
  }

  /** 全局热键：长条可见则回主窗，否则收缩为长条 */
  toggleStripShortcut(): void {
    const visible = !!this.strip && !this.strip.isDestroyed() && this.strip.isVisible();
    if (visible) this.expandFromStrip();
    else this.collapseToStrip();
  }

  private setStripExpanded(expanded: boolean): void {
    if (!this.strip || this.strip.isDestroyed()) return;
    this.stripExpanded = expanded;
    const b = this.strip.getBounds();
    // 展开恢复上次记住的高度（下限 240）；收起回条高
    const savedH = this.readStripGeometry()?.expandedH ?? STRIP_H_EXPANDED;
    const h = expanded
      ? Math.max(savedH, STRIP_MIN_EXPANDED_H)
      : STRIP_H_COLLAPSED;
    this.strip.setBounds({ x: b.x, y: b.y, width: b.width, height: h });
    this.strip.webContents.send(Ipc.EventStripState, { expanded });
  }
}

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
