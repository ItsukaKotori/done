import { app, dialog, powerMonitor, session } from 'electron';
import { join } from 'node:path';
import log from 'electron-log/main';
import { openDb } from './db';
import { TodoDao, OccurrenceDao, ReminderDao, SettingsDao, TimerDao } from './db/dao';
import { TodoService } from './services/todo-service';
import { Scheduler } from './services/scheduler';
import { Exporter } from './services/exporter';
import { StatsService } from './services/stats';
import { registerIpc } from './ipc';
import { AppWindowController, TrayManager } from './windows';
import { dispatchNotify } from './notify';
import {
  registerQuickAddShortcut, registerShowMainShortcut, registerToggleStripShortcut,
  unregisterAllShortcuts, DEFAULT_HOTKEY, DEFAULT_SHOW_MAIN_HOTKEY, DEFAULT_TOGGLE_STRIP_HOTKEY,
} from './shortcuts';
import { todayStr } from '@shared/recurrence';

log.initialize();
log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024;

const DATA_DIR = () => join(app.getPath('appData'), 'whchem-todo');

// 规格 §4.2：单实例锁；二次启动唤起已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  bootstrap().catch((err) => log.error('[boot] failed', err));
}

let windows: AppWindowController | null = null;

// 规格 §6：异常兜底——托盘应用不闪退；60s 内 5 次才弹窗询问
const errStamps: number[] = [];
process.on('uncaughtException', (e) => {
  log.error('[uncaught]', e);
  const now = Date.now();
  errStamps.push(now);
  while (errStamps.length && now - errStamps[0] > 60_000) errStamps.shift();
  if (errStamps.length >= 5) {
    errStamps.length = 0;
    dialog.showMessageBox({
      type: 'error',
      title: 'WhchemTodo 连续异常',
      message: `最近 1 分钟内发生 5 次未处理异常。\n日志：${log.transports.file.getFile().path}`,
    });
  }
});
process.on('unhandledRejection', (e) => log.error('[unhandledRejection]', e));

async function bootstrap(): Promise<void> {
  const hidden = process.argv.includes('--hidden'); // 自启带参 → 静默进托盘
  await app.whenReady();

  // 生产环境 CSP 由响应头注入（dev 的 HMR 需内联前言脚本，见 renderer/index.html 注释）
  if (!process.env['ELECTRON_RENDERER_URL']) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
          ],
        },
      });
    });
  }

  // 数据库：损坏自动恢复 + 对话框告知（规格 §6）
  const { db, recovered } = openDb(DATA_DIR());
  if (recovered) {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: '数据库已恢复',
      message: '检测到数据库文件损坏，已重建空数据库。\n损坏文件保留为同目录下 todo.db.corrupt.<时间戳>，可尝试手动恢复。',
    });
  }

  const todosDao = new TodoDao(db);
  const occDao = new OccurrenceDao(db);
  const remDao = new ReminderDao(db);
  const settingsDao = new SettingsDao(db);
  const timerDao = new TimerDao(db);
  const todoService = new TodoService(todosDao, occDao, timerDao);
  const exporter = new Exporter(todosDao, occDao, timerDao, settingsDao, app.getVersion());
  const stats = new StatsService(todosDao, occDao, timerDao, todoService);
  windows = new AppWindowController(settingsDao);

  const scheduler = new Scheduler(remDao, todosDao, {
    now: () => Date.now(),
    setTimer: (cb, ms) => setTimeout(cb, ms),
    clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
    // 点击通知唤起主窗并定位任务（规格 §4.2）；notify_sound 开关影响是否带声（规格 §5.4）
    notify: (items) => dispatchNotify(
      items,
      (i) => windows!.focusTodo(i.todoId, i.occurrenceDate),
      settingsDao.get<boolean>('notify_sound') ?? true,
    ),
  }, occDao);

  windows.createMain(hidden);

  const tray = new TrayManager(windows, () => {
    scheduler.pause(60 * 60 * 1000);
    dialog.showMessageBoxSync({
      type: 'info',
      title: '提醒已暂停',
      message: '1 小时内的提醒将静默处理，过期项在恢复后补发。',
    });
  });

  const refreshTrayCount = () => {
    const today = todayStr(Date.now());
    tray.setCount(todoService.list(today, today).filter(i => i.state === 'active').length);
  };
  windows.onChangedBroadcast(refreshTrayCount);
  refreshTrayCount();

  // 全局热键回调（注册与重录共用同一份）
  const quickAddCb = () => windows!.showQuickAdd();
  const showMainCb = () => windows!.showMain();
  const toggleStripCb = () => windows!.toggleStripShortcut();

  registerIpc({
    todoService,
    scheduler,
    settingsDao,
    exporter,
    stats,
    windows,
    onHotkeyChange: (acc) => registerQuickAddShortcut(acc, quickAddCb),
    onShowMainHotkeyChange: (acc) => registerShowMainShortcut(acc, showMainCb),
    onToggleStripHotkeyChange: (acc) => registerToggleStripShortcut(acc, toggleStripCb),
    dataDir: DATA_DIR(),
  });

  // 全局热键（失败回退默认，规格 §6）
  const quickAcc = settingsDao.get<string>('quickadd_shortcut') ?? DEFAULT_HOTKEY;
  if (!registerQuickAddShortcut(quickAcc, quickAddCb)) {
    registerQuickAddShortcut(DEFAULT_HOTKEY, quickAddCb);
  }
  const showAcc = settingsDao.get<string>('show_main_shortcut') ?? DEFAULT_SHOW_MAIN_HOTKEY;
  if (!registerShowMainShortcut(showAcc, showMainCb)) {
    registerShowMainShortcut(DEFAULT_SHOW_MAIN_HOTKEY, showMainCb);
  }
  const stripAcc = settingsDao.get<string>('toggle_strip_shortcut') ?? DEFAULT_TOGGLE_STRIP_HOTKEY;
  if (!registerToggleStripShortcut(stripAcc, toggleStripCb)) {
    registerToggleStripShortcut(DEFAULT_TOGGLE_STRIP_HOTKEY, toggleStripCb);
  }

  // 调度：从库恢复 pending（规格 §3.3 重启可靠性）
  scheduler.syncAll();
  scheduler.start();

  // 自启意图与实际状态对齐（规格 §4.2：真相以 getLoginItemSettings 为准）
  const wantAuto = settingsDao.get<boolean>('autostart') ?? false;
  if (wantAuto !== app.getLoginItemSettings().openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: wantAuto, args: wantAuto ? ['--hidden'] : [] });
  }

  // 睡眠唤醒全量重排 + 补发（规格 §4.1 规则2）
  powerMonitor.on('resume', () => {
    scheduler.start();
    refreshTrayCount();
  });

  app.on('second-instance', () => windows?.showMain());
  app.on('window-all-closed', () => { /* 托盘应用：不退出 */ });
  app.on('before-quit', () => {
    unregisterAllShortcuts();
    tray.destroy();
  });
  // 窗口销毁完成后（will-quit）再关库，避免退出瞬间 IPC 命中已关 db
  app.on('will-quit', () => db.close());
}
