import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/main/db';
import { TodoDao, OccurrenceDao, TimerDao, SettingsDao } from '../../src/main/db/dao';
import type { TodoDraft } from '@shared/types';

const base: TodoDraft = {
  title: 't', notes: null, priority: 1,
  dueDate: '2026-10-27', timeOfDay: null,
  repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
  monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  startDate: null, completedAt: null,
};

let db: Database.Database;
let todos: TodoDao;
let occ: OccurrenceDao;
let timers: TimerDao;
let settings: SettingsDao;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  todos = new TodoDao(db);
  occ = new OccurrenceDao(db);
  timers = new TimerDao(db);
  settings = new SettingsDao(db);
});

describe('导出所需的 DAO 全量读取', () => {
  it('OccurrenceDao.listAll 返回全部 occurrence 状态', () => {
    const r = todos.create({ ...base, title: 'r', repeatType: 'daily' });
    occ.setState(r.id, '2026-10-27', 'done');
    occ.setState(r.id, '2026-10-28', 'skipped');
    const rows = occ.listAll().sort((a, b) => a.date.localeCompare(b.date));
    expect(rows).toEqual([
      { todoId: r.id, date: '2026-10-27', status: 'done', completedAt: null },
      { todoId: r.id, date: '2026-10-28', status: 'skipped', completedAt: null },
    ]);
  });

  it('OccurrenceDao.listAll 空库返回空数组', () => {
    expect(occ.listAll()).toEqual([]);
  });

  it('TimerDao.listAll 返回全部计时行', () => {
    const t = todos.create(base);
    timers.upsert(t.id, '', { accumulatedMs: 1000, totalMs: 1000 });
    timers.upsert(t.id, '2026-10-27', { runningSince: 5000 });
    const rows = timers.listAll().sort((a, b) => a.date.localeCompare(b.date));
    expect(rows).toEqual([
      { todoId: t.id, date: '', accumulatedMs: 1000, runningSince: null, totalMs: 1000 },
      { todoId: t.id, date: '2026-10-27', accumulatedMs: 0, runningSince: 5000, totalMs: null },
    ]);
  });

  it('TimerDao.listAll 空库返回空数组', () => {
    expect(timers.listAll()).toEqual([]);
  });

  it('SettingsDao.all 返回解析后的全部设置', () => {
    settings.set('theme', 'dark');
    settings.set('notify_sound', false);
    expect(settings.all()).toEqual({ theme: 'dark', notify_sound: false });
  });

  it('SettingsDao.all 空库返回空对象', () => {
    expect(settings.all()).toEqual({});
  });
});
