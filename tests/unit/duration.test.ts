import { describe, it, expect } from 'vitest';
import { formatDuration } from '@/lib/duration';

describe('formatDuration', () => {
  it('<1h 显示 MM:SS', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(59 * 60_000 + 59_000)).toBe('59:59');
  });

  it('≥1h 显示 H:MM:SS', () => {
    expect(formatDuration(3_600_000)).toBe('1:00:00');
    expect(formatDuration(3_600_000 + 25 * 60_000 + 7_000)).toBe('1:25:07');
  });

  it('负数与亚秒归零', () => {
    expect(formatDuration(-500)).toBe('0:00');
    expect(formatDuration(999)).toBe('0:00');
  });
});
