import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/main/db';
import { TodoDao, TimerDao } from '../../src/main/db/dao';
import type { TodoDraft } from '@shared/types';

const base: TodoDraft = {
  title: 't', notes: null, priority: 1,
  dueDate: '2026-10-27', timeOfDay: null,
  repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
  monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  startDate: null, completedAt: null,
};

let db: Database.Database;
let todoId: number;
let timers: TimerDao;
beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  todoId = new TodoDao(db).create(base).id;
  timers = new TimerDao(db);
});

describe('TimerDao', () => {
  it('get 无记录返回 null', () => {
    expect(timers.get(todoId, '')).toBeNull();
  });

  it('upsert 插入与合并', () => {
    timers.upsert(todoId, '', { runningSince: 1000 });
    expect(timers.get(todoId, '')).toEqual({ accumulatedMs: 0, runningSince: 1000, totalMs: null });
    timers.upsert(todoId, '', { totalMs: null, runningSince: null });
    expect(timers.get(todoId, '')?.runningSince).toBeNull();
  });

  it('pauseAllRunning 累计运行段时间并停止', () => {
    timers.upsert(todoId, '', { runningSince: 1000 });
    timers.pauseAllRunning(4000);
    expect(timers.get(todoId, '')).toEqual({ accumulatedMs: 3000, runningSince: null, totalMs: null });
  });

  it('pause 只影响指定单元', () => {
    timers.upsert(todoId, '', { runningSince: 1000 });
    timers.upsert(todoId, '2026-10-27', { runningSince: 1000 });
    timers.pause(todoId, '2026-10-27', 3000);
    expect(timers.get(todoId, '')?.runningSince).toBe(1000);
    expect(timers.get(todoId, '2026-10-27')?.accumulatedMs).toBe(2000);
  });

  it('settle 冻结 total_ms（含运行中段）', () => {
    timers.upsert(todoId, '', { accumulatedMs: 5000, runningSince: 2000 });
    timers.settle(todoId, '', 5000);
    expect(timers.get(todoId, '')).toEqual({ accumulatedMs: 8000, runningSince: null, totalMs: 8000 });
  });

  it('settle 无计时记录时为空操作', () => {
    timers.settle(todoId, '', 5000);
    expect(timers.get(todoId, '')).toBeNull();
  });

  it('resetCompleted 保留 accumulated 清 total', () => {
    timers.upsert(todoId, '', { accumulatedMs: 8000, totalMs: 8000 });
    timers.resetCompleted(todoId, '');
    expect(timers.get(todoId, '')).toEqual({ accumulatedMs: 8000, runningSince: null, totalMs: null });
  });

  it('getByTodo 返回 date 到状态的映射', () => {
    timers.upsert(todoId, '', { runningSince: 1 });
    timers.upsert(todoId, '2026-10-27', { accumulatedMs: 100 });
    const m = timers.getByTodo(todoId);
    expect(m.get('')?.runningSince).toBe(1);
    expect(m.get('2026-10-27')?.accumulatedMs).toBe(100);
  });
});
