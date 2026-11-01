import { ipcMain, app, dialog, Notification, shell, type WebContents } from 'electron';
import { copyFile, writeFile } from 'node:fs/promises';
import log from 'electron-log/main';
import { Ipc, ok, fail, type PreviewRequest, type ExportResult } from '@shared/ipc';
import { todayStr } from '@shared/recurrence';
import type { TodoService } from './services/todo-service';
import type { Scheduler } from './services/scheduler';
import type { Exporter } from './services/exporter';
import type { StatsService } from './services/stats';
import type { SettingsDao } from './db/dao';
import type { TodoDraft, OccurrenceQuery, OccurrenceStatus } from '@shared/types';

/** 由 Task 7 的 AppWindowController 实现（窗口编排对 IPC 层的全部需求） */
export interface WindowOps {
  broadcastChanged(): void;
  onChangedBroadcast(cb: () => void): () => void;
  minimize(): void;
  maximizeToggle(): void;
  hideToTray(): void;
  hideWindow(wc: WebContents): void;
  closeQuickAdd(): void;
  openEditorFromQuickAdd(title: string): void;
  focusTodo(todoId: number, date: string): void;
  showMain(): void;
  collapseToStrip(): void;
  toggleStrip(): void;
  expandFromStrip(): void;
  toggleStripShortcut(): void;
}

export interface IpcDeps {
  todoService: TodoService;
  scheduler: Scheduler;
  settingsDao: SettingsDao;
  exporter: Exporter;
  stats: StatsService;
  windows: WindowOps;
  onHotkeyChange: (acc: string) => boolean;
  onShowMainHotkeyChange: (acc: string) => boolean;
  onToggleStripHotkeyChange: (acc: string) => boolean;
  dataDir: string;
}

const wrap = (channel: string, fn: (...args: any[]) => any) => {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return ok(await fn(...args));
    } catch (err: any) {
      // 结构化错误：渲染层 Sonner 红 toast 展示 message（规格 §6）
      return fail(err?.code ?? 'INTERNAL', err?.message ?? String(err));
    }
  });
};

/** 需要 invoke 事件上下文（如 e.sender）的通道专用：事件不被吞掉，类型上不可混淆 */
const wrapEv = (channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: any[]) => any) => {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      return ok(await fn(e, ...args));
    } catch (err: any) {
      return fail(err?.code ?? 'INTERNAL', err?.message ?? String(err));
    }
  });
};

export function registerIpc(deps: IpcDeps): void {
  const { todoService, scheduler, settingsDao, exporter, stats, windows, dataDir } = deps;

  wrap(Ipc.TodosList, (q: OccurrenceQuery) => todoService.list(q.from, q.to));
  wrap(Ipc.TodosListAll, (status: 'all' | 'open' | 'done') => todoService.listAll(status));
  wrap(Ipc.TodosCreate, (draft: TodoDraft) => {
    const t = todoService.create(draft);
    scheduler.syncFor(t); // 规格 §4：写操作立即重排提醒
    windows.broadcastChanged();
    return t;
  });
  wrap(Ipc.TodosUpdate, (id: number, patch: Partial<TodoDraft>) => {
    const t = todoService.update(id, patch);
    if (t) {
      scheduler.syncFor(t);
      windows.broadcastChanged();
    }
    return t;
  });
  wrap(Ipc.TodosDelete, (id: number) => {
    todoService.remove(id); // FK 级联清理 reminders / occurrence_states
    scheduler.syncAll();    // 全量重排兜底（规格 §4.1 规则3）
    windows.broadcastChanged();
  });
  wrap(Ipc.TodosComplete, (id: number, date?: string) => {
    todoService.complete(id, date);
    const t = todoService.getById(id);
    if (t) scheduler.syncFor(t); // 完成后排下一期
    windows.broadcastChanged();
  });
  wrap(Ipc.TodosSetStatus, (id: number, date: string, status: OccurrenceStatus) => {
    todoService.setStatus(id, date, status);
    const t = todoService.getById(id);
    if (t) scheduler.syncFor(t);
    windows.broadcastChanged();
  });
  wrap(Ipc.TodosSnooze, (id: number, date: string, minutes: number) => {
    scheduler.snooze(id, date, minutes);
  });
  wrap(Ipc.TodosPreview, (req: PreviewRequest) =>
    todoService.preview(req.draft, 5, req.todoId));
  wrap(Ipc.TodosStartTimer, (id: number, date?: string) => {
    todoService.startTimer(id, date);
    windows.broadcastChanged();
  });
  wrap(Ipc.TodosPauseTimer, (id: number, date?: string) => {
    todoService.pauseTimer(id, date);
    windows.broadcastChanged();
  });
  wrap(Ipc.StatsSummary, () => stats.summary());
  wrap(Ipc.TodosHistory, (id: number, limit?: number) => todoService.occurrenceHistory(id, limit));

  wrap(Ipc.SettingsGet, (key: string) => settingsDao.get(key));
  wrap(Ipc.SettingsSet, (key: string, value: unknown) => settingsDao.set(key, value));
  wrap(Ipc.AutostartGet, () => app.getLoginItemSettings().openAtLogin);
  wrap(Ipc.AutostartSet, (enabled: boolean) => {
    // 规格 §4.2：真相写系统，settings 表仅记录意图
    app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? ['--hidden'] : [] });
    settingsDao.set('autostart', enabled);
  });
  wrap(Ipc.HotkeySet, (acc: string) => {
    if (!deps.onHotkeyChange(acc)) {
      throw Object.assign(new Error('快捷键注册失败（被占用或格式无效），已保留原设置'), {
        code: 'HOTKEY_CONFLICT',
      });
    }
    settingsDao.set('quickadd_shortcut', acc);
  });
  wrap(Ipc.HotkeySetShowMain, (acc: string) => {
    if (!deps.onShowMainHotkeyChange(acc)) {
      throw Object.assign(new Error('快捷键注册失败（被占用或格式无效），已保留原设置'), {
        code: 'HOTKEY_CONFLICT',
      });
    }
    settingsDao.set('show_main_shortcut', acc);
  });
  wrap(Ipc.HotkeySetToggleStrip, (acc: string) => {
    if (!deps.onToggleStripHotkeyChange(acc)) {
      throw Object.assign(new Error('快捷键注册失败（被占用或格式无效），已保留原设置'), {
        code: 'HOTKEY_CONFLICT',
      });
    }
    settingsDao.set('toggle_strip_shortcut', acc);
  });
  wrap(Ipc.NotifyTest, () => {
    if (!Notification.isSupported()) {
      throw Object.assign(
        new Error('系统通知不可用，请到 Windows 设置 → 通知 中开启本应用权限'),
        { code: 'NOTIFY_UNSUPPORTED' },
      );
    }
    new Notification({ title: 'WhchemTodo', body: '这是一条测试通知' }).show();
  });
  wrap(Ipc.NotifySupported, () => Notification.isSupported());
  wrap(Ipc.NotifyOpenSettings, () => shell.openExternal('ms-settings:notifications'));

  wrap(Ipc.WinMinimize, () => windows.minimize());
  wrap(Ipc.WinMaximizeToggle, () => windows.maximizeToggle());
  wrap(Ipc.WinHide, () => windows.hideToTray());
  wrapEv(Ipc.WinSelfHide, (e) => windows.hideWindow(e.sender));
  wrap(Ipc.WinCloseQuickAdd, () => windows.closeQuickAdd());
  wrap(Ipc.WinOpenEditor, (title: string) => windows.openEditorFromQuickAdd(title));
  wrap(Ipc.CollapseStrip, () => windows.collapseToStrip());
  wrap(Ipc.StripToggle, () => windows.toggleStrip());
  wrap(Ipc.ExpandMain, () => windows.expandFromStrip());

  // 设置页：数据目录（Task 14）
  wrap(Ipc.SettingsDbPath, () => dataDir);
  wrap(Ipc.SettingsOpenDbFolder, async () => {
    // shell.openPath 成功返回空串、失败返回错误描述
    const err = await shell.openPath(dataDir);
    if (err) throw Object.assign(new Error(err), { code: 'OPEN_FOLDER_FAILED' });
  });

  // 导出：任务数据快照（不含 derived reminders）
  wrap(Ipc.SettingsExportData, async (): Promise<ExportResult> => {
    const json = JSON.stringify(exporter.build(), null, 2);
    const res = await dialog.showSaveDialog({
      title: '导出任务数据',
      defaultPath: `whchem-todo-${todayStr(Date.now())}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { saved: false };
    await writeFile(res.filePath, json, 'utf8');
    return { saved: true, path: res.filePath };
  });

  // 导出：electron-log 日志文件
  wrap(Ipc.SettingsExportLogs, async (): Promise<ExportResult> => {
    const src = log.transports.file.getFile().path;
    const res = await dialog.showSaveDialog({
      title: '导出日志',
      defaultPath: `whchem-todo-log-${todayStr(Date.now())}.log`,
      filters: [{ name: 'Log', extensions: ['log'] }],
    });
    if (res.canceled || !res.filePath) return { saved: false };
    await copyFile(src, res.filePath);
    return { saved: true, path: res.filePath };
  });
}
