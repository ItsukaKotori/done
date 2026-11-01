import type {
  Todo, TodoDraft, OccurrenceItem, OccurrenceQuery, OccurrenceStatus,
} from './types';
import type { StatsSummary } from './stats';
import type { OccurrenceHistory } from './history';

export const Ipc = {
  TodosList: 'todos:list',
  TodosListAll: 'todos:list-all',
  TodosCreate: 'todos:create',
  TodosUpdate: 'todos:update',
  TodosDelete: 'todos:delete',
  TodosComplete: 'todos:complete',
  TodosSetStatus: 'todos:setStatus',
  TodosSnooze: 'todos:snooze',
  TodosPreview: 'todos:preview',
  TodosStartTimer: 'todos:start-timer',
  TodosPauseTimer: 'todos:pause-timer',
  TodosHistory: 'todos:history',
  StatsSummary: 'stats:summary',
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  SettingsDbPath: 'settings:db-path',
  SettingsOpenDbFolder: 'settings:open-db-folder',
  SettingsExportData: 'settings:export-data',
  SettingsExportLogs: 'settings:export-logs',
  AutostartGet: 'autostart:get',
  AutostartSet: 'autostart:set',
  HotkeySet: 'hotkey:set',
  HotkeySetShowMain: 'hotkey:set-show-main',
  HotkeySetToggleStrip: 'hotkey:set-toggle-strip',
  NotifyTest: 'notify:test',
  NotifySupported: 'notify:is-supported',
  NotifyOpenSettings: 'notify:open-settings',
  WinMinimize: 'win:minimize',
  WinMaximizeToggle: 'win:maximize-toggle',
  WinHide: 'win:hide',
  WinSelfHide: 'win:self-hide',
  WinCloseQuickAdd: 'win:close-quickadd',
  WinOpenEditor: 'win:open-editor',
  EventDataChanged: 'event:data-changed',
  EventShowMain: 'event:show-main',
  EventQuickAddFocusInput: 'event:quickadd-focus-input',
  CollapseStrip: 'win:collapse-strip',
  StripToggle: 'win:strip-toggle',
  ExpandMain: 'win:expand-main',
  EventStripState: 'strip:state',
} as const;

export type R<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
export const ok = <T>(data: T): R<T> => ({ ok: true, data });
export const fail = (code: string, message: string): R<never> => ({ ok: false, code, message });

export class IpcError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'IpcError';
  }
}

export function unwrap<T>(env: R<T>): T {
  if (env.ok) return env.data;
  throw new IpcError(env.code, env.message);
}

export async function unwrapAsync<T>(p: Promise<R<T>>): Promise<T> {
  return unwrap(await p);
}

export interface PreviewRequest {
  draft: TodoDraft;
  todoId?: number;
}

export interface ShowMainPayload {
  focusTodo?: { todoId: number; date: string };
  quickAddDraft?: string; // 快添窗 Ctrl+Enter 预填标题
}

export interface StripState {
  expanded: boolean;
}

/** 导出结果：用户取消时 saved=false */
export interface ExportResult {
  saved: boolean;
  path?: string;
}

export interface Api {
  todos: {
    list(range: OccurrenceQuery): Promise<OccurrenceItem[]>;
    listAll(status: 'all' | 'open' | 'done'): Promise<Todo[]>;
    create(draft: TodoDraft): Promise<Todo>;
    update(id: number, patch: Partial<TodoDraft>): Promise<Todo | null>;
    remove(id: number): Promise<void>;
    complete(todoId: number, date?: string): Promise<void>;
    setStatus(todoId: number, date: string, status: OccurrenceStatus): Promise<void>;
    snooze(todoId: number, date: string, minutes: number): Promise<void>;
    preview(req: PreviewRequest): Promise<string[]>;
    startTimer(todoId: number, date?: string): Promise<void>;
    pauseTimer(todoId: number, date?: string): Promise<void>;
    history(todoId: number, limit?: number): Promise<OccurrenceHistory>;
  };
  settings: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
  };
  autostart: { get(): Promise<boolean>; set(enabled: boolean): Promise<void> };
  hotkey: { set(accelerator: string): Promise<void>; setShowMain(accelerator: string): Promise<void>; setToggleStrip(accelerator: string): Promise<void> };
  notifyTest(): Promise<void>;
  notifySupported(): Promise<boolean>;
  openNotifySettings(): Promise<void>;
  dbPath(): Promise<string>;
  openDbFolder(): Promise<void>;
  exportData(): Promise<ExportResult>;
  exportLogs(): Promise<ExportResult>;
  win: {
    minimize(): Promise<void>;
    maximizeToggle(): Promise<void>;
    hideToTray(): Promise<void>;
    selfHide(): Promise<void>;
    closeQuickAdd(): Promise<void>;
    openEditor(title: string): Promise<void>;
    collapseStrip(): Promise<void>;
    stripToggle(): Promise<void>;
    expandMain(): Promise<void>;
  };
  onDataChanged(cb: () => void): () => void;
  onShowMain(cb: (p: ShowMainPayload) => void): () => void;
  onQuickAddFocusInput(cb: () => void): () => void;
  onStripState(cb: (state: StripState) => void): () => void;
  stats: {
    summary(): Promise<StatsSummary>;
  };
}
