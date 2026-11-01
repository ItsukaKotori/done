import type { RecurrenceSpec } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' -> 可比较数值（20261027）；仅用于大小比较，不用于跨月运算 */
export const dateToNum = (d: string) => Number(d.replaceAll('-', ''));

function parse(d: string): { y: number; m: number; day: number } {
  const [y, m, day] = d.split('-').map(Number);
  return { y, m, day };
}

export const formatDate = (y: number, m: number, day: number) => `${y}-${pad(m)}-${pad(day)}`;

export function weekdayOf(d: string): number {
  const { y, m, day } = parse(d);
  return new Date(y, m - 1, day).getDay();
}

export function addDays(d: string, n: number): string {
  const p = parse(d);
  const dt = new Date(p.y, p.m - 1, p.day + n);
  return formatDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

function dayDiff(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  // UTC 运算避免本地时区/DST 干扰天数差
  return Math.round((Date.UTC(y.y, y.m - 1, y.day) - Date.UTC(x.y, x.m - 1, x.day)) / 86_400_000);
}

export function todayStr(nowMs: number): string {
  const d = new Date(nowMs);
  return formatDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * 本地时区时间戳。DST 跳变导致的不存在时刻由 Date 构造器归一到下一有效瞬间，
 * 符合规格 §7 "DST 跳变当天取实际存在时刻"。
 */
export function dateToLocalMs(date: string, timeOfDay: string): number {
  const p = parse(date);
  const [h, mi] = timeOfDay.split(':').map(Number);
  return new Date(p.y, p.m - 1, p.day, h, mi, 0, 0).getTime();
}

function occursByDate(spec: RecurrenceSpec, date: string): boolean {
  const p = parse(date);
  const target = spec.monthlyDay ?? 1;
  // 当月无该日 -> 跳过该月（规格 §7 月末滚动）
  return target <= daysInMonth(p.y, p.m) && p.day === target;
}

function occursByWeekday(spec: RecurrenceSpec, date: string): boolean {
  const p = parse(date);
  if (weekdayOf(date) !== (spec.monthlyWeekday ?? 1)) return false;
  if ((spec.monthlyWhich ?? 1) === 5) return p.day > daysInMonth(p.y, p.m) - 7; // 最后一个
  return Math.ceil(p.day / 7) === (spec.monthlyWhich ?? 1);
}

export function occursOn(spec: RecurrenceSpec, start: string, date: string): boolean {
  if (dateToNum(date) < dateToNum(start)) return false;
  switch (spec.repeatType) {
    case 'none':
      return date === start;
    case 'daily':
      return true;
    case 'weekly':
      return (spec.repeatWeekdays ?? []).includes(weekdayOf(date));
    case 'monthly':
      return spec.monthlyMode === 'by_weekday'
        ? occursByWeekday(spec, date)
        : occursByDate(spec, date);
    case 'custom':
      return dayDiff(start, date) % Math.max(1, spec.repeatInterval ?? 1) === 0;
  }
}

/** 区间内全部发生日（含端点）；调用方保证 from/to 为当月网格范围或任意区间 */
export function occurrencesInRange(
  spec: RecurrenceSpec, start: string, from: string, to: string,
): string[] {
  const out: string[] = [];
  const begin = dateToNum(start) >= dateToNum(from) ? start : from;
  if (dateToNum(to) < dateToNum(begin)) return out;
  for (let cur = begin; dateToNum(cur) <= dateToNum(to); cur = addDays(cur, 1)) {
    if (occursOn(spec, start, cur)) out.push(cur);
  }
  return out;
}

/**
 * afterExclusive 之后的前 count 个发生日。
 * exclude 过滤 done/skipped；安全阀从扫描起点（而非锚点）起算 730 天，
 * 防止永不命中的规则死循环，同时不截断长寿命重复任务的未来发生日。
 */
export function nextOccurrences(
  spec: RecurrenceSpec,
  start: string,
  afterExclusive: string,
  count: number,
  exclude: Set<string> = new Set(),
): string[] {
  const out: string[] = [];
  const scanFrom =
    dateToNum(afterExclusive) >= dateToNum(start) ? addDays(afterExclusive, 1) : start;
  const limit = dateToNum(addDays(scanFrom, 730));
  for (let cur = scanFrom; out.length < count && dateToNum(cur) <= limit; cur = addDays(cur, 1)) {
    if (occursOn(spec, start, cur) && !exclude.has(cur)) out.push(cur);
  }
  return out;
}
