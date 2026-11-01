import type { Todo, OccurrenceStatus, TimerState } from './types';

export const EXPORT_FORMAT = 'whchem-todo-export';
export const EXPORT_VERSION = 1;

export interface ExportOccurrenceState {
  todoId: number;
  date: string;
  status: OccurrenceStatus;
  completedAt: number | null;
}

export type ExportTimer = { todoId: number; date: string } & TimerState;

/** 导出文件结构（带版本，便于将来排查/导入） */
export interface ExportPayload {
  format: typeof EXPORT_FORMAT;
  version: number;
  schemaVersion: number;
  exportedAt: number;
  appVersion: string;
  data: {
    todos: Todo[];
    occurrenceStates: ExportOccurrenceState[];
    timers: ExportTimer[];
    settings: Record<string, unknown>;
  };
}
