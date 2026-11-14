// src/renderer/src/lib/nlp/rules.ts
import { emptyRepeat, type ParsedTask } from '@shared/parse';
import type { Priority, RecurrenceSpec } from '@shared/types';
import { normalizeTags } from '@shared/tags';

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

function parseDate(_rest: string, _today: string): { dueDate: string | null; text: string } {
  return { dueDate: null, text: _rest };
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
