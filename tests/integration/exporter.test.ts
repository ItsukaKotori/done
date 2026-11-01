import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/main/db';
import { SCHEMA_VERSION } from '../../src/main/db/schema';
import { TodoDao, OccurrenceDao, TimerDao, SettingsDao } from '../../src/main/db/dao';
import { Exporter } from '../../src/main/services/exporter';
import { EXPORT_FORMAT, EXPORT_VERSION } from '@shared/export';
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

const build = () => new Exporter(todos, occ, timers, settings, '0.1.0', () => 123).build();

describe('Exporter', () => {
  it('组装完整导出 payload', () => {
    const t = todos.create(base);
    const r = todos.create({ ...base, title: 'r', repeatType: 'daily' });
    occ.setState(r.id, '2026-10-27', 'done');
    timers.upsert(t.id, '', { accumulatedMs: 1000, totalMs: 1000 });
    settings.set('theme', 'dark');

    const p = build();

    expect(p.format).toBe(EXPORT_FORMAT);
    expect(p.version).toBe(EXPORT_VERSION);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.exportedAt).toBe(123);
    expect(p.appVersion).toBe('0.1.0');
    expect(p.data.todos.map(x => x.id).sort()).toEqual([t.id, r.id].sort());
    expect(p.data.occurrenceStates).toEqual([
      { todoId: r.id, date: '2026-10-27', status: 'done', completedAt: null },
    ]);
    expect(p.data.timers).toEqual([
      { todoId: t.id, date: '', accumulatedMs: 1000, runningSince: null, totalMs: 1000 },
    ]);
    expect(p.data.settings).toEqual({ theme: 'dark' });
  });

  it('不包含 reminders（派生队列，不入导出）', () => {
    const p = build() as unknown as { data: Record<string, unknown> };
    expect('reminders' in p.data).toBe(false);
  });

  it('空库导出空集合', () => {
    const p = build();
    expect(p.data.todos).toEqual([]);
    expect(p.data.occurrenceStates).toEqual([]);
    expect(p.data.timers).toEqual([]);
    expect(p.data.settings).toEqual({});
  });
});
