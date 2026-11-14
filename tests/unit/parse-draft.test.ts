// tests/unit/parse-draft.test.ts
import { describe, it, expect } from 'vitest';
import { emptyRepeat, parsedToDraft, type ParsedTask } from '@shared/parse';
import { todayStr } from '@shared/recurrence';

const NOW = new Date(2026, 10, 14, 9, 0).getTime(); // 2026-11-14 周六

const task = (over: Partial<ParsedTask>): ParsedTask => ({
  title: '任务', dueDate: null, timeOfDay: null, priority: 1,
  tags: [], repeat: emptyRepeat(), source: 'rules', ...over,
});

describe('parsedToDraft', () => {
  it('零命中：dueDate 落到今天（与现有快添行为一致）', () => {
    const d = parsedToDraft(task({}), NOW);
    expect(d.dueDate).toBe(todayStr(NOW));
    expect(d.title).toBe('任务');
    expect(d.priority).toBe(1);
    expect(d.repeatType).toBe('none');
    expect(d.completedAt).toBeNull();
    expect(d.tags).toEqual([]);
  });

  it('透传显式字段', () => {
    const d = parsedToDraft(task({
      dueDate: '2026-11-20', timeOfDay: '15:00', priority: 2,
      tags: ['工作', '工作'], startDate: '2026-11-20',
      repeat: { repeatType: 'weekly', repeatWeekdays: [3, 5] },
    }), NOW);
    expect(d.dueDate).toBe('2026-11-20');
    expect(d.timeOfDay).toBe('15:00');
    expect(d.priority).toBe(2);
    expect(d.startDate).toBe('2026-11-20');
    expect(d.repeatType).toBe('weekly');
    expect(d.repeatWeekdays).toEqual([3, 5]);
    expect(d.tags).toEqual(['工作']); // 归一化去重
  });

  it('repeat 展平到 draft 顶层字段', () => {
    const d = parsedToDraft(task({
      repeat: { repeatType: 'monthly', monthlyMode: 'by_weekday', monthlyWeekday: 5, monthlyWhich: 3 },
    }), NOW);
    expect(d.repeatType).toBe('monthly');
    expect(d.monthlyMode).toBe('by_weekday');
    expect(d.monthlyWeekday).toBe(5);
    expect(d.monthlyWhich).toBe(3);
  });
});
