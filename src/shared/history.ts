import type { OccurrenceStatus } from './types';

export interface OccurrenceHistoryItem {
  date: string;
  state: OccurrenceStatus;
  doneAt: number | null; // 完成时间戳；非 done 为 null
}

export interface OccurrenceHistory {
  doneCount: number;
  skippedCount: number;
  total: number;   // 起点到今天（含）的期数
  rate: number;    // 完成率百分比（0-100，四舍五入）
  items: OccurrenceHistoryItem[]; // 最近若干期，倒序
}
