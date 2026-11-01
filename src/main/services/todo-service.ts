import type { TodoDao, OccurrenceDao, TimerDao } from '../db/dao';
import type {
  Todo, TodoDraft, OccurrenceItem, RecurrenceSpec, OccurrenceStatus,
} from '@shared/types';
import type { OccurrenceHistory } from '@shared/history';
import {
  occurrencesInRange, nextOccurrences, todayStr, dateToLocalMs, dateToNum,
} from '@shared/recurrence';

const toSpec = (t: RecurrenceSpec): RecurrenceSpec => ({
  repeatType: t.repeatType, repeatInterval: t.repeatInterval, repeatWeekdays: t.repeatWeekdays,
  monthlyMode: t.monthlyMode, monthlyDay: t.monthlyDay,
  monthlyWeekday: t.monthlyWeekday, monthlyWhich: t.monthlyWhich,
});

export class TodoService {
  constructor(
    private todos: TodoDao,
    private occ: OccurrenceDao,
    private timers: TimerDao,
    private clock: () => number = Date.now,
  ) {}

  /** 计时键：一次性任务用 '' 哨兵，重复任务用发生日 */
  private timerKey(t: Todo, date?: string): string {
    return t.repeatType === 'none' ? '' : (date ?? '');
  }

  startTimer(todoId: number, date?: string): void {
    const t = this.todos.getById(todoId);
    if (!t) return;
    const now = this.clock();
    this.timers.pauseAllRunning(now); // 单任务约束
    this.timers.upsert(todoId, this.timerKey(t, date), { runningSince: now, totalMs: null });
  }

  pauseTimer(todoId: number, date?: string): void {
    const t = this.todos.getById(todoId);
    if (!t) return;
    this.timers.pause(todoId, this.timerKey(t, date), this.clock());
  }

  create(draft: TodoDraft): Todo {
    const normalized: TodoDraft = { ...draft };
    // 统一锚点：重复与一次性都用 startDate 驱动展开（规格 §3.1）
    if (!normalized.startDate) normalized.startDate = normalized.dueDate;
    return this.todos.create(normalized);
  }

  update(id: number, patch: Partial<TodoDraft>): Todo | null {
    const cur = this.todos.getById(id);
    if (!cur) return null;
    const next: Partial<TodoDraft> = { ...patch };
    // 锚点不变式与 create 一致：改期即改锚。调用方（编辑对话框）会原样回传旧 startDate，
    // 仅当 patch 未携带锚点或锚点仍等于旧值（未被真正改动）时才重算（终审严重-1）。
    if (
      patch.dueDate !== undefined &&
      (patch.startDate === undefined || patch.startDate === cur.startDate)
    ) {
      next.startDate = patch.dueDate;
    }
    return this.todos.update(id, next);
  }

  getById(id: number): Todo | null {
    return this.todos.getById(id);
  }

  remove(id: number): void {
    this.todos.deleteById(id);
  }

  listAll(status: 'all' | 'open' | 'done'): Todo[] {
    return this.todos.listAll(status).map(t =>
      t.repeatType === 'none'
        ? { ...t, timer: this.timers.get(t.id, '') }
        : { ...t, timer: null },
    );
  }

  /** 已展开的扁平发生日条目（规格 §4：UI 不实现 RRULE 逻辑） */
  list(from: string, to: string): OccurrenceItem[] {
    const out: OccurrenceItem[] = [];
    const today = todayStr(this.clock());
    for (const t of this.todos.listAll('all')) {
      const anchor = t.startDate ?? t.dueDate;
      if (!anchor) continue;
      const timerMap = this.timers.getByTodo(t.id);
      if (t.repeatType === 'none') {
        if (dateToNum(anchor) < dateToNum(from) || dateToNum(anchor) > dateToNum(to)) continue;
        out.push({
          ...this.item(t, anchor, t.completedAt != null ? 'done' : 'active', today),
          timer: timerMap.get('') ?? null,
        });
      } else {
        const states = this.occ.getByTodo(t.id);
        for (const d of occurrencesInRange(toSpec(t), anchor, from, to)) {
          out.push({
            ...this.item(t, d, states.get(d) ?? 'active', today),
            timer: timerMap.get(d) ?? null,
          });
        }
      }
    }
    return out.sort((a, b) => dateToNum(a.date) - dateToNum(b.date) || a.todoId - b.todoId);
  }

  private item(t: Todo, date: string, state: OccurrenceStatus, today: string): OccurrenceItem {
    const overdue = state === 'active' && (
      dateToNum(date) < dateToNum(today)
      || (date === today && !!t.timeOfDay && dateToLocalMs(date, t.timeOfDay) < this.clock())
    );
    return {
      todoId: t.id, date, title: t.title, priority: t.priority,
      timeOfDay: t.timeOfDay, repeatType: t.repeatType, state, overdue,
    };
  }

  complete(todoId: number, date?: string): void {
    const t = this.todos.getById(todoId);
    if (!t) return;
    const now = this.clock();
    this.timers.settle(todoId, this.timerKey(t, date), now);
    if (t.repeatType === 'none') this.todos.setCompleted(todoId, now);
    else if (date) this.occ.setState(todoId, date, 'done', now);
  }

  setStatus(todoId: number, date: string, status: OccurrenceStatus): void {
    const t = this.todos.getById(todoId);
    if (!t) return;
    const now = this.clock();
    const key = this.timerKey(t, date);
    if (t.repeatType === 'none') {
      // 一次性任务无"跳过"维度：done 映射为完成，active 映射为取消完成；skipped 忽略
      if (status === 'done') {
        this.timers.settle(todoId, key, now);
        this.todos.setCompleted(todoId, now);
      } else if (status === 'active') {
        this.timers.resetCompleted(todoId, key);
        this.todos.update(todoId, { completedAt: null });
      }
      return;
    }
    // 重复任务：active = 恢复为正常待办，删除状态行
    if (status === 'active') {
      this.timers.resetCompleted(todoId, key);
      this.occ.deleteState(todoId, date);
    } else {
      if (status === 'done') this.timers.settle(todoId, key, now);
      this.occ.setState(todoId, date, status, status === 'done' ? now : null);
    }
  }

  /**
   * 重复任务的逐期完成记录：起点到今天（含）的所有期次，按日期倒序。
   * 一次性任务返回空汇总（其完成情况看 completedAt）。
   */
  occurrenceHistory(todoId: number, limit = 60): OccurrenceHistory {
    const empty: OccurrenceHistory = { doneCount: 0, skippedCount: 0, total: 0, rate: 0, items: [] };
    const t = this.todos.getById(todoId);
    if (!t || t.repeatType === 'none') return empty;
    const anchor = t.startDate ?? t.dueDate;
    if (!anchor) return empty;

    const today = todayStr(this.clock());
    if (dateToNum(anchor) > dateToNum(today)) return empty;

    const details = this.occ.getDetailsByTodo(todoId);
    const dates = occurrencesInRange(toSpec(t), anchor, anchor, today);
    const all = dates.map(d => {
      const detail = details.get(d);
      return {
        date: d,
        state: (detail?.status ?? 'active') as OccurrenceStatus,
        doneAt: detail?.completedAt ?? null,
      };
    });

    const doneCount = all.filter(i => i.state === 'done').length;
    const skippedCount = all.filter(i => i.state === 'skipped').length;
    const total = all.length;
    const rate = total ? Math.round((doneCount / total) * 100) : 0;
    const items = [...all].reverse().slice(0, Math.max(1, limit));

    return { doneCount, skippedCount, total, rate, items };
  }

  /**
   * 编辑对话框"下次出现"预览：含今天起前 count 个发生日（规格 §5.5）。
   * 编辑既有任务时显式传 todoId 以排除已 done/skipped 的发生日；
   * 新建预览不传，exclude 为空集。
   */
  preview(draft: TodoDraft, count = 5, todoId?: number): string[] {
    const today = todayStr(this.clock());
    const anchor = draft.startDate ?? draft.dueDate ?? today;
    if (draft.repeatType === 'none') {
      return dateToNum(anchor) >= dateToNum(today) ? [anchor] : [];
    }
    const exclude = new Set<string>();
    if (todoId != null) {
      for (const [d, s] of this.occ.getByTodo(todoId)) if (s !== 'active') exclude.add(d);
    }
    // "今天"单独判断命中，剩余量由 nextOccurrences（今天之后）补齐
    const todayHit = occurrencesInRange(toSpec(draft), anchor, today, today).filter(d => !exclude.has(d));
    const rest = nextOccurrences(toSpec(draft), anchor, today, count - todayHit.length,
      new Set([...exclude, ...todayHit]));
    return [...todayHit, ...rest];
  }
}
