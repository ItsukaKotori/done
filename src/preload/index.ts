import { contextBridge, ipcRenderer } from 'electron';
import { Ipc, unwrapAsync, type Api, type R, type ShowMainPayload, type StripState } from '@shared/ipc';

function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  return unwrapAsync(ipcRenderer.invoke(channel, ...args) as Promise<R<T>>);
}

function on(channel: string, cb: (...args: any[]) => void): () => void {
  const listener = (_e: unknown, ...args: any[]) => cb(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// 白名单桥：渲染层拿不到 ipcRenderer 本身（规格 §4 安全基线）
const api: Api = {
  todos: {
    list: (q) => call(Ipc.TodosList, q),
    listAll: (s) => call(Ipc.TodosListAll, s),
    create: (d) => call(Ipc.TodosCreate, d),
    update: (id, p) => call(Ipc.TodosUpdate, id, p),
    remove: (id) => call(Ipc.TodosDelete, id),
    complete: (id, date) => call(Ipc.TodosComplete, id, date),
    setStatus: (id, date, s) => call(Ipc.TodosSetStatus, id, date, s),
    snooze: (id, date, m) => call(Ipc.TodosSnooze, id, date, m),
    preview: (req) => call(Ipc.TodosPreview, req),
    startTimer: (id, date) => call(Ipc.TodosStartTimer, id, date),
    pauseTimer: (id, date) => call(Ipc.TodosPauseTimer, id, date),
    history: (id, limit) => call(Ipc.TodosHistory, id, limit),
  },
  settings: {
    get: (k) => call(Ipc.SettingsGet, k),
    set: (k, v) => call(Ipc.SettingsSet, k, v),
  },
  autostart: {
    get: () => call(Ipc.AutostartGet),
    set: (v) => call(Ipc.AutostartSet, v),
  },
  hotkey: {
    set: (a) => call(Ipc.HotkeySet, a),
    setShowMain: (a) => call(Ipc.HotkeySetShowMain, a),
    setToggleStrip: (a) => call(Ipc.HotkeySetToggleStrip, a),
  },
  notifyTest: () => call(Ipc.NotifyTest),
  notifySupported: () => call(Ipc.NotifySupported),
  openNotifySettings: () => call(Ipc.NotifyOpenSettings),
  dbPath: () => call(Ipc.SettingsDbPath),
  openDbFolder: () => call(Ipc.SettingsOpenDbFolder),
  exportData: () => call(Ipc.SettingsExportData),
  exportLogs: () => call(Ipc.SettingsExportLogs),
  win: {
    minimize: () => call(Ipc.WinMinimize),
    maximizeToggle: () => call(Ipc.WinMaximizeToggle),
    hideToTray: () => call(Ipc.WinHide),
    selfHide: () => call(Ipc.WinSelfHide),
    closeQuickAdd: () => call(Ipc.WinCloseQuickAdd),
    openEditor: (t) => call(Ipc.WinOpenEditor, t),
    collapseStrip: () => call(Ipc.CollapseStrip),
    stripToggle: () => call(Ipc.StripToggle),
    expandMain: () => call(Ipc.ExpandMain),
  },
  onDataChanged: (cb) => on(Ipc.EventDataChanged, cb),
  onShowMain: (cb) => on(Ipc.EventShowMain, (p: ShowMainPayload) => cb(p)),
  onQuickAddFocusInput: (cb) => on(Ipc.EventQuickAddFocusInput, cb),
  onStripState: (cb) => on(Ipc.EventStripState, (s: StripState) => cb(s)),
  stats: {
    summary: () => call(Ipc.StatsSummary),
  },
};

contextBridge.exposeInMainWorld('api', api);
