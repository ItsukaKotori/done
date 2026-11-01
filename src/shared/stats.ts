export interface StatsDailyPoint {
  date: string;
  done: number;
}

export interface StatsSummary {
  todayDone: number;
  weekDone: number;
  totalFocusMs: number;
  overdueActive: number;
  daily: StatsDailyPoint[]; // 近 14 天，按日期升序
}
