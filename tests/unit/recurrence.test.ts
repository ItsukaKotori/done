import { describe, it, expect } from 'vitest';
import { occursOn, occurrencesInRange, nextOccurrences, dateToLocalMs, todayStr, addDays } from '@shared/recurrence';
import type { RecurrenceSpec } from '@shared/types';

describe('occursOn', () => {
  it('none 仅 start 当天', () => {
    const s: RecurrenceSpec = { repeatType: 'none' };
    expect(occursOn(s, '2026-10-27', '2026-10-27')).toBe(true);
    expect(occursOn(s, '2026-10-27', '2026-10-28')).toBe(false);
    expect(occursOn(s, '2026-10-27', '2026-10-26')).toBe(false);
  });
  it('daily 覆盖 start 起每一天', () => {
    const s: RecurrenceSpec = { repeatType: 'daily' };
    expect(occursOn(s, '2026-10-01', '2026-12-31')).toBe(true);
    expect(occursOn(s, '2026-10-01', '2026-09-30')).toBe(false);
  });
  it('weekly 按 repeatWeekdays 过滤（周一/周四）', () => {
    const s: RecurrenceSpec = { repeatType: 'weekly', repeatWeekdays: [1, 4] };
    // 2026-10：周四 1/8/15/22/29，周一 5/12/19/26
    expect(occursOn(s, '2026-10-01', '2026-10-05')).toBe(true);   // Mon
    expect(occursOn(s, '2026-10-01', '2026-10-08')).toBe(true);   // Thu
    expect(occursOn(s, '2026-10-01', '2026-10-06')).toBe(false);  // Tue
  });
  it('custom 每 3 天', () => {
    const s: RecurrenceSpec = { repeatType: 'custom', repeatInterval: 3 };
    expect(occursOn(s, '2026-10-01', '2026-10-01')).toBe(true);
    expect(occursOn(s, '2026-10-01', '2026-10-04')).toBe(true);
    expect(occursOn(s, '2026-10-01', '2026-10-03')).toBe(false);
  });
  it('monthly by_date=31：2 月跳过、3 月出现（规格 §7 月末滚动）', () => {
    const s: RecurrenceSpec = { repeatType: 'monthly', monthlyMode: 'by_date', monthlyDay: 31 };
    expect(occursOn(s, '2026-01-31', '2026-01-31')).toBe(true);
    expect(occursOn(s, '2026-01-31', '2026-02-28')).toBe(false);
    expect(occursOn(s, '2026-01-31', '2026-03-31')).toBe(true);
  });
  it('monthly by_date=29：闰年 2 月出现、平年跳过（规格 §7 闰年）', () => {
    const s: RecurrenceSpec = { repeatType: 'monthly', monthlyMode: 'by_date', monthlyDay: 29 };
    expect(occursOn(s, '2024-01-29', '2024-02-29')).toBe(true);
    expect(occursOn(s, '2024-01-29', '2025-02-28')).toBe(false);
  });
  it('monthly by_weekday 第 3 个周二（规格 §7）', () => {
    const s: RecurrenceSpec = {
      repeatType: 'monthly', monthlyMode: 'by_weekday', monthlyWeekday: 2, monthlyWhich: 3,
    };
    // 2026-10 的周二：6/13/20/27，第 3 个 = 20
    expect(occursOn(s, '2026-10-06', '2026-10-20')).toBe(true);
    expect(occursOn(s, '2026-10-06', '2026-10-13')).toBe(false);  // 第 2 个
    expect(occursOn(s, '2026-10-06', '2026-11-17')).toBe(true);   // 11 月周二 3/10/17/24，第 3 个 = 17
  });
  it('monthly by_weekday which=5 表示最后一个（不足 5 个也成立）', () => {
    const s: RecurrenceSpec = {
      repeatType: 'monthly', monthlyMode: 'by_weekday', monthlyWeekday: 0, monthlyWhich: 5,
    };
    // 2026-10 的周日：4/11/18/25 —— 最后一个是 25
    expect(occursOn(s, '2026-10-01', '2026-10-25')).toBe(true);
    expect(occursOn(s, '2026-10-01', '2026-10-18')).toBe(false);
  });
});

describe('occurrencesInRange', () => {
  it('weekly 单月展开', () => {
    const s: RecurrenceSpec = { repeatType: 'weekly', repeatWeekdays: [1, 4] };
    expect(occurrencesInRange(s, '2026-10-01', '2026-10-01', '2026-10-14')).toEqual([
      '2026-10-01', '2026-10-05', '2026-10-08', '2026-10-12',
    ]);
  });
  it('区间早于 start 返回空', () => {
    expect(
      occurrencesInRange({ repeatType: 'daily' }, '2026-10-10', '2026-10-01', '2026-10-05'),
    ).toEqual([]);
  });
});

describe('nextOccurrences', () => {
  it('排除 done/skipped 集合（规格 §7 状态过滤）', () => {
    const s: RecurrenceSpec = { repeatType: 'daily' };
    expect(nextOccurrences(s, '2026-10-01', '2026-10-05', 3, new Set(['2026-10-07'])))
      .toEqual(['2026-10-06', '2026-10-08', '2026-10-09']);
  });
  it('none 未来返回 1 项、过去返回空', () => {
    expect(nextOccurrences({ repeatType: 'none' }, '2026-12-31', '2026-10-01', 3))
      .toEqual(['2026-12-31']);
    expect(nextOccurrences({ repeatType: 'none' }, '2026-01-01', '2026-10-01', 3)).toEqual([]);
  });
  it('730 天安全阀：永不出现的规则返回空', () => {
    const s: RecurrenceSpec = { repeatType: 'weekly', repeatWeekdays: [] };
    expect(nextOccurrences(s, '2026-10-01', '2026-10-01', 5)).toEqual([]);
  });
  it('安全阀不截断长寿命任务：锚点在三年前仍能取到未来发生日', () => {
    const s: RecurrenceSpec = { repeatType: 'daily' };
    expect(nextOccurrences(s, '2023-06-01', '2026-10-27', 2)).toEqual(['2026-10-28', '2026-10-29']);
  });
});

describe('dateToLocalMs / todayStr（规格 §7 DST 边界）', () => {
  it('往返一致：构造的时刻落回同一本地日', () => {
    const ms = dateToLocalMs('2026-03-08', '02:30'); // 多数 DST 时区的不存在时刻
    expect(todayStr(ms)).toBe('2026-03-08');          // 归一到当日有效瞬间
    const normal = dateToLocalMs('2026-06-15', '18:30');
    expect(todayStr(normal)).toBe('2026-06-15');
  });
  it('跨 DST 切换日单调不减', () => {
    expect(dateToLocalMs('2026-11-01', '01:30')).toBeLessThanOrEqual(
      dateToLocalMs('2026-11-02', '01:30'),
    );
  });
  it('addDays 跨月/跨年归一正确', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });
});
