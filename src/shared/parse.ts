// src/shared/parse.ts
import type { Priority, RecurrenceSpec, TodoDraft } from './types';
import { todayStr } from './recurrence';
import { normalizeTags } from './tags';

export interface ParsedTask {
  title: string;
  dueDate: string | null;    // YYYY-MM-DD，已按 today 锚点解析为绝对日期
  timeOfDay: string | null;  // HH:mm
  priority: Priority;
  tags: string[];
  startDate?: string | null; // YYYY-MM-DD，重复序列锚点（可选，默认 null）
  repeat: RecurrenceSpec;
  source: 'rules' | 'ai';
}

export function emptyRepeat(): RecurrenceSpec {
  return {
    repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
    monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  };
}

/** ParsedTask → 快添/编辑器预填的 TodoDraft；无日期的一次性任务落到今天（现状行为） */
export function parsedToDraft(p: ParsedTask, nowMs: number): TodoDraft {
  const r = p.repeat;
  return {
    title: p.title, notes: null,
    dueDate: p.dueDate ?? todayStr(nowMs),
    timeOfDay: p.timeOfDay,
    priority: p.priority,
    repeatType: r.repeatType,
    repeatInterval: r.repeatInterval ?? null,
    repeatWeekdays: r.repeatWeekdays ?? null,
    monthlyMode: r.monthlyMode ?? null,
    monthlyDay: r.monthlyDay ?? null,
    monthlyWeekday: r.monthlyWeekday ?? null,
    monthlyWhich: r.monthlyWhich ?? null,
    startDate: p.startDate ?? null,
    completedAt: null,
    tags: normalizeTags(p.tags),
  };
}
