import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, migrate } from '../../src/main/db';
import { TodoDao, OccurrenceDao, ReminderDao, SettingsDao } from '../../src/main/db/dao';
import type { TodoDraft } from '@shared/types';

// 临时目录置于仓库内（已在 .gitignore），避开系统 temp 的沙箱写权限限制
const tmpRoot = join(process.cwd(), '.superpowers', 'sdd', 'tmp');
function makeTempDir(): string {
  return mkdtempSync(join(tmpRoot, 'dbtest-'));
}
function cleanup(dir: string): void {
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

const memDb = () => {
  const db = new Database(':memory:');
  migrate(db);
  return db;
};

const draft: TodoDraft = {
  title: '喝水', notes: null, priority: 2,
  dueDate: '2026-10-27', timeOfDay: '10:00',
  repeatType: 'weekly', repeatInterval: null, repeatWeekdays: [1, 4],
  monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  startDate: '2026-10-27', completedAt: null,
};

describe('TodoDao', () => {
  it('create/getById 往返保留 camelCase 与 JSON 数组', () => {
    const dao = new TodoDao(memDb());
    const t = dao.create(draft);
    expect(t.id).toBeGreaterThan(0);
    expect(t.repeatWeekdays).toEqual([1, 4]);
    expect(t.priority).toBe(2);
  });
  it('update 只覆盖给定字段且保留 createdAt', () => {
    const dao = new TodoDao(memDb());
    const t = dao.create(draft);
    const u = dao.update(t.id, { title: '改名' })!;
    expect(u.title).toBe('改名');
    expect(u.repeatType).toBe('weekly');
    expect(u.createdAt).toBe(t.createdAt);
  });
  it('deleteById 级联清理 occurrence_states 与 reminders', () => {
    const db = memDb();
    const todos = new TodoDao(db);
    const occ = new OccurrenceDao(db);
    const rem = new ReminderDao(db);
    const t = todos.create(draft);
    occ.setState(t.id, '2026-10-28', 'done');
    rem.insertPending(t.id, '2026-11-02', Date.now() + 60_000);
    todos.deleteById(t.id);
    expect(occ.getByTodo(t.id).size).toBe(0);
    expect(rem.nextPending(Date.now())).toBeNull();
  });
  it('setCompleted 后 listActive 不含、listAll(done) 含', () => {
    const db = memDb();
    const dao = new TodoDao(db);
    const t = dao.create(draft);
    dao.setCompleted(t.id, 123);
    expect(dao.listActive().map(x => x.id)).not.toContain(t.id);
    expect(dao.listAll('done').map(x => x.id)).toContain(t.id);
    expect(dao.listAll('all').map(x => x.id)).toContain(t.id);
  });
});

describe('OccurrenceDao', () => {
  it('setState 幂等 upsert', () => {
    const db = memDb();
    const todos = new TodoDao(db);
    const occ = new OccurrenceDao(db);
    const t = todos.create(draft);
    occ.setState(t.id, '2026-10-28', 'done');
    occ.setState(t.id, '2026-10-28', 'skipped');
    expect(occ.getState(t.id, '2026-10-28')).toBe('skipped');
    expect(occ.getByTodo(t.id).size).toBe(1);
  });
  it('deleteState 恢复 active（删行）', () => {
    const db = memDb();
    const todos = new TodoDao(db);
    const occ = new OccurrenceDao(db);
    const t = todos.create(draft);
    occ.setState(t.id, '2026-10-28', 'done');
    occ.deleteState(t.id, '2026-10-28');
    expect(occ.getState(t.id, '2026-10-28')).toBeNull();
  });
});

describe('ReminderDao', () => {
  // reminders.todo_id 有 FK 约束：用真实插入的 todo id
  function seeded() {
    const db = memDb();
    const todos = new TodoDao(db);
    const a = todos.create(draft);
    const b = todos.create({ ...draft, title: '第二个' });
    return { db, r: new ReminderDao(db), a: a.id, b: b.id };
  }
  it('insertPending 对同 todo+date 幂等', () => {
    const { r, a } = seeded();
    r.insertPending(a, '2026-10-28', 2000);
    r.insertPending(a, '2026-10-28', 3000);
    expect(r.listExpired(4000).length).toBe(1);
  });
  it('nextPending 取 fireAt 最小；dismissFor 后不可见', () => {
    const { r, a, b } = seeded();
    r.insertPending(a, '2026-10-28', 2000);
    r.insertPending(b, '2026-10-28', 1000);
    expect(r.nextPending(0)!.todoId).toBe(b);
    r.dismissFor(b);
    expect(r.nextPending(0)!.todoId).toBe(a);
  });
  it('nextPending 用 >、listExpired 用 <=（边界互补）', () => {
    const { r, a } = seeded();
    r.insertPending(a, '2026-10-28', 1000);
    expect(r.nextPending(1000)).toBeNull();
    expect(r.listExpired(1000).length).toBe(1);
  });
  it('markFired 后 expired/pending 均消失', () => {
    const { r, a } = seeded();
    r.insertPending(a, '2026-10-28', 500);
    r.markFired(r.listExpired(1000).map(x => x.id));
    expect(r.listExpired(1000)).toHaveLength(0);
    expect(r.nextPending(0)).toBeNull();
  });
  it('insertSnoozed 行可被 nextPending 检索', () => {
    const { r, a } = seeded();
    r.insertSnoozed(a, '2026-10-28', 1500);
    expect(r.nextPending(1000)!.status).toBe('snoozed');
  });
});

describe('SettingsDao', () => {
  it('JSON 值往返与覆盖', () => {
    const s = new SettingsDao(memDb());
    expect(s.get('theme')).toBeNull();
    s.set('theme', 'dark');
    expect(s.get('theme')).toBe('dark');
    s.set('autostart', true);
    expect(s.get('autostart')).toBe(true);
    s.set('theme', 'light');
    expect(s.get('theme')).toBe('light');
  });
});

describe('openDb 损坏恢复（规格 §6）', () => {
  it('损坏 db 改名为 .corrupt.<ts> 并新建可用库', () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, 'todo.db'), Buffer.alloc(64, 0xFF));
      const { db, recovered } = openDb(dir);
      expect(recovered).toBe(true);
      new TodoDao(db).create(draft); // 新库可写
      db.close();
      const files = readdirSync(dir);
      expect(files.some(f => f.startsWith('todo.db.corrupt.'))).toBe(true);
      expect(existsSync(join(dir, 'todo.db'))).toBe(true);
    } finally {
      cleanup(dir);
    }
  });
  it('健康库重开 recovered=false 且数据保留', () => {
    const dir = makeTempDir();
    try {
      const first = openDb(dir);
      new TodoDao(first.db).create(draft);
      first.db.close();
      const second = openDb(dir);
      expect(second.recovered).toBe(false);
      expect(new TodoDao(second.db).listAll('all')).toHaveLength(1);
      second.db.close();
    } finally {
      cleanup(dir);
    }
  });
});
