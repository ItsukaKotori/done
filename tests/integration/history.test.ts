import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/main/db';
import { TodoDao, OccurrenceDao, TimerDao } from '../../src/main/db/dao';
import { TodoService } from '../../src/main/services/todo-service';
import type { TodoDraft } from '@shared/types';

const NOW = new Date(2026, 9, 30, 12).getTime(); // 2026-10-30
const clock = () => NOW;

const base: TodoDraft = {
  title: 't', notes: null, priority: 1,
  dueDate: '2026-10-20', timeOfDay: null,
  repeatType: 'daily', repeatInterval: null, repeatWeekdays: null,
  monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  startDate: null, completedAt: null,
};

let db: Database.Database;
let todos: TodoDao;
let occ: OccurrenceDao;
let svc: TodoService;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  todos = new TodoDao(db);
  occ = new OccurrenceDao(db);
  svc = new TodoService(todos, occ, new TimerDao(db), clock);
});

describe('OccurrenceDao 完成时间', () => {
  it('done 记录 completedAt，非 done 清空', () => {
    const t = todos.create(base);
    occ.setState(t.id, '2026-10-21', 'done', 1111);
    expect(occ.getDetailsByTodo(t.id).get('2026-10-21')).toEqual({ status: 'done', completedAt: 1111 });
    occ.setState(t.id, '2026-10-21', 'skipped');
    expect(occ.getDetailsByTodo(t.id).get('2026-10-21')).toEqual({ status: 'skipped', completedAt: null });
  });

  it('listAll 带出 completedAt', () => {
    const t = todos.create(base);
    occ.setState(t.id, '2026-10-21', 'done', 2222);
    expect(occ.listAll()).toEqual([
      { todoId: t.id, date: '2026-10-21', status: 'done', completedAt: 2222 },
    ]);
  });
});

describe('TodoService.occurrenceHistory', () => {
  it('汇总完成率并给出最近期次（倒序）', () => {
    const t = todos.create(base); // 10-20 起每日，今天 10-30 → 11 期
    svc.setStatus(t.id, '2026-10-21', 'done');
    svc.setStatus(t.id, '2026-10-25', 'done');
    svc.setStatus(t.id, '2026-10-22', 'skipped');

    const h = svc.occurrenceHistory(t.id);

    expect(h.total).toBe(11);
    expect(h.doneCount).toBe(2);
    expect(h.skippedCount).toBe(1);
    expect(h.rate).toBe(18); // round(2/11*100)
    expect(h.items[0].date).toBe('2026-10-30'); // 最近在前
    const done = h.items.find(i => i.date === '2026-10-25');
    expect(done).toEqual({ date: '2026-10-25', state: 'done', doneAt: NOW });
    const skipped = h.items.find(i => i.date === '2026-10-22');
    expect(skipped).toEqual({ date: '2026-10-22', state: 'skipped', doneAt: null });
  });

  it('limit 只截断列表，不影响汇总', () => {
    const t = todos.create(base);
    svc.setStatus(t.id, '2026-10-21', 'done');
    const h = svc.occurrenceHistory(t.id, 3);
    expect(h.items).toHaveLength(3);
    expect(h.total).toBe(11);
    expect(h.doneCount).toBe(1);
  });

  it('一次性任务返回空汇总', () => {
    const t = todos.create({ ...base, repeatType: 'none', dueDate: '2026-10-30' });
    const h = svc.occurrenceHistory(t.id);
    expect(h).toEqual({ doneCount: 0, skippedCount: 0, total: 0, rate: 0, items: [] });
  });
});
