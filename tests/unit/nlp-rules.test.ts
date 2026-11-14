// tests/unit/nlp-rules.test.ts
import { describe, it, expect } from 'vitest';
import { parseTaskInput } from '@/lib/nlp/rules';

const TODAY = '2026-11-14'; // 周六
const base = { source: 'rules' as const };

describe('标签与优先级', () => {
  it('提取 #标签 并从标题剥离', () => {
    const p = parseTaskInput('买菜 #生活 #生活', TODAY);
    expect(p.title).toBe('买菜');
    expect(p.tags).toEqual(['生活']);
  });

  it('高优先级/紧急 → 2 并剥离', () => {
    expect(parseTaskInput('交报告 紧急', TODAY).priority).toBe(2);
    expect(parseTaskInput('交报告 紧急', TODAY).title).toBe('交报告');
    expect(parseTaskInput('高优先级体检', TODAY).priority).toBe(2);
    expect(parseTaskInput('高优先级体检', TODAY).title).toBe('体检');
  });

  it('低优先级/不急 → 0 并剥离', () => {
    expect(parseTaskInput('整理相册 不急', TODAY).priority).toBe(0);
    expect(parseTaskInput('低优先级回邮件', TODAY).priority).toBe(0);
  });

  it('优先级缺省 1', () => {
    expect(parseTaskInput('普通任务', TODAY).priority).toBe(1);
  });
});

describe('标题与零命中', () => {
  it('纯标题：除标题外全为缺省，行为与现状一致', () => {
    const p = parseTaskInput('  买牛奶  ', TODAY);
    expect(p.title).toBe('买牛奶');
    expect(p.dueDate).toBeNull();
    expect(p.timeOfDay).toBeNull();
    expect(p.repeat.repeatType).toBe('none');
  });

  it('空/空白输入 → 空标题', () => {
    expect(parseTaskInput('   ', TODAY).title).toBe('');
  });
});

describe('日期', () => {
  it('相对词：今天/明天/后天/大后天', () => {
    expect(parseTaskInput('今天买菜', TODAY).dueDate).toBe('2026-11-14');
    expect(parseTaskInput('明天交报告', TODAY).title).toBe('交报告');
    expect(parseTaskInput('明天交报告', TODAY).dueDate).toBe('2026-11-15');
    expect(parseTaskInput('后天体检', TODAY).dueDate).toBe('2026-11-16');
    expect(parseTaskInput('大后天搬家', TODAY).dueDate).toBe('2026-11-17');
  });

  it('周X：今天是该周几则今天，否则下一个该周几', () => {
    expect(parseTaskInput('周六聚会', TODAY).dueDate).toBe('2026-11-14'); // 今天周六
    expect(parseTaskInput('周一开会', TODAY).dueDate).toBe('2026-11-16'); // 下一个周一
    expect(parseTaskInput('周日补觉', TODAY).dueDate).toBe('2026-11-15');
  });

  it('下周X：恒为下个日历周', () => {
    expect(parseTaskInput('下周一开工', TODAY).dueDate).toBe('2026-11-16'); // 今天周六 → 下周一 11-16
    expect(parseTaskInput('下周三评审', TODAY).dueDate).toBe('2026-11-18');
    expect(parseTaskInput('下周日收尾', TODAY).dueDate).toBe('2026-11-22');
  });

  it('本月X号/下月X号', () => {
    expect(parseTaskInput('本月20号发版', TODAY).dueDate).toBe('2026-11-20');
    expect(parseTaskInput('本月5号对账', TODAY).dueDate).toBe('2026-12-05'); // 已过 → 翻下月
    expect(parseTaskInput('下月1号总结', TODAY).dueDate).toBe('2026-12-01');
  });

  it('X月X号 无年份：今年取未来，已过取明年', () => {
    expect(parseTaskInput('12月31号跨年', TODAY).dueDate).toBe('2026-12-31');
    expect(parseTaskInput('1月1号新年计划', TODAY).dueDate).toBe('2027-01-01');
  });

  it('ISO 与 M/D', () => {
    expect(parseTaskInput('2026-12-01 复盘', TODAY).dueDate).toBe('2026-12-01');
    expect(parseTaskInput('11/30 结账', TODAY).dueDate).toBe('2026-11-30');
  });

  it('非法日滚动：2月30号 → 3月30号', () => {
    expect(parseTaskInput('2月30号查账', TODAY).dueDate).toBe('2027-03-30');
  });

  it('日期从标题剥离', () => {
    expect(parseTaskInput('明天交报告', TODAY).title).toBe('交报告');
  });

  it('非法日（99号/32号）不匹配也不死循环', () => {
    const p1 = parseTaskInput('12月99号查账', TODAY);
    expect(p1.dueDate).toBeNull();
    expect(p1.title).toBe('12月99号查账'); // 文本不被消费
    expect(parseTaskInput('11/32 结账', TODAY).dueDate).toBeNull();
    expect(parseTaskInput('2026-99-99 备份', TODAY).dueDate).toBeNull();
  });
});
