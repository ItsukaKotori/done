import type { Priority } from '@shared/types';

/** 优先级色阶：绿=低 / 琥珀=中 / 红=高（通用严重度语义） */
export const PRIORITY_COLOR: Record<Priority, string> = {
  0: 'bg-priority-low',
  1: 'bg-priority-mid',
  2: 'bg-priority-high',
};
