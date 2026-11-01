import type { ReminderDao, TodoDao, OccurrenceDao } from '../db/dao';
import type { Todo, RecurrenceSpec } from '@shared/types';
import { dateToLocalMs, nextOccurrences, todayStr, addDays, dateToNum } from '@shared/recurrence';

export interface NotifyItem {
  todoId: number; occurrenceDate: string; title: string; timeOfDay: string | null; overdue: boolean;
}

export interface SchedulerDeps {
  now: () => number;
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  notify: (items: NotifyItem[]) => void;
}

const toSpec = (t: RecurrenceSpec): RecurrenceSpec => ({
  repeatType: t.repeatType, repeatInterval: t.repeatInterval, repeatWeekdays: t.repeatWeekdays,
  monthlyMode: t.monthlyMode, monthlyDay: t.monthlyDay,
  monthlyWeekday: t.monthlyWeekday, monthlyWhich: t.monthlyWhich,
});

export class Scheduler {
  private timer: unknown = null;
  private pausedUntil = 0;

  constructor(
    private rem: ReminderDao,
    private todos: TodoDao,
    private deps: SchedulerDeps,
    /** 可选：感知重复任务逐期状态（done/skipped），完成/跳过后排下一期而非当期（终审重要-2） */
    private occ?: Pick<OccurrenceDao, 'getByTodo'>,
  ) {}

  /** 应用启动 / powerMonitor resume：补发过期 → 滚动排下一期 → 重排 timer（规格 §4.1 规则2） */
  start(): void {
    const due = this.rem.listExpired(this.deps.now());
    if (due.length) {
      this.deliver(due);
      this.rollForward(due);
    }
    this.arm();
  }

  syncAll(): void {
    for (const t of this.todos.listActive()) this.enqueueFor(t);
    this.arm();
  }

  /** 任务增改删后：dismiss 旧 pending → 重排（规格 §4.1 规则3） */
  syncFor(todo: Todo): void {
    this.rem.dismissFor(todo.id);
    this.enqueueFor(todo);
    this.arm();
  }

  snooze(todoId: number, date: string, minutes: number): void {
    this.rem.insertSnoozed(todoId, date, this.deps.now() + minutes * 60_000);
    this.arm();
  }

  pause(ms: number): void {
    this.pausedUntil = this.deps.now() + ms;
  }

  tick(): void {
    const due = this.rem.listExpired(this.deps.now());
    if (due.length) {
      this.deliver(due);
      this.rollForward(due);
    }
    this.arm();
  }

  /** 触发过的任务滚动排下一期（规格 §3.3） */
  private rollForward(due: ReturnType<ReminderDao['listExpired']>): void {
    for (const todoId of new Set(due.map(r => r.todoId))) {
      const t = this.todos.listActive().find(x => x.id === todoId);
      if (t) this.enqueueFor(t);
    }
  }

  /** 单指针：永远只排一个 timer（规格 §4.1 规则1）；延迟钳制在 32 位上限内，
   * 远期提醒由 tick 的空转重排逐段逼近，避免 setTimeout 溢出退化为 1ms 忙循环 */
  private arm(): void {
    if (this.timer !== null) { this.deps.clearTimer(this.timer); this.timer = null; }
    const next = this.rem.nextPending(this.deps.now());
    if (!next) return;
    const delay = Math.max(1_000, next.fireAt - this.deps.now());
    this.timer = this.deps.setTimer(() => this.tick(), Math.min(delay, 2_147_000_000));
  }

  private deliver(due: ReturnType<ReminderDao['listExpired']>): void {
    this.rem.markFired(due.map(r => r.id)); // 先消费：暂停/失败都不重复投递
    if (this.deps.now() < this.pausedUntil) return;
    const today = todayStr(this.deps.now());
    const active = this.todos.listActive();
    this.deps.notify(due.map(r => {
      const t = active.find(x => x.id === r.todoId);
      return {
        todoId: r.todoId,
        occurrenceDate: r.occurrenceDate,
        title: t?.title ?? '任务',
        timeOfDay: t?.timeOfDay ?? null,
        overdue: r.occurrenceDate < today
          || dateToLocalMs(r.occurrenceDate, t?.timeOfDay ?? '00:00') < this.deps.now(),
      };
    }));
  }

  /** 为任务排"今天或未来第一个尚未过点的发生日"（规格 §3.3） */
  private enqueueFor(todo: Todo): void {
    if (!todo.timeOfDay || todo.completedAt != null) return;
    const now = this.deps.now();
    const today = todayStr(now);
    const anchor = todo.startDate ?? todo.dueDate;
    if (!anchor) return;

    let fireDate: string | undefined;
    if (todo.repeatType === 'none') {
      if (dateToNum(anchor) < dateToNum(today)) return; // 已过期的一次性不再排
      fireDate = anchor;
    } else {
      // 排除已 done/skipped 的发生日；今天已完成/跳过则顺延下一期（终审重要-2）
      const exclude = this.nonActiveDates(todo);
      const occursToday = dateToNum(anchor) <= dateToNum(today)
        && nextOccurrences(toSpec(todo), anchor, addDays(today, -1), 1, exclude)[0] === today;
      fireDate = occursToday && dateToLocalMs(today, todo.timeOfDay) > now
        ? today
        : nextOccurrences(toSpec(todo), anchor, today, 1, exclude)[0];
    }
    if (!fireDate) return;
    const fireAt = dateToLocalMs(fireDate, todo.timeOfDay);
    // 过点不重排：一次性 fired 消费即止，避免每次 start 重复补发
    if (fireAt <= now) return;
    this.rem.insertPending(todo.id, fireDate, fireAt);
  }

  private nonActiveDates(todo: Todo): Set<string> {
    const out = new Set<string>();
    if (!this.occ) return out;
    for (const [d, s] of this.occ.getByTodo(todo.id)) if (s !== 'active') out.add(d);
    return out;
  }
}
