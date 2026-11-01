import { describe, it, expect } from 'vitest';
import { normalizeTags } from '@shared/tags';

describe('normalizeTags', () => {
  it('去首尾空白', () => {
    expect(normalizeTags(['  a  ', 'b '])).toEqual(['a', 'b']);
  });

  it('去重并保留首次出现顺序', () => {
    expect(normalizeTags(['b', 'a', 'b', 'a'])).toEqual(['b', 'a']);
  });

  it('丢弃空串与纯空白', () => {
    expect(normalizeTags(['', '  ', 'x'])).toEqual(['x']);
  });

  it('空数组返回空数组', () => {
    expect(normalizeTags([])).toEqual([]);
  });
});
