import type { Db } from './index';
import type {
  Todo, TodoDraft, OccurrenceStatus, Priority, RepeatType, MonthlyMode, TimerState,
} from '@shared/types';
import { normalizeTags } from '@shared/tags';

interface TodoRow {
  id: number; title: string; notes: string | null; priority: number;
  due_date: string | null; time_of_day: string | null;
  repeat_type: string; repeat_interval: number | null; repeat_weekdays: string | null;
  monthly_mode: string | null; monthly_day: number | null;
  monthly_weekday: number | null; monthly_which: number | null;
  start_date: string | null; completed_at: number | null;
  created_at: number; updated_at: number; tags: string | null;
}

const unpack = (r: TodoRow): Todo => ({
  id: r.id, title: r.title, notes: r.notes, priority: r.priority as Priority,
  dueDate: r.due_date, timeOfDay: r.time_of_day,
  repeatType: r.repeat_type as RepeatType,
  repeatInterval: r.repeat_interval,
  repeatWeekdays: r.repeat_weekdays ? (JSON.parse(r.repeat_weekdays) as number[]) : null,
  monthlyMode: r.monthly_mode as MonthlyMode | null,
  monthlyDay: r.monthly_day, monthlyWeekday: r.monthly_weekday, monthlyWhich: r.monthly_which,
  startDate: r.start_date, completedAt: r.completed_at,
  createdAt: r.created_at, updatedAt: r.updated_at,
  tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
});

const pack = (t: Partial<Todo>, now: number) => ({
  title: t.title ?? '', notes: t.notes ?? null, priority: t.priority ?? 1,
  dueDate: t.dueDate ?? null, timeOfDay: t.timeOfDay ?? null,
  repeatType: t.repeatType ?? 'none', repeatInterval: t.repeatInterval ?? null,
  repeatWeekdays: t.repeatWeekdays ? JSON.stringify(t.repeatWeekdays) : null,
  monthlyMode: t.monthlyMode ?? null, monthlyDay: t.monthlyDay ?? null,
  monthlyWeekday: t.monthlyWeekday ?? null, monthlyWhich: t.monthlyWhich ?? null,
  startDate: t.startDate ?? null, completedAt: t.completedAt ?? null,
  createdAt: t.createdAt ?? now, updatedAt: now,
  tags: JSON.stringify(normalizeTags(t.tags ?? [])),
});

const COLS = `id, title, notes, priority, due_date, time_of_day, repeat_type,
  repeat_interval, repeat_weekdays, monthly_mode, monthly_day, monthly_weekday,
  monthly_which, start_date, completed_at, created_at, updated_at, tags`;

export class TodoDao {
  constructor(private db: Db) {}

  create(draft: TodoDraft): Todo {
    const now = Date.now();
    const p = pack(draft, now);
    const info = this.db.prepare(
      `INSERT INTO todos (title, notes, priority, due_date, time_of_day, repeat_type,
        repeat_interval, repeat_weekdays, monthly_mode, monthly_day, monthly_weekday,
        monthly_which, start_date, completed_at, created_at, updated_at, tags)
       VALUES (@title, @notes, @priority, @dueDate, @timeOfDay, @repeatType,
        @repeatInterval, @repeatWeekdays, @monthlyMode, @monthlyDay, @monthlyWeekday,
        @monthlyWhich, @startDate, @completedAt, @createdAt, @updatedAt, @tags)`,
    ).run(p);
    return this.getById(Number(info.lastInsertRowid))!;
  }

  getById(id: number): Todo | null {
    const row = this.db.prepare(`SELECT ${COLS} FROM todos WHERE id=?`).get(id) as TodoRow | undefined;
    return row ? unpack(row) : null;
  }

  update(id: number, patch: Partial<TodoDraft>): Todo | null {
    const cur = this.getById(id);
    if (!cur) return null;
    const merged: Partial<Todo> = { ...cur, ...patch, id, createdAt: cur.createdAt };
    const p = pack(merged, Date.now());
    this.db.prepare(
      `UPDATE todos SET title=@title, notes=@notes, priority=@priority, due_date=@dueDate,
        time_of_day=@timeOfDay, repeat_type=@repeatType, repeat_interval=@repeatInterval,
        repeat_weekdays=@repeatWeekdays, monthly_mode=@monthlyMode, monthly_day=@monthlyDay,
        monthly_weekday=@monthlyWeekday, monthly_which=@monthlyWhich, start_date=@startDate,
        completed_at=@completedAt, updated_at=@updatedAt, tags=@tags WHERE id=@id`,
    ).run({ ...p, id });
    return this.getById(id);
  }

  deleteById(id: number): void {
    this.db.prepare('DELETE FROM todos WHERE id=?').run(id);
  }

  listActive(): Todo[] {
    return (this.db.prepare(
      `SELECT ${COLS} FROM todos WHERE completed_at IS NULL ORDER BY id`,
    ).all() as TodoRow[]).map(unpack);
  }

  listAll(status: 'all' | 'open' | 'done'): Todo[] {
    const where = status === 'open' ? 'WHERE completed_at IS NULL'
      : status === 'done' ? 'WHERE completed_at IS NOT NULL' : '';
    return (this.db.prepare(
      `SELECT ${COLS} FROM todos ${where} ORDER BY id DESC`,
    ).all() as TodoRow[]).map(unpack);
  }

  setCompleted(id: number, at: number): void {
    this.db.prepare('UPDATE todos SET completed_at=?, updated_at=? WHERE id=?').run(at, at, id);
  }
}

export class OccurrenceDao {
  constructor(private db: Db) {}

  setState(todoId: number, date: string, status: OccurrenceStatus, completedAt: number | null = null): void {
    this.db.prepare(
      `INSERT INTO occurrence_states (todo_id, occurrence_date, status, completed_at) VALUES (?,?,?,?)
       ON CONFLICT(todo_id, occurrence_date) DO UPDATE SET status=excluded.status, completed_at=excluded.completed_at`,
    ).run(todoId, date, status, completedAt);
  }

  /** 状态行只记录 done/skipped；"active"（恢复）= 删行 */
  deleteState(todoId: number, date: string): void {
    this.db.prepare('DELETE FROM occurrence_states WHERE todo_id=? AND occurrence_date=?')
      .run(todoId, date);
  }

  getState(todoId: number, date: string): OccurrenceStatus | null {
    const row = this.db.prepare(
      'SELECT status FROM occurrence_states WHERE todo_id=? AND occurrence_date=?',
    ).get(todoId, date) as { status: OccurrenceStatus } | undefined;
    return row?.status ?? null;
  }

  getByTodo(todoId: number): Map<string, OccurrenceStatus> {
    const rows = this.db.prepare(
      'SELECT occurrence_date, status FROM occurrence_states WHERE todo_id=?',
    ).all(todoId) as Array<{ occurrence_date: string; status: OccurrenceStatus }>;
    return new Map(rows.map(r => [r.occurrence_date, r.status]));
  }

  /** 带完成时间的逐期明细（历史弹窗用） */
  getDetailsByTodo(todoId: number): Map<string, { status: OccurrenceStatus; completedAt: number | null }> {
    const rows = this.db.prepare(
      'SELECT occurrence_date, status, completed_at FROM occurrence_states WHERE todo_id=?',
    ).all(todoId) as Array<{ occurrence_date: string; status: OccurrenceStatus; completed_at: number | null }>;
    return new Map(rows.map(r => [r.occurrence_date, { status: r.status, completedAt: r.completed_at }]));
  }

  /** 导出用：全部 occurrence 状态 */
  listAll(): Array<{ todoId: number; date: string; status: OccurrenceStatus; completedAt: number | null }> {
    const rows = this.db.prepare(
      'SELECT todo_id, occurrence_date, status, completed_at FROM occurrence_states ORDER BY todo_id, occurrence_date',
    ).all() as Array<{
      todo_id: number; occurrence_date: string; status: OccurrenceStatus; completed_at: number | null;
    }>;
    return rows.map(r => ({
      todoId: r.todo_id, date: r.occurrence_date, status: r.status, completedAt: r.completed_at,
    }));
  }
}

export type ReminderStatus = 'pending' | 'fired' | 'snoozed' | 'dismissed';

export interface Reminder {
  id: number; todoId: number; occurrenceDate: string; fireAt: number; status: ReminderStatus;
}

interface ReminderRow {
  id: number; todo_id: number; occurrence_date: string; fire_at: number; status: ReminderStatus;
}

const unpackR = (r: ReminderRow): Reminder => ({
  id: r.id, todoId: r.todo_id, occurrenceDate: r.occurrence_date, fireAt: r.fire_at, status: r.status,
});

export class ReminderDao {
  constructor(private db: Db) {}

  insertPending(todoId: number, date: string, fireAt: number): void {
    const existing = this.db.prepare(
      `SELECT id FROM reminders WHERE todo_id=? AND occurrence_date=? AND status IN ('pending','snoozed')`,
    ).get(todoId, date);
    if (existing) return; // 幂等：同发生日不重复排队
    this.db.prepare(
      `INSERT INTO reminders (todo_id, occurrence_date, fire_at, status, created_at)
       VALUES (?,?,?, 'pending', ?)`,
    ).run(todoId, date, fireAt, Date.now());
  }

  insertSnoozed(todoId: number, date: string, fireAt: number): void {
    this.db.prepare(
      `INSERT INTO reminders (todo_id, occurrence_date, fire_at, status, snoozed_until, created_at)
       VALUES (?,?,?, 'snoozed', ?, ?)`,
    ).run(todoId, date, fireAt, fireAt, Date.now());
  }

  dismissFor(todoId: number): void {
    this.db.prepare(
      `UPDATE reminders SET status='dismissed' WHERE todo_id=? AND status IN ('pending','snoozed')`,
    ).run(todoId);
  }

  nextPending(now: number): Reminder | null {
    const row = this.db.prepare(
      `SELECT id, todo_id, occurrence_date, fire_at, status FROM reminders
       WHERE status IN ('pending','snoozed') AND fire_at > ? ORDER BY fire_at LIMIT 1`,
    ).get(now) as ReminderRow | undefined;
    return row ? unpackR(row) : null;
  }

  listExpired(now: number): Reminder[] {
    return (this.db.prepare(
      `SELECT id, todo_id, occurrence_date, fire_at, status FROM reminders
       WHERE status IN ('pending','snoozed') AND fire_at <= ? ORDER BY fire_at`,
    ).all(now) as ReminderRow[]).map(unpackR);
  }

  markFired(ids: number[]): void {
    if (!ids.length) return;
    const ph = ids.map(() => '?').join(',');
    this.db.prepare(`UPDATE reminders SET status='fired' WHERE id IN (${ph})`).run(...ids);
  }
}

export class SettingsDao {
  constructor(private db: Db) {}

  get<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?')
      .get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }

  set<T>(key: string, value: T): void {
    this.db.prepare(
      `INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).run(key, JSON.stringify(value));
  }

  /** 导出用：全部设置的解析值 */
  all(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string; value: string;
    }>;
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.value);
      } catch {
        out[r.key] = r.value; // 异常值原样保留，不让导出整体失败
      }
    }
    return out;
  }
}

interface TimerRow {
  todo_id: number; occurrence_date: string;
  accumulated_ms: number; running_since: number | null; total_ms: number | null;
}

const unpackT = (r: TimerRow): TimerState => ({
  accumulatedMs: r.accumulated_ms, runningSince: r.running_since, totalMs: r.total_ms,
});

const TIMER_COLS = 'todo_id, occurrence_date, accumulated_ms, running_since, total_ms';

export class TimerDao {
  constructor(private db: Db) {}

  get(todoId: number, date: string): TimerState | null {
    const row = this.db.prepare(
      `SELECT ${TIMER_COLS} FROM task_timers WHERE todo_id=? AND occurrence_date=?`,
    ).get(todoId, date) as TimerRow | undefined;
    return row ? unpackT(row) : null;
  }

  getByTodo(todoId: number): Map<string, TimerState> {
    const rows = this.db.prepare(
      `SELECT ${TIMER_COLS} FROM task_timers WHERE todo_id=?`,
    ).all(todoId) as TimerRow[];
    return new Map(rows.map(r => [r.occurrence_date, unpackT(r)]));
  }

  /** 不存在则插入默认行后合并 patch；显式 null 会覆盖 */
  upsert(todoId: number, date: string, patch: Partial<TimerState>): void {
    const cur = this.get(todoId, date) ?? { accumulatedMs: 0, runningSince: null, totalMs: null };
    const next = { ...cur, ...patch };
    this.db.prepare(
      `INSERT INTO task_timers (todo_id, occurrence_date, accumulated_ms, running_since, total_ms)
       VALUES (?,?,?,?,?)
       ON CONFLICT(todo_id, occurrence_date) DO UPDATE SET
         accumulated_ms=excluded.accumulated_ms,
         running_since=excluded.running_since,
         total_ms=excluded.total_ms`,
    ).run(todoId, date, next.accumulatedMs, next.runningSince, next.totalMs);
  }

  /** 单任务约束：把所有运行中的计时累计并停止 */
  pauseAllRunning(now: number): void {
    this.db.prepare(
      `UPDATE task_timers
       SET accumulated_ms = accumulated_ms + (? - running_since), running_since = NULL
       WHERE running_since IS NOT NULL`,
    ).run(now);
  }

  /** 暂停指定单元（非运行中则空操作） */
  pause(todoId: number, date: string, now: number): void {
    this.db.prepare(
      `UPDATE task_timers
       SET accumulated_ms = accumulated_ms + (? - running_since), running_since = NULL
       WHERE todo_id=? AND occurrence_date=? AND running_since IS NOT NULL`,
    ).run(now, todoId, date);
  }

  /** 完成时冻结 total_ms（含当前运行段）；无记录则空操作 */
  settle(todoId: number, date: string, now: number): void {
    const cur = this.get(todoId, date);
    if (!cur) return;
    const total = cur.accumulatedMs + (cur.runningSince != null ? now - cur.runningSince : 0);
    this.upsert(todoId, date, { accumulatedMs: total, runningSince: null, totalMs: total });
  }

  /** 取消完成：清 total 与 running，保留 accumulated 供后续继续累加 */
  resetCompleted(todoId: number, date: string): void {
    this.db.prepare(
      `UPDATE task_timers SET total_ms=NULL, running_since=NULL
       WHERE todo_id=? AND occurrence_date=?`,
    ).run(todoId, date);
  }

  /** 导出用：全部计时行 */
  listAll(): Array<{ todoId: number; date: string } & TimerState> {
    const rows = this.db.prepare(
      `SELECT ${TIMER_COLS} FROM task_timers ORDER BY todo_id, occurrence_date`,
    ).all() as TimerRow[];
    return rows.map(r => ({ todoId: r.todo_id, date: r.occurrence_date, ...unpackT(r) }));
  }
}
