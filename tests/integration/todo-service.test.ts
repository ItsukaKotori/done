import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/main/db';
import { TodoDao, OccurrenceDao, TimerDao } from '../../src/main/db/dao';
import { TodoService } from '../../src/main/services/todo-service';
import type { TodoDraft } from '@shared/types';

// 固定"现在" = 2026-10-27 12:00 本地（周二）
const clock = () => new Date(2026, 9, 27, 12, 0).getTime();

function makeService() {
  const db = new Database(':memory:');
  migrate(db);
  const todos = new TodoDao(db);
  const occ = new OccurrenceDao(db);
  const timers = new TimerDao(db);
  return { service: new TodoService(todos, occ, timers, clock), todos, occ };
}

const base: TodoDraft = {
  title: 't', notes: null, priority: 1,
  dueDate: '2026-10-27', timeOfDay: null,
  repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
  monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  startDate: null, completedAt: null,
};

let svc: TodoService;
beforeEach(() => { svc = makeService().service; });

describe('TodoService', () => {
  it('create 自动补齐 startDate 锚点', () => {
    const t = svc.create({ ...base, repeatType: 'daily' });
    expect(t.startDate).toBe('2026-10-27');
  });

  it('daily 区间展开 12 条（10-20..10-31）', () => {
    svc.create({ ...base, repeatType: 'daily', dueDate: '2026-10-20' });
    const items = svc.list('2026-10-20', '2026-10-31');
    expect(items).toHaveLength(12);
    expect(items[0].date).toBe('2026-10-20');
    expect(items.every(i => i.state === 'active')).toBe(true);
  });

  it('一次性任务过去日标 overdue', () => {
    svc.create({ ...base, dueDate: '2026-10-20' });
    const items = svc.list('2026-10-20', '2026-10-20');
    expect(items).toHaveLength(1);
    expect(items[0].overdue).toBe(true);
  });

  it('timeOfDay 今天已过 → overdue；未到 → 不 overdue', () => {
    svc.create({ ...base, timeOfDay: '09:00' });
    svc.create({ ...base, title: '晚', timeOfDay: '21:00' });
    const items = svc.list('2026-10-27', '2026-10-27');
    expect(items.find(i => i.title === 't')!.overdue).toBe(true);
    expect(items.find(i => i.title === '晚')!.overdue).toBe(false);
  });

  it('complete 重复任务单日 → 该条 done，其余 active', () => {
    const t = svc.create({ ...base, repeatType: 'daily' });
    svc.complete(t.id, '2026-10-27');
    const items = svc.list('2026-10-27', '2026-10-29');
    expect(items.map(i => i.state)).toEqual(['done', 'active', 'active']);
  });

  it('complete 一次性任务 → done', () => {
    const t = svc.create(base);
    svc.complete(t.id);
    expect(svc.list('2026-10-27', '2026-10-27')[0].state).toBe('done');
  });

  it('setStatus skipped 保留条目；active 恢复', () => {
    const t = svc.create({ ...base, repeatType: 'daily' });
    svc.setStatus(t.id, '2026-10-28', 'skipped');
    expect(svc.list('2026-10-28', '2026-10-28')[0].state).toBe('skipped');
    svc.setStatus(t.id, '2026-10-28', 'active');
    expect(svc.list('2026-10-28', '2026-10-28')[0].state).toBe('active');
  });

  it('update 改重复规则后 list 反映新规则（单一真相源）', () => {
    const t = svc.create({ ...base, repeatType: 'daily' });
    svc.update(t.id, { repeatType: 'weekly', repeatWeekdays: [1] });
    // 锚点 10-27（周二）之后的周一：11-02；区间 10-27..11-03 仅 11-02
    const items = svc.list('2026-10-27', '2026-11-03');
    expect(items.map(i => i.date)).toEqual(['2026-11-02']);
  });

  it('update 改期同步锚点（一次性任务改日后旧日不再出现）', () => {
    const t = svc.create({ ...base, dueDate: '2026-10-27' });
    svc.update(t.id, { dueDate: '2026-10-30' });
    expect(svc.list('2026-10-27', '2026-10-27')).toHaveLength(0);
    const items = svc.list('2026-10-30', '2026-10-30');
    expect(items).toHaveLength(1);
    expect(items[0].date).toBe('2026-10-30');
    expect(svc.getById(t.id)!.startDate).toBe('2026-10-30');
  });

  it('update 携带旧 startDate 的真实对话框 payload 仍改锚（终审严重-1 回归）', () => {
    const t = svc.create({ ...base, dueDate: '2026-10-27' });
    // todoToDraft 原样回传 startDate=旧到期日 + 新 dueDate
    const dialogPayload = { dueDate: '2026-10-30', startDate: t.startDate };
    svc.update(t.id, dialogPayload);
    expect(svc.getById(t.id)!.startDate).toBe('2026-10-30');
    expect(svc.list('2026-10-27', '2026-10-27')).toHaveLength(0);
    expect(svc.list('2026-10-30', '2026-10-30')).toHaveLength(1);
  });

  it('update 显式改动 startDate（真正重定锚）时不被覆写', () => {
    const t = svc.create({ ...base, repeatType: 'daily', dueDate: '2026-10-27' });
    svc.update(t.id, { dueDate: '2026-11-03', startDate: '2026-11-03' });
    expect(svc.getById(t.id)!.startDate).toBe('2026-11-03');
  });

  it('preview 含今天起前 5 个发生日', () => {
    expect(svc.preview({ ...base, repeatType: 'daily', dueDate: '2026-10-27' }))
      .toEqual(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
  });

  it('preview 编辑态（显式 todoId）排除已 done/skipped', () => {
    const t = svc.create({ ...base, repeatType: 'daily' });
    svc.setStatus(t.id, '2026-10-28', 'skipped');
    svc.complete(t.id, '2026-10-29');
    const draftOnly = svc.preview(svc.getById(t.id)!);
    const editState = svc.preview(svc.getById(t.id)!, 5, t.id);
    // 不传 todoId：不排除（新建预览语义）
    expect(draftOnly).toEqual(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
    // 传 todoId：跳过 skipped+done 两日
    expect(editState).toEqual(['2026-10-27', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('preview 一次性：今天及未来返回该项，过去返回空', () => {
    expect(svc.preview({ ...base, dueDate: '2026-12-31' })).toEqual(['2026-12-31']);
    expect(svc.preview({ ...base, dueDate: '2026-10-01' })).toEqual([]);
  });

  it('remove 后条目从 list 消失', () => {
    const t = svc.create({ ...base, repeatType: 'daily' });
    svc.remove(t.id);
    expect(svc.list('2026-10-27', '2026-10-31')).toHaveLength(0);
  });

  it('listAll 转发 DAO 三种状态', () => {
    const t = svc.create(base);
    svc.create({ ...base, title: 'open', dueDate: '2026-10-28' });
    svc.complete(t.id);
    expect(svc.listAll('open')).toHaveLength(1);
    expect(svc.listAll('done')).toHaveLength(1);
    expect(svc.listAll('all')).toHaveLength(2);
  });

  it('setStatus 一次性任务：done 映射完成、active 取消、skipped 忽略', () => {
    const t = svc.create(base);
    svc.setStatus(t.id, '2026-10-27', 'done');
    expect(svc.list('2026-10-27', '2026-10-27')[0].state).toBe('done');
    svc.setStatus(t.id, '2026-10-27', 'active');
    expect(svc.list('2026-10-27', '2026-10-27')[0].state).toBe('active');
    svc.setStatus(t.id, '2026-10-27', 'skipped'); // 对一次性无意义，不应产生状态行
    expect(svc.list('2026-10-27', '2026-10-27')[0].state).toBe('active');
  });

  it('list 按日期升序、同日按 todoId 稳定排序', () => {
    const a = svc.create({ ...base, title: 'A', repeatType: 'daily', dueDate: '2026-10-26' });
    const b = svc.create({ ...base, title: 'B', repeatType: 'daily', dueDate: '2026-10-26' });
    const items = svc.list('2026-10-27', '2026-10-27');
    expect(items.map(i => [i.date, i.todoId])).toEqual([[ '2026-10-27', a.id], ['2026-10-27', b.id]]);
  });
});
