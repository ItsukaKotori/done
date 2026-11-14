// src/renderer/src/lib/nlp/rules.ts
import { emptyRepeat, type ParsedTask } from '@shared/parse';
import type { Priority, RecurrenceSpec } from '@shared/types';
import { normalizeTags } from '@shared/tags';
import { addDays, weekdayOf, formatDate } from '@shared/recurrence';

// ---- 词表与正则（Task 3/4/5 会继续往这里加日期/时刻/重复模式）----

const RE_TAG = /#([^\s#]+)/g;
const RE_PRIO_HIGH = /高优先级|紧急|加急|重要/g;
const RE_PRIO_LOW = /低优先级|不急/g;

const stripMatches = (s: string, re: RegExp): string =>
  s.replaceAll(re, ' ');

const collapse = (s: string): string =>
  s.replaceAll(/\s+/g, ' ').trim().replace(/^[、,，。.\s-]+|[、,，。.\s-]+$/g, '');

// ---- 各维度提取（桩：Task 3/4/5 逐个替换为真实模式解析）----

function parseRepeat(_rest: string, _today: string): { repeat: RecurrenceSpec; text: string } {
  return { repeat: emptyRepeat(), text: _rest };
}

const WEEKDAY_CHAR: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0,
};

const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

/** 非法月（>12）/非法日（如 2月30号）滚动到下一个有效年月 */
function resolveDate(y: number, m: number, day: number): string {
  let yy = y, mm = m;
  if (mm > 12) { yy += Math.floor((mm - 1) / 12); mm = ((mm - 1) % 12) + 1; }
  while (day > daysInMonth(yy, mm)) {
    mm += 1;
    if (mm > 12) { yy += 1; mm = 1; }
  }
  return formatDate(yy, mm, day);
}

const dateNum = (d: string) => Number(d.replaceAll('-', ''));

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
    if (dateNum(cand) >= dateNum(t)) return cand;
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
    return dateNum(d) >= dateNum(t) ? d : resolveDate(y + 1, Number(m[1]), Number(m[2]));
  }],
  [/(\d{1,2})\/(\d{1,2})/, (m, t) => {
    const y = Number(t.split('-')[0]);
    const d = resolveDate(y, Number(m[1]), Number(m[2]));
    return dateNum(d) >= dateNum(t) ? d : resolveDate(y + 1, Number(m[1]), Number(m[2]));
  }],
  [/[周星期礼拜]([一二三四五六日天])/, (m, t) => nextWeekday(t, WEEKDAY_CHAR[m[1]], false)],
];

function parseDate(rest: string, today: string): { dueDate: string | null; text: string } {
  for (const [re, build] of RE_DATE_PATTERNS) {
    const m = rest.match(re);
    if (m) {
      return { dueDate: build(m, today), text: rest.replace(m[0], ' ') };
    }
  }
  return { dueDate: null, text: rest };
}

function parseTime(_rest: string): { timeOfDay: string | null; text: string } {
  return { timeOfDay: null, text: _rest };
}

// ---- 主入口 ----

export function parseTaskInput(raw: string, today: string): ParsedTask {
  // 1) 标签
  const tags = normalizeTags([...raw.matchAll(RE_TAG)].map((m) => m[1]));
  let rest = raw.replaceAll(RE_TAG, ' ');

  // 2) 优先级
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

  // 7) 重复任务无显式日期 → 今天起算
  const dueDate =
    rep.repeat.repeatType !== 'none' ? (dt.dueDate ?? today) : dt.dueDate;

  return {
    title, dueDate, timeOfDay: tm.timeOfDay, priority, tags,
    repeat: rep.repeat, source: 'rules',
  };
}
