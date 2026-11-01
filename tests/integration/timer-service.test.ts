import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/main/db';
import { TodoDao, OccurrenceDao, TimerDao } from '../../src/main/db/dao';
import { TodoService } from '../../src/main/services/todo-service';
import type { TodoDraft } from '@shared/types';

let now = 0;
const clock = () => now;

const base: TodoDraft = {
  title: 't', notes: null, priority: 1,
  dueDate: '2026-10-27', timeOfDay: null,
  repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
  monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  startDate: null, completedAt: null,
};

function make() {
  const db = new Database(':memory:');
  migrate(db);
  const todos = new TodoDao(db);
  const occ = new OccurrenceDao(db);
  const timers = new TimerDao(db);
  return { svc: new TodoService(todos, occ, timers, clock), todos, timers };
}

beforeEach(() => { now = 1_000_000; });

describe('TodoService 计时状态机', () => {
  it('一次性任务 start → pause → 再 start 继续累加', () => {
    const { svc, timers } = make();
    const t = svc.create(base);
    svc.startTimer(t.id);
    now += 5000;
    svc.pauseTimer(t.id);
    expect(timers.get(t.id, '')).toEqual({ accumulatedMs: 5000, runningSince: null, totalMs: null });
    now += 1000;
    svc.startTimer(t.id);
    now += 3000;
    svc.pauseTimer(t.id);
    expect(timers.get(t.id, '')?.accumulatedMs).toBe(8000);
  });

  it('开始 B 自动暂停 A（单任务约束）', () => {
    const { svc, timers } = make();
    const a = svc.create(base);
    const b = svc.create({ ...base, title: 'b' });
    svc.startTimer(a.id);
    now += 4000;
    svc.startTimer(b.id);
    expect(timers.get(a.id, '')?.runningSince).toBeNull();
    expect(timers.get(a.id, '')?.accumulatedMs).toBe(4000);
    expect(timers.get(b.id, '')?.runningSince).toBe(now);
  });

  it('complete 冻结 total_ms', () => {
    const { svc, timers } = make();
    const t = svc.create(base);
    svc.startTimer(t.id);
    now += 6000;
    svc.complete(t.id);
    expect(timers.get(t.id, '')).toEqual({ accumulatedMs: 6000, runningSince: null, totalMs: 6000 });
  });

  it('取消完成后保留累计、清 total，再开始继续累加', () => {
    const { svc, timers } = make();
    const t = svc.create(base);
    svc.startTimer(t.id);
    now += 6000;
    svc.complete(t.id);
    svc.setStatus(t.id, base.dueDate!, 'active');
    expect(timers.get(t.id, '')).toEqual({ accumulatedMs: 6000, runningSince: null, totalMs: null });
    svc.startTimer(t.id);
    now += 2000;
    svc.complete(t.id);
    expect(timers.get(t.id, '')?.totalMs).toBe(8000);
  });

  it('重复任务按发生日独立计时', () => {
    const { svc, timers } = make();
    const t = svc.create({ ...base, repeatType: 'daily' });
    svc.startTimer(t.id, '2026-10-27');
    now += 3000;
    svc.pauseTimer(t.id, '2026-10-27');
    svc.startTimer(t.id, '2026-10-28');
    now += 1000;
    svc.pauseTimer(t.id, '2026-10-28');
    expect(timers.get(t.id, '2026-10-27')?.accumulatedMs).toBe(3000);
    expect(timers.get(t.id, '2026-10-28')?.accumulatedMs).toBe(1000);
  });

  it('list 关联 timer 字段', () => {
    const { svc } = make();
    const t = svc.create(base);
    svc.startTimer(t.id);
    const items = svc.list('2026-10-27', '2026-10-27');
    expect(items[0].timer?.runningSince).toBe(now);
  });

  it('listAll 为一次性任务关联 timer，重复任务为 null', () => {
    const { svc } = make();
    const one = svc.create(base);
    svc.create({ ...base, title: 'r', repeatType: 'daily' });
    svc.startTimer(one.id);
    const rows = svc.listAll('all');
    expect(rows.find(r => r.id === one.id)?.timer?.runningSince).toBe(now);
    expect(rows.find(r => r.title === 'r')?.timer).toBeNull();
  });
});
