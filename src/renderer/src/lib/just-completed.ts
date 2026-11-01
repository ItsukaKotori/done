/**
 * 刚完成的期次标记。
 * 完成 → 数据刷新后条目会被重排到「已完成」区，React 视为不同节点重新挂载，
 * 组件内无法用 prev-state 判断"刚刚发生"，故在调用侧打时间戳、组件挂载时消费一次。
 */
const WINDOW_MS = 1500;
const recent = new Map<string, number>();

export const occurrenceKey = (todoId: number, date: string): string => `${todoId}-${date}`;

export function markCompleted(key: string): void {
  recent.set(key, Date.now());
}

/** 读取即消费，保证一次完成只播一次动效 */
export function consumeCompleted(key: string): boolean {
  const at = recent.get(key);
  if (at === undefined) return false;
  recent.delete(key);
  return Date.now() - at < WINDOW_MS;
}
