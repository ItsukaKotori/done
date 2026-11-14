# 智能快添（规则先行 + AI 增强）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 快添窗升级为零延迟规则解析预览（chips）+ 可选国内大模型 AI 增强的智能快添。

**Architecture:** 纯函数规则解析器在渲染进程本地即时解析；主进程 `AiParser` 服务经 OpenAI 兼容 HTTP 调用国内模型做结构化提取，失败静默降级保留规则结果；API Key 经 `safeStorage` 加密落 SQLite。

**Tech Stack:** TypeScript、React 19、Vitest（node env）、Node 22 内置 fetch（无新增运行时依赖）。

**Spec:** `docs/superpowers/specs/2026-11-14-smart-quickadd-design.md`

## Global Constraints

- 包管理一律 `pnpm`；Node `>=22.12`。
- 不新增任何运行时依赖（AI 调用用 Node 内置 `fetch`）。
- vitest 别名：`@shared` → `src/shared`，`@` → `src/renderer/src`；测试文件放 `tests/unit/` 或 `tests/integration/`。
- 每周约定 **0=周日…6=周六**（`src/shared/types.ts` 既有约定，勿改）。
- IPC 一律走 `wrap()` envelope（`R<T>`），通道名进 `Ipc` 常量表。
- commit message 用 conventional commits，末尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 每个任务结束时全量 `pnpm test` 必须绿（不只是新测试）。

---

### Task 1: 共享解析模型 `parse.ts`（ParsedTask + toDraft 映射）

**Files:**
- Create: `src/shared/parse.ts`
- Test: `tests/unit/parse-draft.test.ts`

**Interfaces:**
- Consumes: `RecurrenceSpec/TodoDraft/Priority`（`@shared/types`）、`todayStr`（`@shared/recurrence`）、`normalizeTags`（`@shared/tags`）
- Produces: `interface ParsedTask { title; dueDate; timeOfDay; priority; tags; repeat: RecurrenceSpec; source: 'rules' | 'ai' }`、`emptyRepeat(): RecurrenceSpec`、`parsedToDraft(p: ParsedTask, nowMs: number): TodoDraft`（后续所有任务依赖）

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/parse-draft.test.ts
import { describe, it, expect } from 'vitest';
import { emptyRepeat, parsedToDraft, type ParsedTask } from '@shared/parse';
import { todayStr } from '@shared/recurrence';

const NOW = new Date(2026, 10, 14, 9, 0).getTime(); // 2026-11-14 周六

const task = (over: Partial<ParsedTask>): ParsedTask => ({
  title: '任务', dueDate: null, timeOfDay: null, priority: 1,
  tags: [], repeat: emptyRepeat(), source: 'rules', ...over,
});

describe('parsedToDraft', () => {
  it('零命中：dueDate 落到今天（与现有快添行为一致）', () => {
    const d = parsedToDraft(task({}), NOW);
    expect(d.dueDate).toBe(todayStr(NOW));
    expect(d.title).toBe('任务');
    expect(d.priority).toBe(1);
    expect(d.repeatType).toBe('none');
    expect(d.completedAt).toBeNull();
    expect(d.tags).toEqual([]);
  });

  it('透传显式字段', () => {
    const d = parsedToDraft(task({
      dueDate: '2026-11-20', timeOfDay: '15:00', priority: 2,
      tags: ['工作', '工作'], startDate: '2026-11-20',
      repeat: { repeatType: 'weekly', repeatWeekdays: [3, 5] },
    }), NOW);
    expect(d.dueDate).toBe('2026-11-20');
    expect(d.timeOfDay).toBe('15:00');
    expect(d.priority).toBe(2);
    expect(d.startDate).toBe('2026-11-20');
    expect(d.repeatType).toBe('weekly');
    expect(d.repeatWeekdays).toEqual([3, 5]);
    expect(d.tags).toEqual(['工作']); // 归一化去重
  });

  it('repeat 展平到 draft 顶层字段', () => {
    const d = parsedToDraft(task({
      repeat: { repeatType: 'monthly', monthlyMode: 'by_weekday', monthlyWeekday: 5, monthlyWhich: 3 },
    }), NOW);
    expect(d.repeatType).toBe('monthly');
    expect(d.monthlyMode).toBe('by_weekday');
    expect(d.monthlyWeekday).toBe(5);
    expect(d.monthlyWhich).toBe(3);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/unit/parse-draft.test.ts`
Expected: FAIL（`@shared/parse` 不存在）

- [ ] **Step 3: 实现**

```ts
// src/shared/parse.ts
import type { Priority, RecurrenceSpec, TodoDraft } from './types';
import { todayStr } from './recurrence';
import { normalizeTags } from './tags';

export interface ParsedTask {
  title: string;
  dueDate: string | null;    // YYYY-MM-DD，已按 today 锚点解析为绝对日期
  timeOfDay: string | null;  // HH:mm
  priority: Priority;
  tags: string[];
  repeat: RecurrenceSpec;
  source: 'rules' | 'ai';
}

export function emptyRepeat(): RecurrenceSpec {
  return {
    repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
    monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  };
}

/** ParsedTask → 快添/编辑器预填的 TodoDraft；无日期的一次性任务落到今天（现状行为） */
export function parsedToDraft(p: ParsedTask, nowMs: number): TodoDraft {
  const r = p.repeat;
  return {
    title: p.title, notes: null,
    dueDate: p.dueDate ?? todayStr(nowMs),
    timeOfDay: p.timeOfDay,
    priority: p.priority,
    repeatType: r.repeatType,
    repeatInterval: r.repeatInterval ?? null,
    repeatWeekdays: r.repeatWeekdays ?? null,
    monthlyMode: r.monthlyMode ?? null,
    monthlyDay: r.monthlyDay ?? null,
    monthlyWeekday: r.monthlyWeekday ?? null,
    monthlyWhich: r.monthlyWhich ?? null,
    startDate: p.startDate ?? null,
    completedAt: null,
    tags: normalizeTags(p.tags),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/unit/parse-draft.test.ts`
Expected: PASS

- [ ] **Step 5: 全量测试 + 提交**

```bash
pnpm test
git add src/shared/parse.ts tests/unit/parse-draft.test.ts
git commit -m "feat: shared ParsedTask model and draft mapping for smart quickadd

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 规则解析器骨架（标签/优先级/标题 + 结构桩）

**Files:**
- Create: `src/renderer/src/lib/nlp/rules.ts`
- Test: `tests/unit/nlp-rules.test.ts`

**Interfaces:**
- Consumes: `ParsedTask/emptyRepeat`（`@shared/parse`）、`normalizeTags`（`@shared/tags`）
- Produces: `parseTaskInput(input: string, today: string): ParsedTask`（Task 3/4/5 在本文件内替换 `parseDate/parseTime/parseRepeat` 三个桩函数）

- [ ] **Step 1: 写失败测试（本任务只测标签/优先级/标题/零命中）**

```ts
// tests/unit/nlp-rules.test.ts
import { describe, it, expect } from 'vitest';
import { parseTaskInput } from '@/lib/nlp/rules';

const TODAY = '2026-11-14'; // 周六
const base = { source: 'rules' as const };

describe('标签与优先级', () => {
  it('提取 #标签 并从标题剥离', () => {
    const p = parseTaskInput('买菜 #生活 #生活', TODAY);
    expect(p.title).toBe('买菜');
    expect(p.tags).toEqual(['生活']);
  });

  it('高优先级/紧急 → 2 并剥离', () => {
    expect(parseTaskInput('交报告 紧急', TODAY).priority).toBe(2);
    expect(parseTaskInput('交报告 紧急', TODAY).title).toBe('交报告');
    expect(parseTaskInput('高优先级体检', TODAY).priority).toBe(2);
    expect(parseTaskInput('高优先级体检', TODAY).title).toBe('体检');
  });

  it('低优先级/不急 → 0 并剥离', () => {
    expect(parseTaskInput('整理相册 不急', TODAY).priority).toBe(0);
    expect(parseTaskInput('低优先级回邮件', TODAY).priority).toBe(0);
  });

  it('优先级缺省 1', () => {
    expect(parseTaskInput('普通任务', TODAY).priority).toBe(1);
  });
});

describe('标题与零命中', () => {
  it('纯标题：除标题外全为缺省，行为与现状一致', () => {
    const p = parseTaskInput('  买牛奶  ', TODAY);
    expect(p.title).toBe('买牛奶');
    expect(p.dueDate).toBeNull();
    expect(p.timeOfDay).toBeNull();
    expect(p.repeat.repeatType).toBe('none');
  });

  it('空/空白输入 → 空标题', () => {
    expect(parseTaskInput('   ', TODAY).title).toBe('');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/unit/nlp-rules.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现（三个模式函数先做透传桩，Task 3/4/5 替换）**

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/unit/nlp-rules.test.ts`
Expected: PASS

- [ ] **Step 5: 全量测试 + 提交**

```bash
pnpm test
git add src/renderer/src/lib/nlp/rules.ts tests/unit/nlp-rules.test.ts
git commit -m "feat: quickadd rule parser skeleton with tags, priority and title

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 规则解析器——日期模式

**Files:**
- Modify: `src/renderer/src/lib/nlp/rules.ts`（替换 `parseDate` 桩，新增日期辅助函数）
- Test: `tests/unit/nlp-rules.test.ts`（追加 describe 块）

**Interfaces:**
- Consumes: `addDays/weekdayOf/formatDate`（`@shared/recurrence`）
- Produces: 私有函数 `resolveDate(y,m,day)`（非法日滚动到下个有效月）、`nextWeekday(today, target, forceNextWeek)`（`forceNextWeek` 用于"下周X"）

- [ ] **Step 1: 追加失败测试**

```ts
// 追加到 tests/unit/nlp-rules.test.ts
describe('日期', () => {
  it('相对词：今天/明天/后天/大后天', () => {
    expect(parseTaskInput('今天买菜', TODAY).dueDate).toBe('2026-11-14');
    expect(parseTaskInput('明天交报告', TODAY).title).toBe('交报告');
    expect(parseTaskInput('明天交报告', TODAY).dueDate).toBe('2026-11-15');
    expect(parseTaskInput('后天体检', TODAY).dueDate).toBe('2026-11-16');
    expect(parseTaskInput('大后天搬家', TODAY).dueDate).toBe('2026-11-17');
  });

  it('周X：今天是该周几则今天，否则下一个该周几', () => {
    expect(parseTaskInput('周六聚会', TODAY).dueDate).toBe('2026-11-14'); // 今天周六
    expect(parseTaskInput('周一开会', TODAY).dueDate).toBe('2026-11-16'); // 下一个周一
    expect(parseTaskInput('周日补觉', TODAY).dueDate).toBe('2026-11-15');
  });

  it('下周X：恒为下个日历周', () => {
    expect(parseTaskInput('下周一开工', TODAY).dueDate).toBe('2026-11-16'); // 今天周六 → 下周一 11-16
    expect(parseTaskInput('下周三评审', TODAY).dueDate).toBe('2026-11-18');
    expect(parseTaskInput('下周日收尾', TODAY).dueDate).toBe('2026-11-22');
  });

  it('本月X号/下月X号', () => {
    expect(parseTaskInput('本月20号发版', TODAY).dueDate).toBe('2026-11-20');
    expect(parseTaskInput('本月5号对账', TODAY).dueDate).toBe('2026-12-05'); // 已过 → 翻下月
    expect(parseTaskInput('下月1号总结', TODAY).dueDate).toBe('2026-12-01');
  });

  it('X月X号 无年份：今年取未来，已过取明年', () => {
    expect(parseTaskInput('12月31号跨年', TODAY).dueDate).toBe('2026-12-31');
    expect(parseTaskInput('1月1号新年计划', TODAY).dueDate).toBe('2027-01-01');
  });

  it('ISO 与 M/D', () => {
    expect(parseTaskInput('2026-12-01 复盘', TODAY).dueDate).toBe('2026-12-01');
    expect(parseTaskInput('11/30 结账', TODAY).dueDate).toBe('2026-11-30');
  });

  it('非法日滚动：2月30号 → 3月30号', () => {
    expect(parseTaskInput('2月30号查账', TODAY).dueDate).toBe('2027-03-30');
  });

  it('日期从标题剥离', () => {
    expect(parseTaskInput('明天交报告', TODAY).title).toBe('交报告');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/unit/nlp-rules.test.ts`
Expected: FAIL（日期用例全红）

- [ ] **Step 3: 实现日期解析（替换 `parseDate` 桩）**

在 `rules.ts` 顶部 import 处追加：

```ts
import { addDays, weekdayOf, formatDate } from '@shared/recurrence';
```

在文件内新增（替换整个 `parseDate` 桩函数）：

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/unit/nlp-rules.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 全量测试 + 提交**

```bash
pnpm test
git add src/renderer/src/lib/nlp/rules.ts tests/unit/nlp-rules.test.ts
git commit -m "feat: date pattern parsing in quickadd rule parser

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 规则解析器——时刻模式

**Files:**
- Modify: `src/renderer/src/lib/nlp/rules.ts`（替换 `parseTime` 桩）
- Test: `tests/unit/nlp-rules.test.ts`（追加 describe 块）

**Interfaces:**
- Consumes: 无新增
- Produces: `parseTime(rest) → { timeOfDay: 'HH:mm' | null; text }`

- [ ] **Step 1: 追加失败测试**

```ts
// 追加到 tests/unit/nlp-rules.test.ts
describe('时刻', () => {
  it('HH:mm 字面量原样', () => {
    const p = parseTaskInput('15:30 站会', TODAY);
    expect(p.timeOfDay).toBe('15:30');
    expect(p.title).toBe('站会');
  });

  it('时段词 + X点(半/X分)', () => {
    expect(parseTaskInput('下午3点理疗', TODAY).timeOfDay).toBe('15:00');
    expect(parseTaskInput('下午3点半取药', TODAY).timeOfDay).toBe('15:30');
    expect(parseTaskInput('上午9点晨会', TODAY).timeOfDay).toBe('09:00');
    expect(parseTaskInput('晚上8点健身', TODAY).timeOfDay).toBe('20:00');
    expect(parseTaskInput('中午12点吃饭', TODAY).timeOfDay).toBe('12:00');
    expect(parseTaskInput('中午1点午休', TODAY).timeOfDay).toBe('13:00');
    expect(parseTaskInput('上午10点45分答辩', TODAY).timeOfDay).toBe('10:45');
  });

  it('裸 X点：1-5 默认下午，6-11 原样', () => {
    expect(parseTaskInput('3点开会', TODAY).timeOfDay).toBe('15:00');
    expect(parseTaskInput('9点打卡', TODAY).timeOfDay).toBe('09:00');
    expect(parseTaskInput('12点吃饭', TODAY).timeOfDay).toBe('12:00');
  });

  it('时刻从标题剥离', () => {
    expect(parseTaskInput('下午3点理疗', TODAY).title).toBe('理疗');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/unit/nlp-rules.test.ts`
Expected: FAIL（时刻用例全红）

- [ ] **Step 3: 实现（替换 `parseTime` 桩）**

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/unit/nlp-rules.test.ts`
Expected: PASS

- [ ] **Step 5: 全量测试 + 提交**

```bash
pnpm test
git add src/renderer/src/lib/nlp/rules.ts tests/unit/nlp-rules.test.ts
git commit -m "feat: time-of-day parsing in quickadd rule parser

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 规则解析器——重复模式 + 整合

**Files:**
- Modify: `src/renderer/src/lib/nlp/rules.ts`（替换 `parseRepeat` 桩；`parseTaskInput` 内组装 startDate）
- Test: `tests/unit/nlp-rules.test.ts`（追加 describe 块）

**Interfaces:**
- Consumes: `occursOn`（`@shared/recurrence`，用于 monthly-by-weekday 首个发生日扫描）
- Produces: `parseRepeat(rest, today) → { repeat: RecurrenceSpec; text }`；`parseTaskInput` 输出的重复任务带 `startDate`

- [ ] **Step 1: 追加失败测试**

```ts
// 追加到 tests/unit/nlp-rules.test.ts
describe('重复', () => {
  it('每天', () => {
    const p = parseTaskInput('每天喝水', TODAY);
    expect(p.repeat.repeatType).toBe('daily');
    expect(p.title).toBe('喝水');
    expect(p.dueDate).toBe(TODAY); // 无显式日期 → 今天
  });

  it('每周多日（含分隔符）', () => {
    const p = parseTaskInput('每周三、五开周会', TODAY);
    expect(p.repeat.repeatType).toBe('weekly');
    expect(p.repeat.repeatWeekdays).toEqual([3, 5]); // 0=周日…6=周六
    expect(p.title).toBe('开周会');
    expect(p.dueDate).toBe('2026-11-18'); // 今天周六 → 下一个命中日是周三 11-18
  });

  it('每周多日的首个发生日', () => {
    // 今天周六(11-14)：每周日 → 首个发生日 11-15
    const p = parseTaskInput('每周日复盘', TODAY);
    expect(p.repeat.repeatWeekdays).toEqual([0]);
    expect(p.dueDate).toBe('2026-11-15');
    expect(p.startDate).toBe('2026-11-15');
  });

  it('工作日 = 周一~周五', () => {
    const p = parseTaskInput('工作日写日报', TODAY);
    expect(p.repeat.repeatType).toBe('weekly');
    expect(p.repeat.repeatWeekdays).toEqual([1, 2, 3, 4, 5]);
    expect(p.dueDate).toBe('2026-11-16'); // 周六 → 下一个工作日周一
  });

  it('每月X号', () => {
    const p = parseTaskInput('每月1号交房租', TODAY);
    expect(p.repeat.repeatType).toBe('monthly');
    expect(p.repeat.monthlyMode).toBe('by_date');
    expect(p.repeat.monthlyDay).toBe(1);
    expect(p.dueDate).toBe('2026-12-01'); // 本月1号已过
  });

  it('每月第N个周X', () => {
    const p = parseTaskInput('每月第三个周三团队日', TODAY);
    expect(p.repeat.monthlyMode).toBe('by_weekday');
    expect(p.repeat.monthlyWeekday).toBe(3);
    expect(p.repeat.monthlyWhich).toBe(3);
    expect(p.dueDate).toBe('2026-11-18'); // 2026-11 的周三：4/11/18/25，第三个 = 11-18 ≥ 今天
  });

  it('每月最后一个周X', () => {
    const p = parseTaskInput('每月最后一个周五盘点', TODAY);
    expect(p.repeat.monthlyWhich).toBe(5);
    expect(p.repeat.monthlyWeekday).toBe(5);
  });

  it('每N天', () => {
    const p = parseTaskInput('每3天浇花', TODAY);
    expect(p.repeat.repeatType).toBe('custom');
    expect(p.repeat.repeatInterval).toBe(3);
    expect(p.dueDate).toBe(TODAY);
    expect(p.startDate).toBe(TODAY);
  });

  it('显式日期优先于今天起算', () => {
    const p = parseTaskInput('每天背单词 明天开始', TODAY);
    expect(p.repeat.repeatType).toBe('daily');
    expect(p.dueDate).toBe('2026-11-15');
    expect(p.startDate).toBe('2026-11-15');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/unit/nlp-rules.test.ts`
Expected: FAIL（重复用例全红）

- [ ] **Step 3: 实现（替换 `parseRepeat` 桩）**

顶部 import 追加：

```ts
import { occursOn } from '@shared/recurrence';
```

新增/替换：

```ts
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
```

并修改 `parseTaskInput` 的组装段（步骤 7 处），补 `startDate`：

```ts
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
```

`return` 语句相应改为：

```ts
  return {
    title, dueDate, timeOfDay: tm.timeOfDay, priority, tags,
    repeat: rep.repeat, source: 'rules',
    startDate,
  };
```

同时给 `ParsedTask` 增加可选字段（`src/shared/parse.ts`）：

```ts
export interface ParsedTask {
  title: string;
  dueDate: string | null;
  timeOfDay: string | null;
  priority: Priority;
  tags: string[];
  repeat: RecurrenceSpec;
  startDate?: string | null; // 重复任务首个发生日；缺省由 parsedToDraft 回退
  source: 'rules' | 'ai';
}
```

`parsedToDraft` 中 `startDate: p.startDate ?? null` 保持不变（已存在）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/unit/nlp-rules.test.ts`
Expected: PASS（含"每周三、五"用例：今天周六，下一个周三为 11-18）

- [ ] **Step 5: 全量测试 + 提交**

```bash
pnpm test
git add src/renderer/src/lib/nlp/rules.ts src/shared/parse.ts tests/unit/nlp-rules.test.ts
git commit -m "feat: recurrence parsing and first-occurrence resolution in rule parser

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: QuickAdd chips 预览 + 窗高（M1 完成）

**Files:**
- Modify: `src/main/windows.ts:12`（`QUICK_H = 120` → `160`）
- Modify: `src/renderer/src/views/QuickAddView.tsx`（解析 chips 行 + placeholder 更新）
- Test: `pnpm test`（回归）+ typecheck + 手动验证

**Interfaces:**
- Consumes: `parseTaskInput`（Task 2-5）、`ParsedTask`（Task 1）
- Produces: 组件内 state `parsed: ParsedTask | null`、`aiBadge: string | null`（Task 11 复用）；chips 渲染函数 `ChipsRow`

- [ ] **Step 1: 调整窗高与 placeholder**

`src/main/windows.ts:12`：

```ts
const QUICK_H = 160;
```

`QuickAddView.tsx` placeholder：

```tsx
placeholder={busy ? '保存中…' : '试试：每周三五下午3点开周会 #工作'}
```

- [ ] **Step 2: QuickAddView 接入解析**

`QuickAddView.tsx` 改造（完整组件逻辑，保留原有 IPC 行为）：

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { todayStr } from '@shared/recurrence';
import { parsedToDraft, type ParsedTask } from '@shared/parse';
import { parseTaskInput } from '@/lib/nlp/rules';

export default function QuickAddView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<ParsedTask | null>(null);
  const [aiBadge, setAiBadge] = useState<string | null>(null); // Task 11 使用

  useEffect(
    () =>
      window.api.onQuickAddFocusInput(() => {
        if (inputRef.current) {
          inputRef.current.value = '';
          inputRef.current.focus();
        }
        setParsed(null);
        setAiBadge(null);
      }),
    [],
  );

  const close = () => window.api.win.closeQuickAdd();

  const currentDraft = (): { title: string; draft: ReturnType<typeof parsedToDraft> } | null => {
    const title = inputRef.current?.value.trim() ?? '';
    if (!title) return null;
    const base = parseTaskInput(title, todayStr(Date.now()));
    // 解析失败兜底（空标题）与现状一致
    const p = parsed ?? base;
    return { title, draft: parsedToDraft({ ...p, title: p.title || title }, Date.now()) };
  };

  const submit = async (openEditor: boolean) => {
    const cur = currentDraft();
    if (!cur || busy) {
      close();
      return;
    }
    setBusy(true);
    try {
      if (openEditor) await window.api.win.openEditor(cur.title);
      else await window.api.todos.create(cur.draft);
      close();
    } catch (e) {
      inputRef.current?.focus();
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const onInput = (e: FormEvent<HTMLInputElement>) => {
    if ((e.nativeEvent as InputEvent).isComposing) return; // IME 组合期间不解析（spec §3.2）；React 19 FormEvent.nativeEvent 类型为 Event，需断言为 InputEvent
    const v = inputRef.current?.value ?? '';
    setParsed(v.trim() ? parseTaskInput(v, todayStr(Date.now())) : null);
    setAiBadge(null);
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <p className="shrink-0 px-6 pt-4 font-mono text-[11px] tracking-[0.18em] text-muted-foreground select-none">
        {todayStr(Date.now())} · 快速添加
      </p>
      <input
        ref={inputRef}
        autoFocus
        className="min-h-0 flex-1 bg-transparent px-6 font-display text-2xl caret-primary outline-none placeholder:text-muted-foreground/50"
        placeholder={busy ? '保存中…' : '试试：每周三五下午3点开周会 #工作'}
        disabled={busy}
        onInput={onInput}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit(e.ctrlKey || e.metaKey);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
      />
      <div className="shrink-0 px-6 pb-1 font-mono text-[11px] text-muted-foreground select-none">
        {chipsOf(parsed, aiBadge)}
      </div>
      <div className="shrink-0 px-6 pb-3 font-mono text-[11px] text-muted-foreground/80 select-none">
        Enter 添加 · Ctrl+Enter 详细编辑 · Esc 关闭
      </div>
      <Toaster position="top-center" richColors />
    </div>
  );
}

function chipsOf(p: ParsedTask | null, ai: string | null): string {
  if (!p || (!p.dueDate && !p.timeOfDay && p.repeat.repeatType === 'none' && p.priority === 1 && p.tags.length === 0)) {
    return '支持：日期 · 时刻 · 重复 · 优先级 · #标签';
  }
  const parts: string[] = [];
  if (p.dueDate) parts.push(`📅 ${p.dueDate}`);
  if (p.timeOfDay) parts.push(`🕒 ${p.timeOfDay}`);
  if (p.repeat.repeatType !== 'none') parts.push(`🔁 ${repeatLabel(p.repeat)}`);
  if (p.priority !== 1) parts.push(p.priority === 2 ? '⚡ 高' : '↓ 低');
  for (const t of p.tags) parts.push(`#${t}`);
  return (ai ? `✨ ${ai} · ` : '') + parts.join(' · ');
}

function repeatLabel(r: ParsedTask['repeat']): string {
  const W = ['日', '一', '二', '三', '四', '五', '六'];
  switch (r.repeatType) {
    case 'daily': return '每天';
    case 'weekly': return `每周 ${(r.repeatWeekdays ?? []).map((d) => W[d]).join('/')}`;
    case 'monthly':
      return r.monthlyMode === 'by_weekday'
        ? `每月第${r.monthlyWhich === 5 ? '最后一个' : r.monthlyWhich}个周${W[r.monthlyWeekday ?? 1]}`
        : `每月${r.monthlyDay}号`;
    case 'custom': return `每${r.repeatInterval}天`;
    default: return '';
  }
}
```

> 注：`submit` 里 `openEditor` 仍传 title（Task 11 扩展为传完整 parsed）；本任务保持 IPC 契约不变。

- [ ] **Step 3: 回归验证**

```bash
pnpm test && pnpm typecheck:web && pnpm typecheck:node
```
Expected: 全绿

- [ ] **Step 4: 手动验证**

Run: `pnpm dev`，全局热键唤起快添窗：
- 输入 `每周三五下午3点开周会 #工作` → chips 显示 `📅 … · 🕒 15:00 · 🔁 每周三/五 · #工作`（repeatLabel 渲染为 `每周 三/五`，带空格，以此为准）
- 输入纯标题 → chips 显示占位提示
- Enter 建任务、Ctrl+Enter 开编辑器、Esc 关窗均正常；窗高 160 且居中

验证后关闭 dev。

- [ ] **Step 5: 提交**

```bash
git add src/main/windows.ts src/renderer/src/views/QuickAddView.tsx
git commit -m "feat: live parse chips preview in quickadd window (M1)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: AI Provider 预设与请求构造（M2 起）

**Files:**
- Create: `src/main/services/ai-providers.ts`
- Test: `tests/unit/ai-providers.test.ts`

**Interfaces:**
- Produces: `AI_PROVIDERS: AiProviderPreset[]`（`{ id, label, baseUrl, defaultModel }`）、`resolveEndpoint(baseUrl): string`、`buildChatBody(input, today, model): string`、`SYSTEM_PROMPT(today): string`（Task 8 消费）

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/ai-providers.test.ts
import { describe, it, expect } from 'vitest';
import { AI_PROVIDERS, resolveEndpoint, buildChatBody, SYSTEM_PROMPT } from '@main/services/ai-providers';
```

> 注意：vitest 别名只有 `@shared` 与 `@`。给 vitest.config.ts 增加主进程别名（本步骤一并做，属任务交付物）：

```ts
// vitest.config.ts resolve.alias 追加
'@main': resolve('src/main'),
```

测试主体：

```ts
describe('AI_PROVIDERS', () => {
  it('四家预设 + custom', () => {
    const ids = AI_PROVIDERS.map((p) => p.id);
    expect(ids).toEqual(['deepseek', 'qwen', 'glm', 'kimi', 'custom']);
    for (const p of AI_PROVIDERS.filter((x) => x.id !== 'custom')) {
      expect(p.baseUrl).toMatch(/^https:\/\//);
      expect(p.defaultModel.length).toBeGreaterThan(0);
    }
  });

  it('resolveEndpoint 拼接 chat/completions 并去尾斜杠', () => {
    expect(resolveEndpoint('https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('buildChatBody：JSON mode、system 含 today 锚点、user 为原文', () => {
    const body = JSON.parse(buildChatBody('明天下午3点开会', '2026-11-14', 'deepseek-chat'));
    expect(body.model).toBe('deepseek-chat');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('2026-11-14');
    expect(body.messages[1].content).toBe('明天下午3点开会');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/unit/ai-providers.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// src/main/services/ai-providers.ts
export interface AiProviderPreset {
  id: 'deepseek' | 'qwen' | 'glm' | 'kimi' | 'custom';
  label: string;
  baseUrl: string;
  defaultModel: string;
}

export const AI_PROVIDERS: AiProviderPreset[] = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  { id: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-turbo' },
  { id: 'glm', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash' },
  { id: 'kimi', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k' },
  { id: 'custom', label: '自定义', baseUrl: '', defaultModel: '' },
];

export const resolveEndpoint = (baseUrl: string): string =>
  baseUrl.replace(/\/+$/, '') + '/chat/completions';

export const SYSTEM_PROMPT = (today: string) => `你是待办事项快速添加的解析器。把用户的一句输入解析为 JSON，字段：
{ "title": string, "dueDate": "YYYY-MM-DD"|null, "timeOfDay": "HH:mm"|null,
  "priority": 0|1|2, "tags": string[],
  "repeat": { "repeatType": "none"|"daily"|"weekly"|"monthly"|"custom",
              "repeatInterval": number|null, "repeatWeekdays": number[]|null,
              "monthlyMode": "by_date"|"by_weekday"|null,
              "monthlyDay": number|null, "monthlyWeekday": number|null, "monthlyWhich": number|null } }

规则：
- today = ${today}。相对日期据此换算为绝对日期；星期几早于 today 则取下一个。
- repeatWeekdays 数字含义：0=周日,1=周一…6=周六。
- priority：明确"紧急/高优先"为 2，"不急/低优先"为 0，否则 1。
- 无法确定的字段一律 null 或缺省；title 必须保留原意（剥离日期/时刻/标签词后自然成句）。
- 只输出 JSON，不要解释。

示例一：
输入："明天下午3点交报告 紧急 #工作"（today = ${today}）
输出：{"title":"交报告","dueDate":"2026-11-15","timeOfDay":"15:00","priority":2,"tags":["工作"],"repeat":{"repeatType":"none","repeatInterval":null,"repeatWeekdays":null,"monthlyMode":null,"monthlyDay":null,"monthlyWeekday":null,"monthlyWhich":null}}

示例二：
输入："记得每天遛狗"（today = ${today}）
输出：{"title":"遛狗","dueDate":"${today}","timeOfDay":null,"priority":1,"tags":[],"repeat":{"repeatType":"daily","repeatInterval":null,"repeatWeekdays":null,"monthlyMode":null,"monthlyDay":null,"monthlyWeekday":null,"monthlyWhich":null}}

示例三：
输入："每周三五下午3点开周会"（today = ${today}）
输出：{"title":"开周会","dueDate":null,"timeOfDay":"15:00","priority":1,"tags":[],"repeat":{"repeatType":"weekly","repeatInterval":null,"repeatWeekdays":[3,5],"monthlyMode":null,"monthlyDay":null,"monthlyWeekday":null,"monthlyWhich":null}}

注意：示例中的绝对日期仅适用于 today = ${today}；实际输出必须按真实 today 换算。`;

export function buildChatBody(input: string, today: string, model: string): string {
  return JSON.stringify({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT(today) },
      { role: 'user', content: input },
    ],
    temperature: 0,
    max_tokens: 512,
    response_format: { type: 'json_object' },
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/unit/ai-providers.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
pnpm test
git add src/main/services/ai-providers.ts tests/unit/ai-providers.test.ts vitest.config.ts
git commit -m "feat: AI provider presets and chat request builder

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: AiParser 服务核心（校验/超时/缓存）

**Files:**
- Create: `src/main/services/ai-parser.ts`
- Test: `tests/integration/ai-parser.test.ts`

**Interfaces:**
- Consumes: `ParsedTask`（`@shared/parse`）、Task 7 的 `resolveEndpoint/buildChatBody`、`IpcError`（`@shared/ipc`）
- Produces: `interface AiConfig { baseUrl: string; model: string; apiKey: string }`、`class AiParser { parse(input, today, cfg): Promise<ParsedTask>; testConnection(cfg): Promise<void> }`、`validateParsed(raw: unknown, today: string): ParsedTask | null`（Task 9 的 IPC handler 消费）

- [ ] **Step 1: 写失败测试（mock fetch）**

```ts
// tests/integration/ai-parser.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AiParser, validateParsed, type AiConfig } from '@main/services/ai-parser';

const CFG: AiConfig = { baseUrl: 'https://api.test/v1', model: 'test-model', apiKey: 'sk-test' };
const TODAY = '2026-11-14';
const okAiJson = JSON.stringify({
  title: '开周会', dueDate: '2026-11-18', timeOfDay: '15:00', priority: 1,
  tags: ['工作'],
  repeat: { repeatType: 'weekly', repeatInterval: null, repeatWeekdays: [3, 5], monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null },
});

const fetchJson = (content: string, status = 200) =>
  vi.fn(async () => ({ ok: status < 400, status, json: async () => ({ choices: [{ message: { content } }] }) }) as unknown as Response);

describe('validateParsed', () => {
  it('合法输出通过', () => {
    const p = validateParsed(JSON.parse(okAiJson), TODAY);
    expect(p?.title).toBe('开周会');
    expect(p?.repeat.repeatWeekdays).toEqual([3, 5]);
    expect(p?.source).toBe('ai');
  });

  it('空标题 / 非法日期 / 越界枚举 → null 或 clamp', () => {
    expect(validateParsed({ title: '' }, TODAY)).toBeNull();
    expect(validateParsed({ title: 'x', dueDate: '2026/11/20' }, TODAY)).toBeNull();
    const p = validateParsed({ title: 'x', priority: 9 }, TODAY);
    expect(p?.priority).toBe(1); // 越界 clamp 回缺省
    const w = validateParsed({ title: 'x', repeat: { repeatType: 'weekly', repeatWeekdays: [9, 3] } }, TODAY);
    expect(w?.repeat.repeatWeekdays).toEqual([3]); // 非法星期被剔除
  });
});

describe('AiParser.parse', () => {
  it('正常路径：请求头/端点正确，返回 ParsedTask', async () => {
    const f = fetchJson(okAiJson);
    const ai = new AiParser(f as unknown as typeof fetch);
    const p = await ai.parse('每周三五下午3点开周会', TODAY, CFG);
    expect(p.title).toBe('开周会');
    const [url, init] = (f as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.test/v1/chat/completions');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer sk-test' });
  });

  it('401 → AI_AUTH 错误；非法 JSON → AI_BAD_OUTPUT', async () => {
    const ai401 = new AiParser(fetchJson('x', 401) as unknown as typeof fetch);
    await expect(ai401.parse('x', TODAY, CFG)).rejects.toMatchObject({ code: 'AI_AUTH' });
    const aiBad = new AiParser(fetchJson('不是JSON') as unknown as typeof fetch);
    await expect(aiBad.parse('x', TODAY, CFG)).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT' });
  });

  it('超时 3s abort → AI_TIMEOUT', async () => {
    const f = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    const ai = new AiParser(f as unknown as typeof fetch);
    await expect(ai.parse('x', TODAY, CFG)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  }, 10_000);

  it('相同输入 60s 内命中缓存（fetch 只调一次）', async () => {
    const f = fetchJson(okAiJson);
    const ai = new AiParser(f as unknown as typeof fetch);
    await ai.parse('每周三五下午3点开周会', TODAY, CFG);
    await ai.parse('每周三五下午3点开周会', TODAY, CFG);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('AiParser.testConnection', () => {
  it('成功不抛错；401 抛 AI_AUTH', async () => {
    const ok1 = new AiParser(fetchJson('{"title":"t"}') as unknown as typeof fetch);
    await expect(ok1.testConnection(CFG)).resolves.toBeUndefined();
    const bad = new AiParser(fetchJson('x', 401) as unknown as typeof fetch);
    await expect(bad.testConnection(CFG)).rejects.toMatchObject({ code: 'AI_AUTH' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/integration/ai-parser.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
// src/main/services/ai-parser.ts
import { IpcError } from '@shared/ipc';
import { emptyRepeat, type ParsedTask } from '@shared/parse';
import type { Priority, RepeatType } from '@shared/types';
import { buildChatBody, resolveEndpoint } from './ai-providers';

export interface AiConfig { baseUrl: string; model: string; apiKey: string }
export type FetchLike = typeof fetch;

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const REPEAT_TYPES: RepeatType[] = ['none', 'daily', 'weekly', 'monthly', 'custom'];
const CACHE_TTL = 60_000;
const CACHE_MAX = 20;
const TIMEOUT_MS = 3000;

const asInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

/** 严格白名单校验；非法整体返回 null（上层保留规则结果） */
export function validateParsed(raw: unknown, _today: string): ParsedTask | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  if (!title) return null;

  const dueDate = typeof o.dueDate === 'string' && RE_DATE.test(o.dueDate) ? o.dueDate : null;
  const timeOfDay = typeof o.timeOfDay === 'string' && RE_TIME.test(o.timeOfDay) ? o.timeOfDay : null;
  const prioRaw = asInt(o.priority);
  const priority: Priority = prioRaw === 0 || prioRaw === 2 ? prioRaw : 1;

  const tags = Array.isArray(o.tags)
    ? [...new Set(o.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim()))]
    : [];

  const r = (typeof o.repeat === 'object' && o.repeat !== null ? o.repeat : {}) as Record<string, unknown>;
  const repeatType = REPEAT_TYPES.includes(r.repeatType as RepeatType) ? (r.repeatType as RepeatType) : 'none';
  const weekdays = Array.isArray(r.repeatWeekdays)
    ? [...new Set(r.repeatWeekdays.filter((n) => asInt(n) !== null && (n as number) >= 0 && (n as number) <= 6).map((n) => n as number))].sort((a, b) => a - b)
    : null;
  const repeat = {
    ...emptyRepeat(), repeatType,
    repeatInterval: repeatType === 'custom' ? Math.max(2, asInt(r.repeatInterval) ?? 2) : null,
    repeatWeekdays: repeatType === 'weekly' ? (weekdays && weekdays.length > 0 ? weekdays : null) : null,
    monthlyMode: r.monthlyMode === 'by_date' || r.monthlyMode === 'by_weekday' ? r.monthlyMode : null,
    monthlyDay: repeatType === 'monthly' && asInt(r.monthlyDay) !== null ? asInt(r.monthlyDay) : null,
    monthlyWeekday: asInt(r.monthlyWeekday) !== null ? asInt(r.monthlyWeekday) : null,
    monthlyWhich: asInt(r.monthlyWhich) !== null ? asInt(r.monthlyWhich) : null,
  };

  return { title, dueDate, timeOfDay, priority, tags, repeat, source: 'ai' };
}

const safeJsonParse = (s: string): unknown => {
  try { return JSON.parse(s); } catch { return undefined; }
};

export class AiParser {
  private cache = new Map<string, { at: number; task: ParsedTask }>();

  constructor(private fetchImpl: FetchLike = fetch) {}

  async parse(input: string, today: string, cfg: AiConfig): Promise<ParsedTask> {
    const ck = `${cfg.model}:${input}`;
    const hit = this.cache.get(ck);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.task;

    let res: Response;
    try {
      res = await this.doFetch(input, today, cfg, false);
    } catch (e) {
      throw this.wrapNetworkError(e);
    }
    if (res.status === 401 || res.status === 403) throw new IpcError('AI_AUTH', 'API Key 无效或无权限');
    if (!res.ok) throw new IpcError('AI_HTTP', `模型服务返回 HTTP ${res.status}`);

    let content = '';
    try {
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      content = data.choices?.[0]?.message?.content ?? '';
    } catch {
      throw new IpcError('AI_BAD_OUTPUT', '模型返回格式无法解析');
    }
    const task = validateParsed(safeJsonParse(content), today);
    if (!task) throw new IpcError('AI_BAD_OUTPUT', '模型返回内容不符合约定结构');

    this.cache.set(ck, { at: Date.now(), task });
    if (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return task;
  }

  async testConnection(cfg: AiConfig): Promise<void> {
    let res: Response;
    try {
      res = await this.doFetch('测试连接', '2026-01-01', cfg, true);
    } catch (e) {
      throw this.wrapNetworkError(e);
    }
    if (res.status === 401 || res.status === 403) throw new IpcError('AI_AUTH', 'API Key 无效或无权限');
    if (!res.ok) throw new IpcError('AI_HTTP', `模型服务返回 HTTP ${res.status}`);
  }

  private doFetch(input: string, today: string, cfg: AiConfig, minimal: boolean): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const body = minimal
      ? JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8, response_format: { type: 'json_object' } })
      : buildChatBody(input, today, cfg.model);
    return this.fetchImpl(resolveEndpoint(cfg.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body,
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
  }

  private wrapNetworkError(e: unknown): Error {
    if (e instanceof IpcError) return e;
    if (e instanceof DOMException && e.name === 'AbortError') return new IpcError('AI_TIMEOUT', '模型服务响应超时');
    return new IpcError('AI_NETWORK', '无法连接模型服务');
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/integration/ai-parser.test.ts`
Expected: PASS

- [ ] **Step 5: 全量测试 + 提交**

```bash
pnpm test
git add src/main/services/ai-parser.ts tests/integration/ai-parser.test.ts
git commit -m "feat: AiParser service with strict validation, timeout and LRU cache

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: Key 存储（safeStorage）+ IPC 通道 + preload 桥

**Files:**
- Create: `src/main/services/ai-key-store.ts`
- Modify: `src/shared/ipc.ts`（Ipc 常量、Api.ai、ShowMainPayload）
- Modify: `src/main/ipc.ts`（IpcDeps + handler 注册）
- Modify: `src/preload/index.ts`（api.ai 桥）
- Modify: `src/main/index.ts`（构造与接线）
- Test: `tests/unit/ai-key-store.test.ts`

**Interfaces:**
- Consumes: `AiParser/AiConfig`（Task 8）、`AI_PROVIDERS`（Task 7）、`safeStorage`（electron）
- Produces:
  - `Ipc.AiParse = 'ai:parse'`、`Ipc.AiSetKey = 'ai:set-key'`、`Ipc.AiKeyHint = 'ai:key-hint'`、`Ipc.AiTestConnection = 'ai:test-connection'`
  - `Api.ai: { parse(input, today): Promise<ParsedTask>; setKey(key): Promise<void>; keyHint(): Promise<string | null>; testConnection(): Promise<void> }`
  - `encryptKey/decryptKey/keyHintOf(plain): string`（`encryptKey(plain, safe): string`；`safe: SafeStorageLike` 注入便于测试）
  - main 侧装配：`loadAiConfig(settingsDao, safe): AiConfig | null`（Task 10 的"测试连接"与 parse handler 共用）

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/ai-key-store.test.ts
import { describe, it, expect } from 'vitest';
import { encryptKey, decryptKey, keyHintOf, type SafeStorageLike } from '@main/services/ai-key-store';
import { IpcError } from '@shared/ipc';

const fakeSafe = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s: string) => Buffer.from(`enc:${s}`),
  decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
});

describe('ai-key-store', () => {
  it('加密→解密往返', () => {
    const safe = fakeSafe();
    const enc = encryptKey('sk-abc123', safe);
    expect(enc).not.toContain('sk-abc123');
    expect(decryptKey(enc, safe)).toBe('sk-abc123');
  });

  it('safeStorage 不可用 → AI_NO_KEYRING', () => {
    expect(() => encryptKey('x', fakeSafe(false))).toThrow(IpcError);
    try {
      encryptKey('x', fakeSafe(false));
    } catch (e) {
      expect((e as IpcError).code).toBe('AI_NO_KEYRING');
    }
  });

  it('keyHint 只留尾 4 位', () => {
    expect(keyHintOf('sk-abcdefghijkl')).toBe('…ijkl');
    expect(keyHintOf('ab')).toBe('…ab');
    expect(keyHintOf('')).toBe('');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/unit/ai-key-store.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 key-store**

```ts
// src/main/services/ai-key-store.ts
import { IpcError } from '@shared/ipc';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export function encryptKey(plain: string, safe: SafeStorageLike): string {
  if (!safe.isEncryptionAvailable()) {
    throw new IpcError('AI_NO_KEYRING', '系统安全存储不可用，无法保存 API Key');
  }
  return safe.encryptString(plain).toString('base64');
}

export function decryptKey(enc: string, safe: SafeStorageLike): string {
  return safe.decryptString(Buffer.from(enc, 'base64'));
}

export function keyHintOf(plain: string): string {
  if (!plain) return '';
  return `…${plain.slice(-4)}`;
}
```

- [ ] **Step 4: IPC 契约扩展（shared/ipc.ts）**

`Ipc` 常量表追加：

```ts
  AiParse: 'ai:parse',
  AiSetKey: 'ai:set-key',
  AiKeyHint: 'ai:key-hint',
  AiTestConnection: 'ai:test-connection',
```

`Api` 接口追加（`stats` 块之前）：

```ts
  ai: {
    parse(input: string, today: string): Promise<ParsedTask>;
    setKey(key: string): Promise<void>;
    keyHint(): Promise<string | null>;
    testConnection(): Promise<void>;
  };
```

文件顶部 import 追加 `type ParsedTask`。

`ShowMainPayload` 中 `quickAddDraft` 类型改为对象（Task 11 消费；本任务一并定稿契约）：

```ts
export interface QuickAddDraftPayload {
  title: string;
  parsed: ParsedTask | null;
}
// ShowMainPayload 内：
quickAddDraft?: QuickAddDraftPayload;
```

- [ ] **Step 5: main 侧服务与 handler 接线**

`src/main/services/ai-settings.ts`（配置装配，供 parse 与 testConnection 共用）：

```ts
// src/main/services/ai-settings.ts
import type { SettingsDao } from '../db/dao';
import { IpcError } from '@shared/ipc';
import type { AiConfig } from './ai-parser';
import { AI_PROVIDERS } from './ai-providers';
import { decryptKey, type SafeStorageLike } from './ai-key-store';

export function loadAiConfig(settingsDao: SettingsDao, safe: SafeStorageLike): AiConfig {
  const enabled = settingsDao.get<boolean>('ai_enabled') ?? false;
  if (!enabled) throw new IpcError('AI_DISABLED', '智能快添未启用');
  const id = settingsDao.get<string>('ai_provider') ?? '';
  const preset = AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];
  const baseUrl = (preset.id === 'custom' ? settingsDao.get<string>('ai_base_url') : preset.baseUrl) ?? '';
  const model = settingsDao.get<string>('ai_model') || preset.defaultModel;
  const enc = settingsDao.get<string>('ai_key_enc');
  if (!baseUrl || !model || !enc) throw new IpcError('AI_NOT_CONFIGURED', '请先在设置中完成模型配置');
  return { baseUrl, model, apiKey: decryptKey(enc, safe) };
}
```

`src/main/ipc.ts`：

- `IpcDeps` 追加字段：`aiParser: AiParser; safeStorage: SafeStorageLike;`
- `registerIpc` 内注册：

```ts
  wrap(Ipc.AiParse, (input: string, today: string) =>
    aiParser.parse(String(input), String(today), loadAiConfig(settingsDao, safeStorage)));
  wrap(Ipc.AiSetKey, (key: string) => {
    settingsDao.set('ai_key_enc', encryptKey(String(key), safeStorage));
  });
  wrap(Ipc.AiKeyHint, () => {
    const enc = settingsDao.get<string>('ai_key_enc');
    if (!enc) return null;
    return keyHintOf(decryptKey(enc, safeStorage));
  });
  wrap(Ipc.AiTestConnection, () => aiParser.testConnection(loadAiConfig(settingsDao, safeStorage)));
```

- 顶部 import：`import { AiParser } from './services/ai-parser'; import { loadAiConfig } from './services/ai-settings'; import { encryptKey, decryptKey, keyHintOf, type SafeStorageLike } from './services/ai-key-store';`（`ParsedTask` 类型 Task 11 改 `openEditorFromQuickAdd` 签名时再引入）

`src/main/index.ts`（`registerIpc({...})` 调用处）：

```ts
import { AiParser } from './services/ai-parser';
import { safeStorage } from 'electron';
// registerIpc deps 内追加：
    aiParser: new AiParser(),
    safeStorage,
```

- [ ] **Step 6: preload 桥（src/preload/index.ts）**

`api` 对象内追加（`stats` 之前）：

```ts
  ai: {
    parse: (input: string, today: string) => call(Ipc.AiParse, input, today),
    setKey: (key: string) => call(Ipc.AiSetKey, key),
    keyHint: () => call(Ipc.AiKeyHint),
    testConnection: () => call(Ipc.AiTestConnection),
  },
```

- [ ] **Step 7: 编译与回归**

```bash
pnpm test && pnpm typecheck:node
```
Expected: 全绿（`ShowMainPayload.quickAddDraft` 类型变化会影响 `MainShell.tsx` 消费处——本步骤先修复编译：`p.quickAddDraft` 改为对象用法，`draftTitle: p.quickAddDraft.title`，`parsed` 字段 Task 11 再接）

- [ ] **Step 8: 提交**

```bash
git add src/main/services/ai-key-store.ts src/main/services/ai-settings.ts src/shared/ipc.ts src/main/ipc.ts src/preload/index.ts src/main/index.ts src/renderer/src/views/MainShell.tsx tests/unit/ai-key-store.test.ts
git commit -m "feat: AI IPC channels, safeStorage key store and preload bridge

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: 设置页「智能快添」区块

**Files:**
- Modify: `src/renderer/src/views/SettingsView.tsx`（新增 Card 区块）

**Interfaces:**
- Consumes: `useSettings`、`window.api.ai.*`（Task 9）、`AI_PROVIDERS`（经渲染层副本引入：直接 `import { AI_PROVIDERS } from '@main/services/ai-providers'` 在渲染层不可用——改为把 `AI_PROVIDERS` 移到 `src/shared/ai-providers.ts`，`src/main/services/ai-providers.ts` re-export，渲染层从 `@shared/ai-providers` 引入）

**Interfaces（修正后）:**
- Task 7 交付物调整：预设表位于 `src/shared/ai-providers.ts`（纯数据+纯函数，主进程可用），`src/main/services/ai-providers.ts` 仅 `export * from '@shared/ai-providers'`（保持 Task 7/8 测试 import 路径不变）

- [ ] **Step 1: 迁移预设表到 shared**

创建 `src/shared/ai-providers.ts`：把 Task 7 的 `AiProviderPreset/AI_PROVIDERS/resolveEndpoint/SYSTEM_PROMPT/buildChatBody` 全部移入（内容不变）。
`src/main/services/ai-providers.ts` 改为一行：

```ts
export * from '@shared/ai-providers';
```

- [ ] **Step 2: SettingsView 新增区块（状态与 JSX）**

状态（组件内其他 useState 之后）：

```tsx
  // 智能快添（AI）
  const [aiEnabled, setAiEnabled] = useSettings<boolean>('ai_enabled', false);
  const [aiProvider, setAiProvider] = useSettings<string>('ai_provider', 'deepseek');
  const [aiModel, setAiModel] = useSettings<string>('ai_model', '');
  const [aiBaseUrl, setAiBaseUrl] = useSettings<string>('ai_base_url', '');
  const [keyInput, setKeyInput] = useState('');
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    void window.api.ai.keyHint().then(setKeyHint);
  }, []);

  const preset = AI_PROVIDERS.find((p) => p.id === aiProvider) ?? AI_PROVIDERS[0];
  const effectiveModel = aiModel || preset.defaultModel;

  const saveKey = async () => {
    try {
      await window.api.ai.setKey(keyInput.trim());
      setKeyInput('');
      setKeyHint(await window.api.ai.keyHint());
      toast.success('API Key 已加密保存');
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    }
  };

  const testConn = async () => {
    setTesting(true);
    try {
      await window.api.ai.testConnection();
      toast.success('连接成功');
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      setTesting(false);
    }
  };
```

JSX（通知 Card 之后插入同构 Card）：

```tsx
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">智能快添 {aiEnabledBadge}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              启用后，快添窗输入文本将发送至所选模型服务商；未启用时本地规则解析仍然可用。
            </p>
            <div className="flex items-center justify-between">
              <span>启用 AI 增强</span>
              <Switch checked={aiEnabled ?? false} onCheckedChange={(v) => void setAiEnabled(v)} />
            </div>
            <div className="grid gap-2">
              <span className="text-sm">服务商</span>
              <Select value={aiProvider} onValueChange={(v) => { void setAiProvider(v); void setAiModel(''); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AI_PROVIDERS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <span className="text-sm">模型名（留空用默认 {preset.defaultModel || '—'}）</span>
              <Input value={aiModel} onChange={(e) => void setAiModel(e.target.value)} placeholder={preset.defaultModel || '模型名'} />
            </div>
            {aiProvider === 'custom' && (
              <div className="grid gap-2">
                <span className="text-sm">Base URL（OpenAI 兼容）</span>
                <Input value={aiBaseUrl} onChange={(e) => void setAiBaseUrl(e.target.value)} placeholder="https://example.com/v1" />
              </div>
            )}
            <div className="grid gap-2">
              <span className="text-sm">API Key {keyHint ? `（已保存 ${keyHint}）` : '（未保存）'}</span>
              <div className="flex gap-2">
                <Input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="sk-…" />
                <Button variant="outline" disabled={!keyInput.trim()} onClick={() => void saveKey()}>保存</Button>
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" disabled={testing} onClick={() => void testConn()}>
                {testing ? '测试中…' : '测试连接'}
              </Button>
            </div>
          </CardContent>
        </Card>
```

`aiEnabledBadge`（简单徽章，可选）：`aiEnabled ? <Badge>开</Badge> : null`。
顶部 import 追加：`import { Input } from '@/components/ui/input'; import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'; import { AI_PROVIDERS } from '@shared/ai-providers';`

- [ ] **Step 3: 回归验证**

```bash
pnpm test && pnpm typecheck:web && pnpm typecheck:node
```
Expected: 全绿

- [ ] **Step 4: 手动验证**

Run: `pnpm dev` → 设置页：
- 开关/服务商切换/模型名/Key 保存（尾 4 位回显）/测试连接（配一个真实 Key 验证 401 与成功两态）
- 关闭 dev。

- [ ] **Step 5: 提交**

```bash
git add src/shared/ai-providers.ts src/main/services/ai-providers.ts src/renderer/src/views/SettingsView.tsx
git commit -m "feat: smart quickadd settings section with provider presets and key management

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: QuickAdd AI 增强交互 + 编辑器全字段预填

**Files:**
- Modify: `src/renderer/src/views/QuickAddView.tsx`（debounce 调用 + 徽章 + submit 携带 parsed）
- Modify: `src/renderer/src/components/editor-state.ts`（`EditorState.parsed?: ParsedTask`）
- Modify: `src/renderer/src/views/MainShell.tsx`（`quickAddDraft` 对象消费）
- Modify: `src/renderer/src/components/TaskEditDialog.tsx`（预填应用）
- Modify: `src/shared/ipc.ts` 已在 Task 9 定稿契约（无新改动）
- Modify: `src/main/windows.ts`（`openEditorFromQuickAdd` 签名）
- Modify: `src/main/ipc.ts`（`WindowOps.openEditorFromQuickAdd` 签名）
- Test: 回归 + typecheck + 手动

**Interfaces:**
- Consumes: `window.api.ai.parse`、`ShowMainPayload.quickAddDraft: { title; parsed }`、`parsedToDraft`
- Produces: `EditorState.parsed?: ParsedTask`（后续日历 Sheet 预填可复用）

- [ ] **Step 1: windows/ipc 签名调整**

`src/main/ipc.ts` 的 `WindowOps`：

```ts
  openEditorFromQuickAdd(draft: { title: string; parsed: ParsedTask | null }): void;
```

`WinOpenEditor` handler：

```ts
  wrap(Ipc.WinOpenEditor, (d: { title: string; parsed: ParsedTask | null }) => windows.openEditorFromQuickAdd(d));
```

`src/main/windows.ts`：

```ts
  openEditorFromQuickAdd(draft: { title: string; parsed: ParsedTask | null }): void {
    this.showMain({ quickAddDraft: draft });
    this.quickAdd?.hide();
  }
```

（`shared/ipc.ts` 的 `Api.win.openEditor` 签名同步：`openEditor(draft: { title: string; parsed: ParsedTask | null }): Promise<void>`；preload 透传不变。）

- [ ] **Step 2: QuickAddView AI 增强逻辑**

在 Task 6 基础上（组件内追加；顶部 import 追加 `import { AI_PROVIDERS } from '@shared/ai-providers';`）：

```tsx
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const failToastedRef = useRef(false);
  const providerLabelRef = useRef('AI');

  // 快添窗每次唤起刷新 provider label（徽章文案，spec §6）
  useEffect(
    () =>
      window.api.onQuickAddFocusInput(() => {
        void window.api.settings.get<string>('ai_provider').then((id) => {
          providerLabelRef.current =
            AI_PROVIDERS.find((p) => p.id === id)?.label ?? 'AI';
        });
      }),
    [],
  );

  const scheduleAi = () => {
    const v = inputRef.current?.value ?? '';
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    const seq = ++seqRef.current;
    if (!v.trim()) return;
    aiTimerRef.current = setTimeout(() => {
      void window.api.ai
        .parse(v, todayStr(Date.now()))
        .then((t) => {
          if (seqRef.current === seq) {
            setParsed(t);
            setAiBadge(providerLabelRef.current);
          }
        })
        .catch(() => {
          // 静默降级：保留规则结果；每次会话首败提示一次
          if (!failToastedRef.current) {
            failToastedRef.current = true;
            toast.info('AI 增强暂不可用，已使用本地解析');
          }
        });
    }, 400);
  };

  // onInput 末尾追加 scheduleAi();
```

`submit` 的 openEditor 分支改为：

```tsx
      if (openEditor) await window.api.win.openEditor({ title: cur.title, parsed: parsed ?? null });
```

- [ ] **Step 3: EditorState + MainShell + TaskEditDialog 预填**

`editor-state.ts`：

```ts
import type { Todo } from '@shared/types';
import type { ParsedTask } from '@shared/parse';

export interface EditorState {
  open: boolean;
  todo?: Todo;
  dueDate?: string;
  draftTitle?: string;
  parsed?: ParsedTask;  // 快添窗 Ctrl+Enter 全字段预填
  focusTodoId?: number;
  focusDate?: string;
}
```

`MainShell.tsx` 的 `onShowMain` 处理：

```tsx
      if (p.quickAddDraft) {
        setNav('today');
        setEditor({ open: true, draftTitle: p.quickAddDraft.title, parsed: p.quickAddDraft.parsed ?? undefined });
      } else if (p.focusTodo) {
```

`TaskEditDialog.tsx` 的预填行（原 `setDraft(state.draftTitle ? { ...base, title: state.draftTitle } : base);`）：

```tsx
    setDraft(
      state.draftTitle
        ? { ...base, title: state.draftTitle, ...(state.parsed ? parsedToDraft(state.parsed, Date.now()) : {}) }
        : base,
    );
```

顶部 import：`import { parsedToDraft } from '@shared/parse';`

- [ ] **Step 4: 回归与手动验证**

```bash
pnpm test && pnpm typecheck:web && pnpm typecheck:node
```

手动（需真实 Key，Task 10 已配好）：
- 输入 `下下周三之前把季度报告交了 高优先级` → 停顿后 chips 替换并显示 `✨ AI`
- AI 期间立即 Enter → 用规则结果秒建
- 断网/错 Key → 首败 toast 一次，规则结果保留
- Ctrl+Enter → 编辑器打开且日期/时刻/优先级/标签全部预填

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/views/QuickAddView.tsx src/renderer/src/components/editor-state.ts src/renderer/src/views/MainShell.tsx src/renderer/src/components/TaskEditDialog.tsx src/main/windows.ts src/main/ipc.ts src/shared/ipc.ts src/preload/index.ts
git commit -m "feat: AI-enhanced quickadd with debounce, badge and full editor prefill (M2)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 12: 收尾验证

**Files:** 无新改动

- [ ] **Step 1: 全量回归**

```bash
pnpm test && pnpm typecheck && pnpm build
```
Expected: 全绿、构建成功。另核对 spec §8 承诺：`tests/unit/nlp-rules.test.ts` 用例数 ≥40（含混合输入与歧义用例）；不足则补齐后再继续。

- [ ] **Step 2: 端到端手动走查**

Run: `pnpm dev`，按 spec §6/§7 走查：
1. 未启用 AI：chips 即时预览、Enter 秒建（回归 M1 行为）
2. 启用 AI + 有效 Key：模糊表述（"记得每天遛狗"）→ AI 徽章替换
3. 错 Key/断网：静默降级 + 首败 toast
4. 设置页测试连接、Key 尾位回显

- [ ] **Step 3: 汇报**

向用户汇报：测试数、走查结果、遗留事项（如 provider 某家 JSON mode 兼容性问题）。
