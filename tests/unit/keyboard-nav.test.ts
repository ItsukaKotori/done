import { describe, it, expect } from 'vitest';
import { moveIndex } from '@/lib/keyboard-nav';

describe('moveIndex', () => {
  it('空列表返回 -1', () => {
    expect(moveIndex(0, -1, 'down')).toBe(-1);
    expect(moveIndex(0, 3, 'up')).toBe(-1);
  });

  it('无选中时从端点进入', () => {
    expect(moveIndex(5, -1, 'down')).toBe(0);
    expect(moveIndex(5, -1, 'up')).toBe(4);
  });

  it('按方向移动', () => {
    expect(moveIndex(5, 0, 'down')).toBe(1);
    expect(moveIndex(5, 3, 'up')).toBe(2);
  });

  it('边界夹取', () => {
    expect(moveIndex(5, 4, 'down')).toBe(4);
    expect(moveIndex(5, 0, 'up')).toBe(0);
  });
});
