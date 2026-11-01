import type { TodoDao, OccurrenceDao, TimerDao } from '../db/dao';
import type { TodoService } from './todo-service';
import { addDays, todayStr } from '@shared/recurrence';
import type { StatsDailyPoint, StatsSummary } from '@shared/stats';

const DAILY_DAYS = 14;

/** 复盘聚合：完成数、专注时长、逾期数。数据全部来自既有表，不新增存储。 */
export class StatsService {
  constructor(
    private todos: TodoDao,
    private occ: OccurrenceDao,
    private timers: TimerDao,
    private todoService: TodoService,
    private clock: () => number = Date.now,
  ) {}

  summary(): StatsSummary {
    const today = todayStr(this.clock());
    const countByDate = new Map<string, number>();
    const bump = (d: string) => countByDate.set(d, (countByDate.get(d) ?? 0) + 1);

    // 一次性：completedAt 的本地日期；重复：occurrence_states 的 done 日期
    for (const t of this.todos.listAll('all')) {
      if (t.repeatType === 'none' && t.completedAt != null) bump(todayStr(t.completedAt));
    }
    for (const o of this.occ.listAll()) {
      if (o.status === 'done') bump(o.date);
    }

    const daily: StatsDailyPoint[] = [];
    for (let i = DAILY_DAYS - 1; i >= 0; i--) {
      const d = addDays(today, -i);
      daily.push({ date: d, done: countByDate.get(d) ?? 0 });
    }

    const todayDone = countByDate.get(today) ?? 0;

    // 周一为一周起点
    const dow = new Date(`${today}T00:00:00`).getDay(); // 0=周日
    const mondayOffset = (dow + 6) % 7;
    let weekDone = 0;
    for (let i = 0; i <= mondayOffset; i++) {
      weekDone += countByDate.get(addDays(today, -i)) ?? 0;
    }

    const totalFocusMs = this.timers.listAll().reduce((s, r) => s + (r.totalMs ?? 0), 0);

    // 逾期未完成（按 todo 去重，与今日视图口径一致）
    const overdue = new Set<number>();
    for (const it of this.todoService.list('2020-01-01', today)) {
      if (it.state === 'active' && it.overdue) overdue.add(it.todoId);
    }

    return { todayDone, weekDone, totalFocusMs, overdueActive: overdue.size, daily };
  }
}
