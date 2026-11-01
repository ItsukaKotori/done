import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/main/db';
import { TodoDao } from '../../src/main/db/dao';
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
beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  todos = new TodoDao(db);
});

describe('TodoDao 标签', () => {
  it('未提供 tags 时默认空数组', () => {
    expect(todos.create(base).tags).toEqual([]);
  });

  it('create 归一化标签（去空白/去重/去空）', () => {
    const t = todos.create({ ...base, tags: [' a ', 'b', 'a', ''] });
    expect(t.tags).toEqual(['a', 'b']);
  });

  it('update 可替换标签', () => {
    const t = todos.create({ ...base, tags: ['x'] });
    const u = todos.update(t.id, { tags: ['y', 'z', 'y'] });
    expect(u?.tags).toEqual(['y', 'z']);
  });

  it('getById 原样读回标签', () => {
    const t = todos.create({ ...base, tags: ['工作', '重要'] });
    expect(todos.getById(t.id)?.tags).toEqual(['工作', '重要']);
  });

  it('更新其他字段时标签保持不变', () => {
    const t = todos.create({ ...base, tags: ['keep'] });
    todos.update(t.id, { title: 'changed' });
    expect(todos.getById(t.id)?.tags).toEqual(['keep']);
  });
});
