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
