// src/renderer/src/lib/nlp/rules.ts
import { emptyRepeat, type ParsedTask } from '@shared/parse';
import type { Priority, RecurrenceSpec } from '@shared/types';
import { normalizeTags } from '@shared/tags';
import { addDays, dateToNum, formatDate, occursOn, weekdayOf } from '@shared/recurrence';

// ---- 词表与正则（Task 3/4/5 会继续往这里加日期/时刻/重复模式）----

const RE_TAG = /#([^\s#]+)/g;
const RE_PRIO_HIGH = /(?<!不)(?:高优先级|紧急|加急|重要)/g;
const RE_PRIO_LOW = /低优先级|不紧急|不急/g;
const RE_PRIO_NEG = /不重要/g; // 否定词：不影响优先级，仅从文本剥离（不紧急 由 LOW 分支处理）

const stripMatches = (s: string, re: RegExp): string =>
  s.replaceAll(re, ' ');

const collapse = (s: string): string =>
  s.replaceAll(/\s+/g, ' ').trim().replace(/^[、,，。.\s-]+|[、,，。.\s-]+$/g, '');

// ---- 各维度提取（Task 3/4/5 逐个替换为真实模式解析）----

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 };

const RE_EVERY_DAY = /每天|每日/;
const RE_WORKDAY = /工作日/;
const RE_EVERY_WEEK = /每(?:周|星期|礼拜)[一二三四五六日天、，,\s和与]+/;
const RE_EVERY_MONTH_DATE = /每月\s*(\d{1,2})\s*[号日]/;
const RE_EVERY_MONTH_LAST = /每月最后一个\s*(?:周|星期|礼拜)([一二三四五六日天])/;
const RE_EVERY_MONTH_N = /每月第([一二三四五1-5])\s*个?\s*(?:周|星期|礼拜)([一二三四五六日天])/;
const RE_EVERY_N_DAYS = /每\s*(\d{1,2})\s*天/;

/** 区间 [today, today+62] 内首个符合 repeat 规则的发生日 */
function firstOccurrence(repeat: RecurrenceSpec, today: string): string | null {
  for (let i = 0; i <= 62; i++) {
    const d = addDays(today, i);
    if (occursOn(repeat, today, d)) return d;
  }
  return null;
}

function parseRepeat(rest: string, today: string): { repeat: RecurrenceSpec; text: string } {
  const take = (re: RegExp): RegExpMatchArray | null => rest.match(re);

  let m = take(RE_EVERY_DAY);
  if (m) return { repeat: { ...emptyRepeat(), repeatType: 'daily' }, text: rest.replace(m[0], ' ') };

  m = take(RE_WORKDAY);
  if (m) return { repeat: { ...emptyRepeat(), repeatType: 'weekly', repeatWeekdays: [1, 2, 3, 4, 5] }, text: rest.replace(m[0], ' ') };

  m = take(RE_EVERY_WEEK);
  if (m) {
    const days = [...new Set([...m[0]].filter((c) => c in WEEKDAY_CHAR).map((c) => WEEKDAY_CHAR[c]))].sort((a, b) => a - b);
    if (days.length > 0) {
      return { repeat: { ...emptyRepeat(), repeatType: 'weekly', repeatWeekdays: days }, text: rest.replace(m[0], ' ') };
    }
  }

  m = take(RE_EVERY_MONTH_LAST);
  if (m) {
    return {
      repeat: { ...emptyRepeat(), repeatType: 'monthly', monthlyMode: 'by_weekday', monthlyWeekday: WEEKDAY_CHAR[m[1]], monthlyWhich: 5 },
      text: rest.replace(m[0], ' '),
    };
  }

  m = take(RE_EVERY_MONTH_N);
  if (m) {
    const which = CN_NUM[m[1]] ?? Number(m[1]);
    return {
      repeat: { ...emptyRepeat(), repeatType: 'monthly', monthlyMode: 'by_weekday', monthlyWeekday: WEEKDAY_CHAR[m[2]], monthlyWhich: which },
      text: rest.replace(m[0], ' '),
    };
  }

  m = take(RE_EVERY_MONTH_DATE);
  if (m) {
    return {
      repeat: { ...emptyRepeat(), repeatType: 'monthly', monthlyMode: 'by_date', monthlyDay: Number(m[1]) },
      text: rest.replace(m[0], ' '),
    };
  }

  m = take(RE_EVERY_N_DAYS);
  if (m) {
    const n = Number(m[1]);
    if (n >= 2) return { repeat: { ...emptyRepeat(), repeatType: 'custom', repeatInterval: n }, text: rest.replace(m[0], ' ') };
  }

  return { repeat: emptyRepeat(), text: rest };
}

const WEEKDAY_CHAR: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0,
};

const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

/** 非法月/非法日（如 2月30号）滚动到下一个有效年月；日/月越界返回 ''（无效哨兵） */
function resolveDate(y: number, m: number, day: number): string {
  if (day < 1 || day > 31 || m < 1 || m > 12) return '';
  let yy = y, mm = m;
  while (day > daysInMonth(yy, mm)) {
    mm += 1;
    if (mm > 12) { yy += 1; mm = 1; }
  }
  return formatDate(yy, mm, day);
}

/** 下一个 target 星期几；forceNextWeek 时保证落在下个日历周（周一为一周起点） */
function nextWeekday(today: string, target: number, forceNextWeek: boolean): string {
  const cur = weekdayOf(today);
  const cand = addDays(today, (target - cur + 7) % 7); // 含今天
  if (!forceNextWeek) return cand;
  const mondayOf = (d: string) => addDays(d, -((weekdayOf(d) + 6) % 7));
  return mondayOf(cand) === mondayOf(today) ? addDays(cand, 7) : cand;
}

const RE_DATE_PATTERNS: [RegExp, (m: RegExpMatchArray, today: string) => string][] = [
  [/大后天/, (_m, t) => addDays(t, 3)],
  [/后天/, (_m, t) => addDays(t, 2)],
  [/明天|次日/, (_m, t) => addDays(t, 1)],
  [/今天|今日/, (_m, t) => t],
  [/下(?:周|星期|礼拜)([一二三四五六日天])/, (m, t) => nextWeekday(t, WEEKDAY_CHAR[m[1]], true)],
  [/本月\s*(\d{1,2})\s*[号日]/, (m, t) => {
    const [y, mo] = t.split('-').map(Number);
    const day = Number(m[1]);
    const cand = resolveDate(y, mo, day);
    if (dateToNum(cand) >= dateToNum(t)) return cand;
    const nm = mo === 12 ? 1 : mo + 1;
    const ny = mo === 12 ? y + 1 : y;
    return resolveDate(ny, nm, day);
  }],
  [/下月\s*(\d{1,2})\s*[号日]/, (m, t) => {
    const [y, mo] = t.split('-').map(Number);
    const nm = mo === 12 ? 1 : mo + 1;
    return resolveDate(mo === 12 ? y + 1 : y, nm, Number(m[1]));
  }],
  [/(\d{4})-(\d{1,2})-(\d{1,2})/, (m) => resolveDate(Number(m[1]), Number(m[2]), Number(m[3]))],
  [/(\d{1,2})月(\d{1,2})[号日]/, (m, t) => {
    const y = Number(t.split('-')[0]);
    const d = resolveDate(y, Number(m[1]), Number(m[2]));
    return dateToNum(d) >= dateToNum(t) ? d : resolveDate(y + 1, Number(m[1]), Number(m[2]));
  }],
  [/(\d{1,2})\/(\d{1,2})/, (m, t) => {
    const y = Number(t.split('-')[0]);
    const d = resolveDate(y, Number(m[1]), Number(m[2]));
    return dateToNum(d) >= dateToNum(t) ? d : resolveDate(y + 1, Number(m[1]), Number(m[2]));
  }],
  [/[周星期礼拜]([一二三四五六日天])/, (m, t) => nextWeekday(t, WEEKDAY_CHAR[m[1]], false)],
];

function parseDate(rest: string, today: string): { dueDate: string | null; text: string } {
  for (const [re, build] of RE_DATE_PATTERNS) {
    const m = rest.match(re);
    if (m) {
      const dueDate = build(m, today);
      if (!dueDate) return { dueDate: null, text: rest }; // 非法值视为未命中，文本不消费、不再尝试后续模式
      return { dueDate, text: rest.replace(m[0], ' ') };
    }
  }
  return { dueDate: null, text: rest };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

const RE_TIME = /(早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2})点(?:(\d{1,2})分|(半))?/;
const RE_TIME_HM = /(\d{1,2}):(\d{2})/;

function parseTime(rest: string): { timeOfDay: string | null; text: string } {
  const hm = rest.match(RE_TIME_HM);
  if (hm) {
    const h = Number(hm[1]);
    const min = Number(hm[2]);
    if (h <= 23 && min <= 59) {
      return { timeOfDay: `${pad2(h)}:${pad2(min)}`, text: rest.replace(hm[0], ' ') };
    }
  }
  const m = rest.match(RE_TIME);
  if (m) {
    const period = m[1];
    let h = Number(m[2]);
    const min = m[4] === '半' ? 30 : Number(m[3] ?? 0);
    if (h >= 0 && h <= 23 && min <= 59) {
      const afternoon = period !== undefined && period !== '早上' && period !== '上午';
      if (period === '中午' && h === 12) h = 12;
      else if (period === '中午' && h < 12) h += 12;
      else if (afternoon && h < 12) h += 12;
      else if (!period && h >= 1 && h <= 5) h += 12; // 裸 1-5 点默认下午
      if (h <= 23) {
        return { timeOfDay: `${pad2(h)}:${pad2(min)}`, text: rest.replace(m[0], ' ') };
      }
    }
  }
  return { timeOfDay: null, text: rest };
}

// ---- 主入口 ----

export function parseTaskInput(raw: string, today: string): ParsedTask {
  // 1) 标签
  const tags = normalizeTags([...raw.matchAll(RE_TAG)].map((m) => m[1]));
  let rest = raw.replaceAll(RE_TAG, ' ');

  // 2) 优先级
  rest = stripMatches(rest, RE_PRIO_NEG);
  let priority: Priority = 1;
  if (RE_PRIO_HIGH.test(rest)) { priority = 2; rest = stripMatches(rest, RE_PRIO_HIGH); }
  else if (RE_PRIO_LOW.test(rest)) { priority = 0; rest = stripMatches(rest, RE_PRIO_LOW); }

  // 3) 重复（必须先于日期：每周X 抢在 周X 之前消费文本）
  const rep = parseRepeat(rest, today);
  rest = rep.text;

  // 4) 日期
  const dt = parseDate(rest, today);
  rest = dt.text;

  // 5) 时刻
  const tm = parseTime(rest);
  rest = tm.text;

  // 6) 标题：剩余文本
  const title = collapse(rest);

  // 7) 重复任务：无显式日期 → 今天起算；startDate = 首个发生日（每周X/每月X 需扫描）
  let dueDate = dt.dueDate;
  let startDate: string | null = null;
  if (rep.repeat.repeatType !== 'none') {
    if (!dueDate) dueDate = today;
    startDate = dueDate;
    if (rep.repeat.repeatType === 'weekly' || rep.repeat.repeatType === 'monthly') {
      const first = firstOccurrence(rep.repeat, dueDate);
      if (first) { dueDate = first; startDate = first; }
    }
  }

  return {
    title, dueDate, timeOfDay: tm.timeOfDay, priority, tags,
    repeat: rep.repeat, source: 'rules',
    startDate,
  };
}
