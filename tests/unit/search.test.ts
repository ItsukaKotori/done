import { describe, it, expect } from 'vitest';
import { matchesQuery } from '@/lib/search';

describe('matchesQuery', () => {
  const t = { title: 'HSE-差旅安全指南', notes: '出国前需完成培训' };

  it('空查询匹配一切', () => {
    expect(matchesQuery(t, '')).toBe(true);
    expect(matchesQuery(t, '   ')).toBe(true);
  });

  it('命中标题', () => {
    expect(matchesQuery(t, '差旅')).toBe(true);
    expect(matchesQuery(t, 'hse')).toBe(true); // 大小写不敏感
  });

  it('命中备注', () => {
    expect(matchesQuery(t, '培训')).toBe(true);
  });

  it('未命中返回 false', () => {
    expect(matchesQuery(t, '报销')).toBe(false);
  });

  it('notes 为 null 不报错', () => {
    expect(matchesQuery({ title: 'abc', notes: null }, 'abc')).toBe(true);
    expect(matchesQuery({ title: 'abc', notes: null }, 'xyz')).toBe(false);
  });
});
