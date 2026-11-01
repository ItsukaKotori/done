import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/main/db';
import { TodoDao, OccurrenceDao, TimerDao } from '../../src/main/db/dao';
import { TodoService } from '../../src/main/services/todo-service';
import { StatsService } from '../../src/main/services/stats';
import type { TodoDraft } from '@shared/types';

const at = (d: number, h = 12) => new Date(2026, 9, d, h).getTime(); // 2026-10-xx 本地
const NOW = at(30); // 2026-10-30（周五）

const base: TodoDraft = {
  title: 't', notes: null, priority: 1,
  dueDate: '2026-10-30', timeOfDay: null,
  repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
  monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  startDate: null, completedAt: null,
};

let db: Database.Database;
let todos: TodoDao;
let occ: OccurrenceDao;
let timers: TimerDao;
let svc: StatsService;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  todos = new TodoDao(db);
  occ = new OccurrenceDao(db);
  timers = new TimerDao(db);
  const todoService = new TodoService(todos, occ, timers, () => NOW);
  svc = new StatsService(todos, occ, timers, todoService, () => NOW);
});

describe('StatsService', () => {
  it('统计今日/本周完成数、14 天趋势、专注时长与逾期数', () => {
    // 今日完成（一次性）
    todos.create({ ...base, title: 'a', completedAt: at(30) });
    // 本周内、非今日完成（周三 10-28）
    todos.create({ ...base, title: 'b', completedAt: at(28) });
    // 14 天窗口外（10-10）
    todos.create({ ...base, title: 'c', completedAt: at(10) });
    // 重复任务：今日与本周一（10-26）各完成一期
    const r = todos.create({ ...base, title: 'r', repeatType: 'daily' });
    occ.setState(r.id, '2026-10-30', 'done');
    occ.setState(r.id, '2026-10-26', 'done');
    // 专注时长：两条已完成计时
    const t1 = todos.create({ ...base, title: 't1' });
    const t2 = todos.create({ ...base, title: 't2' });
    timers.upsert(t1.id, '', { accumulatedMs: 5000, totalMs: 5000 });
    timers.upsert(t2.id, '', { accumulatedMs: 7000, totalMs: 7000 });
    // 逾期未完成（10-25 到期且无完成）
    todos.create({ ...base, title: 'late', dueDate: '2026-10-25' });

    const s = svc.summary();

    expect(s.todayDone).toBe(2);      // a + r(10-30)
    expect(s.weekDone).toBe(4);       // a, b, r(10-26), r(10-30)
    expect(s.totalFocusMs).toBe(12000);
    expect(s.overdueActive).toBe(1);
    expect(s.daily).toHaveLength(14);
    expect(s.daily[13]).toEqual({ date: '2026-10-30', done: 2 });
    expect(s.daily[11]).toEqual({ date: '2026-10-28', done: 1 });
  });

  it('空库返回全零/零值数组', () => {
    const s = svc.summary();
    expect(s.todayDone).toBe(0);
    expect(s.weekDone).toBe(0);
    expect(s.totalFocusMs).toBe(0);
    expect(s.overdueActive).toBe(0);
    expect(s.daily).toHaveLength(14);
    expect(s.daily.every(d => d.done === 0)).toBe(true);
  });
});
