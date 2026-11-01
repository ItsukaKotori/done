import { describe, it, expect, beforeEach } from 'vitest';
import { Scheduler, type NotifyItem } from '../../src/main/services/scheduler';
import type { ReminderDao, TodoDao, Reminder } from '../../src/main/db/dao';
import type { Todo } from '@shared/types';
import { addDays as addDaysStr } from '@shared/recurrence';

function fakeReminderDao() {
  const rows: Reminder[] = [];
  let nextId = 1;
  const active = (r: Reminder) => r.status === 'pending' || r.status === 'snoozed';
  const dao = {
    insertPending(todoId: number, date: string, fireAt: number) {
      if (rows.some(r => r.todoId === todoId && r.occurrenceDate === date && active(r))) return;
      rows.push({ id: nextId++, todoId, occurrenceDate: date, fireAt, status: 'pending' });
    },
    insertSnoozed(todoId: number, date: string, fireAt: number) {
      rows.push({ id: nextId++, todoId, occurrenceDate: date, fireAt, status: 'snoozed' });
    },
    dismissFor(todoId: number) {
      for (const r of rows) if (r.todoId === todoId && active(r)) r.status = 'dismissed';
    },
    nextPending(now: number) {
      return rows.filter(r => active(r) && r.fireAt > now).sort((a, b) => a.fireAt - b.fireAt)[0] ?? null;
    },
    listExpired(now: number) {
      return rows.filter(r => active(r) && r.fireAt <= now);
    },
    markFired(ids: number[]) {
      for (const r of rows) if (ids.includes(r.id)) r.status = 'fired';
    },
  };
  return { dao: dao as unknown as ReminderDao, rows };
}

const makeTodo = (over: Partial<Todo> = {}): Todo => ({
  id: 1, title: '喝水', notes: null, priority: 1,
  dueDate: '2026-10-27', timeOfDay: '10:00',
  repeatType: 'daily', startDate: '2026-10-27', completedAt: null,
  createdAt: 0, updatedAt: 0, tags: [], ...over,
});

const at = (h: number, m = 0) => new Date(2026, 9, 27, h, m).getTime(); // 2026-10-27 本地

let nowMs: number;
let timers: Array<{ cb: () => void; at: number }>;
let notified: NotifyItem[][];

function makeScheduler(activeTodos: Todo[], occ?: { getByTodo(id: number): Map<string, string> }) {
  const { dao: rem, rows } = fakeReminderDao();
  const todos = { listActive: () => activeTodos } as unknown as TodoDao;
  const s = new Scheduler(rem, todos, {
    now: () => nowMs,
    setTimer: (cb, ms) => { const t = { cb, at: nowMs + ms }; timers.push(t); return t; },
    clearTimer: () => { timers = []; },
    notify: (items) => { notified.push(items); },
  }, occ as never);
  return { s, rows };
}

beforeEach(() => {
  nowMs = at(9);          // 现在 09:00
  timers = []; notified = [];
});

describe('Scheduler', () => {
  it('syncAll 为今日未来时刻排 pending', () => {
    const { s, rows } = makeScheduler([makeTodo()]);
    s.syncAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].fireAt).toBe(at(10));
  });

  it('syncAll 跳过 timeOfDay 为空与已完成任务', () => {
    const { s, rows } = makeScheduler([
      makeTodo({ id: 2, timeOfDay: null }),
      makeTodo({ id: 3, completedAt: 1 }),
    ]);
    s.syncAll();
    expect(rows).toHaveLength(0);
  });

  it('arm 只排一个 timer 指向最近 fireAt（规格 §4.1 规则1）', () => {
    const { s } = makeScheduler([makeTodo(), makeTodo({ id: 2, timeOfDay: '11:00' })]);
    s.syncAll(); s.start();
    expect(timers).toHaveLength(1);
    expect(timers[0].at).toBe(at(10));
  });

  it('完成今天后只排下一期，不在今天再弹提醒（终审重要-2 回归）', () => {
    const occ = { getByTodo: () => new Map<string, string>([['2026-10-27', 'done']]) };
    const { s, rows } = makeScheduler([makeTodo()], occ);
    s.syncAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].fireAt).toBe(at(10) + 86_400_000); // 今天已 done → 顺延明天 10:00
  });
  
  it('跳过今天同样顺延；未跳过时今天时刻未到仍排今天', () => {
    const skippedToday = { getByTodo: () => new Map<string, string>([['2026-10-27', 'skipped']]) };
    const a = makeScheduler([makeTodo()], skippedToday);
    a.s.syncAll();
    expect(a.rows[0].fireAt).toBe(at(10) + 86_400_000);
  
    const clean = { getByTodo: () => new Map<string, string>() };
    const b = makeScheduler([makeTodo()], clean);
    b.s.syncAll();
    expect(b.rows[0].fireAt).toBe(at(10)); // 09:00 时 10:00 未到，仍排今天
  });
  
  it('arm 对远期提醒钳制 32 位延迟，不溢出为忙循环', () => {
    const far = addDaysStr('2026-10-27', 40);
    const { s } = makeScheduler([makeTodo({ dueDate: far, startDate: far })]);
    s.syncAll(); s.start();
    expect(timers).toHaveLength(1);
    const delay = timers[0].at - nowMs;
    expect(delay).toBeLessThanOrEqual(2_147_000_000);
    expect(delay).toBeGreaterThan(0);
  });

  it('tick 到点弹出、markFired 并滚动排下一天', () => {
    const { s, rows } = makeScheduler([makeTodo()]);
    s.syncAll(); s.start();
    nowMs = at(10);
    s.tick();
    expect(notified).toHaveLength(1);
    expect(notified[0][0]).toMatchObject({ todoId: 1, overdue: false });
    expect(rows.filter(r => r.status === 'pending').map(r => r.fireAt))
      .toContain(at(10) + 86_400_000); // 次日 10:00
  });

  it('start 补发睡眠期间过期项并标 overdue（规格 §4.1 规则2）', () => {
    const { s, rows } = makeScheduler([makeTodo()]);
    s.syncAll();
    nowMs = at(15); // 睡了很久，10:00 已过
    s.start();
    expect(notified).toHaveLength(1);
    expect(notified[0][0].overdue).toBe(true);
    // 补发后必须滚动排下一期，否则任务永久沉默
    expect(rows.filter(r => r.status === 'pending').map(r => r.fireAt))
      .toContain(at(10) + 86_400_000);
  });

  it('多条过期合并为一次 notify 调用', () => {
    const { s } = makeScheduler([
      makeTodo({ id: 1, timeOfDay: '08:00' }),
      makeTodo({ id: 2, timeOfDay: '09:00' }),
    ]);
    nowMs = at(7);                               // 两条都尚未过点 → 排入当日 pending
    s.syncAll();
    nowMs = at(12);
    s.start();
    expect(notified).toHaveLength(1);
    expect(notified[0]).toHaveLength(2);
  });

  it('pause 期间 tick 静默消费（fired 但不 notify）', () => {
    const { s, rows } = makeScheduler([makeTodo()]);
    s.syncAll(); s.pause(7_200_000); s.start();  // 静音 2 小时，覆盖 10:00 触发点
    nowMs = at(10);
    s.tick();
    expect(notified).toHaveLength(0);
    expect(rows[0].status).toBe('fired');
  });

  it('syncFor 编辑：dismiss 旧 pending → 按新时刻重排（规格 §4.1 规则3）', () => {
    const t = makeTodo();
    const { s, rows } = makeScheduler([t]);
    s.syncAll();
    t.timeOfDay = '14:00';
    s.syncFor(t);
    expect(rows[0].status).toBe('dismissed');
    expect(rows[1]).toMatchObject({ status: 'pending', fireAt: at(14) });
  });

  it('snooze 排入 now+minutes 的 snoozed 项并可被触发', () => {
    const { s, rows } = makeScheduler([makeTodo()]);
    s.syncAll(); s.start();
    nowMs = at(10); s.tick();
    s.snooze(1, '2026-10-27', 10);
    const row = rows.find(r => r.status === 'snoozed')!;
    expect(row.fireAt).toBe(at(10) + 10 * 60_000);
    nowMs = at(10, 10); s.tick();
    expect(notified).toHaveLength(2);          // 第二次为 snooze 补发
    expect(rows.filter(r => r.status === 'fired')).toHaveLength(2);
  });

  it('一次性任务只排 dueDate 当天；过点后不再重排', () => {
    const t = makeTodo({ repeatType: 'none' });
    const { s, rows } = makeScheduler([t]);
    s.syncAll();
    nowMs = at(10); s.tick();
    expect(notified).toHaveLength(1);
    s.syncAll();                                 // 再次同步不应排入过期 pending
    expect(rows.filter(r => r.status === 'pending')).toHaveLength(0);
    nowMs = at(11); s.start();
    expect(notified).toHaveLength(1);            // start 也不重复补发
  });
});
