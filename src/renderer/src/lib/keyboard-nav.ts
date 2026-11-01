export type NavDir = 'down' | 'up';

/**
 * 列表键盘导航索引。
 * length<=0 → -1；current=-1（无选中）→ 从端点进入；否则按方向移动并夹取边界。
 */
export function moveIndex(length: number, current: number, dir: NavDir): number {
  if (length <= 0) return -1;
  if (current < 0) return dir === 'down' ? 0 : length - 1;
  const next = dir === 'down' ? current + 1 : current - 1;
  return Math.min(length - 1, Math.max(0, next));
}
