export type Priority = 0 | 1 | 2;
export type RepeatType = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom';
export type MonthlyMode = 'by_date' | 'by_weekday';
export type OccurrenceStatus = 'active' | 'done' | 'skipped';

export interface RecurrenceSpec {
  repeatType: RepeatType;
  repeatInterval?: number | null;   // custom：每 N 天，>=1
  repeatWeekdays?: number[] | null; // weekly：0=周日 .. 6=周六
  monthlyMode?: MonthlyMode | null;
  monthlyDay?: number | null;       // by_date：目标日 1..31（当月无该日则跳过该月）
  monthlyWeekday?: number | null;   // by_weekday：目标周几 0..6
  monthlyWhich?: number | null;     // by_weekday：第 N 个 1..5，5=最后一个
}

export interface Todo extends RecurrenceSpec {
  id: number;
  title: string;
  notes: string | null;
  priority: Priority;
  dueDate: string | null;      // YYYY-MM-DD
  timeOfDay: string | null;    // HH:mm；null = 不发提醒
  startDate: string | null;    // 重复序列锚点（展开函数的 start 参数统一来源）
  completedAt: number | null;  // 仅一次性任务
  createdAt: number;
  updatedAt: number;
  timer?: TimerState | null;   // 仅一次性任务；重复任务为 null
  tags: string[];              // 单层标签（已归一化）
}

/** 草稿：tags 可选（旧构造无需改动），持久化时归一化并补 [] */
export type TodoDraft =
  Omit<Todo, 'id' | 'createdAt' | 'updatedAt' | 'tags'> & { tags?: string[] };

export interface OccurrenceItem {
  todoId: number;
  date: string;
  title: string;
  priority: Priority;
  timeOfDay: string | null;
  repeatType: RepeatType;
  state: OccurrenceStatus;
  overdue: boolean;
  timer?: TimerState | null;   // 该期计时状态
}

export interface TimerState {
  accumulatedMs: number;
  runningSince: number | null;
  totalMs: number | null;
}

export interface OccurrenceQuery {
  from: string;
  to: string;
}
