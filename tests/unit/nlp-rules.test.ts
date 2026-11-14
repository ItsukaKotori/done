// tests/unit/nlp-rules.test.ts
import { describe, it, expect } from 'vitest';
import { parseTaskInput } from '@/lib/nlp/rules';

const TODAY = '2026-11-14'; // 周六

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

  it('不紧急 → 低优先级且标题完整', () => {
    const p = parseTaskInput('搬家 不紧急', TODAY);
    expect(p.priority).toBe(0);
    expect(p.title).toBe('搬家');
  });

  it('不重要 不误判为高优先级', () => {
    const p = parseTaskInput('整理文档 不重要', TODAY);
    expect(p.priority).toBe(1);
    expect(p.title).toBe('整理文档');
  });
});

describe('标题与零命中', () => {
  it('纯标题：除标题外全为缺省，行为与现状一致', () => {
    const p = parseTaskInput('  买牛奶  ', TODAY);
    expect(p.title).toBe('买牛奶');
    expect(p.dueDate).toBeNull();
    expect(p.timeOfDay).toBeNull();
    expect(p.repeat.repeatType).toBe('none');
    expect(p.source).toBe('rules');
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

describe('时刻', () => {
  it('HH:mm 字面量原样', () => {
    const p = parseTaskInput('15:30 站会', TODAY);
    expect(p.timeOfDay).toBe('15:30');
    expect(p.title).toBe('站会');
  });

  it('时段词 + X点(半/X分)', () => {
    expect(parseTaskInput('下午3点理疗', TODAY).timeOfDay).toBe('15:00');
    expect(parseTaskInput('下午3点半取药', TODAY).timeOfDay).toBe('15:30');
    expect(parseTaskInput('上午9点晨会', TODAY).timeOfDay).toBe('09:00');
    expect(parseTaskInput('晚上8点健身', TODAY).timeOfDay).toBe('20:00');
    expect(parseTaskInput('中午12点吃饭', TODAY).timeOfDay).toBe('12:00');
    expect(parseTaskInput('中午1点午休', TODAY).timeOfDay).toBe('13:00');
    expect(parseTaskInput('上午10点45分答辩', TODAY).timeOfDay).toBe('10:45');
  });

  it('裸 X点：1-5 默认下午，6-11 原样', () => {
    expect(parseTaskInput('3点开会', TODAY).timeOfDay).toBe('15:00');
    expect(parseTaskInput('9点打卡', TODAY).timeOfDay).toBe('09:00');
    expect(parseTaskInput('12点吃饭', TODAY).timeOfDay).toBe('12:00');
  });

  it('时刻从标题剥离', () => {
    expect(parseTaskInput('下午3点理疗', TODAY).title).toBe('理疗');
  });
});

describe('重复', () => {
  it('每天', () => {
    const p = parseTaskInput('每天喝水', TODAY);
    expect(p.repeat.repeatType).toBe('daily');
    expect(p.title).toBe('喝水');
    expect(p.dueDate).toBe(TODAY); // 无显式日期 → 今天
  });

  it('每周多日（含分隔符）', () => {
    const p = parseTaskInput('每周三、五开周会', TODAY);
    expect(p.repeat.repeatType).toBe('weekly');
    expect(p.repeat.repeatWeekdays).toEqual([3, 5]); // 0=周日…6=周六
    expect(p.title).toBe('开周会');
    expect(p.dueDate).toBe('2026-11-18'); // 今天周六 → 下一个命中日是周三 11-18
  });

  it('每周多日的首个发生日', () => {
    // 今天周六(11-14)：每周日 → 首个发生日 11-15
    const p = parseTaskInput('每周日复盘', TODAY);
    expect(p.repeat.repeatWeekdays).toEqual([0]);
    expect(p.dueDate).toBe('2026-11-15');
    expect(p.startDate).toBe('2026-11-15');
  });

  it('工作日 = 周一~周五', () => {
    const p = parseTaskInput('工作日写日报', TODAY);
    expect(p.repeat.repeatType).toBe('weekly');
    expect(p.repeat.repeatWeekdays).toEqual([1, 2, 3, 4, 5]);
    expect(p.dueDate).toBe('2026-11-16'); // 周六 → 下一个工作日周一
  });

  it('每月X号', () => {
    const p = parseTaskInput('每月1号交房租', TODAY);
    expect(p.repeat.repeatType).toBe('monthly');
    expect(p.repeat.monthlyMode).toBe('by_date');
    expect(p.repeat.monthlyDay).toBe(1);
    expect(p.dueDate).toBe('2026-12-01'); // 本月1号已过
  });

  it('每月第N个周X', () => {
    const p = parseTaskInput('每月第三个周三团队日', TODAY);
    expect(p.repeat.monthlyMode).toBe('by_weekday');
    expect(p.repeat.monthlyWeekday).toBe(3);
    expect(p.repeat.monthlyWhich).toBe(3);
    expect(p.dueDate).toBe('2026-11-18'); // 2026-11 的周三：4/11/18/25，第三个 = 11-18 ≥ 今天
  });

  it('每月最后一个周X', () => {
    const p = parseTaskInput('每月最后一个周五盘点', TODAY);
    expect(p.repeat.monthlyWhich).toBe(5);
    expect(p.repeat.monthlyWeekday).toBe(5);
  });

  it('每N天', () => {
    const p = parseTaskInput('每3天浇花', TODAY);
    expect(p.repeat.repeatType).toBe('custom');
    expect(p.repeat.repeatInterval).toBe(3);
    expect(p.dueDate).toBe(TODAY);
    expect(p.startDate).toBe(TODAY);
  });

  it('显式日期优先于今天起算', () => {
    const p = parseTaskInput('每天背单词 明天开始', TODAY);
    expect(p.repeat.repeatType).toBe('daily');
    expect(p.dueDate).toBe('2026-11-15');
    expect(p.startDate).toBe('2026-11-15');
  });
});
