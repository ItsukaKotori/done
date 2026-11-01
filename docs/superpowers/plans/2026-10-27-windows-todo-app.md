# Windows 桌面 Todo App 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一款常驻系统托盘、支持周期任务 / 应用内日历 / 系统通知提醒 / 全局热键快速添加的 Windows 桌面 Todo 应用。

**Architecture:** Electron 主进程独占 SQLite 并实现所有业务计算（CRUD + 重复展开 + 提醒调度 + 托盘/自启/快捷键），渲染进程（React + shadcn/ui）通过 preload 类型化 IPC 获取"扁平化的发生日条目"（OccurrenceItem），UI 不实现任何重复规则逻辑。

**Tech Stack:** electron-vite · TypeScript · React 19 · Tailwind CSS v4 · shadcn/ui · better-sqlite3 · electron-log · electron-builder（NSIS x64）· Vitest

**Spec:** [docs/superpowers/specs/2026-10-27-windows-todo-app-design.md](../specs/2026-10-27-windows-todo-app-design.md) —— 执行每个任务前先读规格对应章节；规格 §10 决策表为最终裁定。

## Global Constraints

- 平台仅 Windows x64；Node ≥ 20；包管理 npm。
- 安全基线：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；渲染进程只能通过 `window.api` 通信。
- 日期字符串一律本地 `YYYY-MM-DD`；时刻 `HH:mm`；时间戳 Unix 毫秒。
- 应用数据目录 `%APPDATA%\whchem-todo\`（`todo.db`、`logs/`）；包名 `whchem-todo`、productName `WhchemTodo`。
- 明确不做（YAGNI）：自然语言解析、云同步、系统日历/ICS 同步、渲染层 e2e、代码签名、自动更新、关窗即退出选项。
- IPC 返回一律 `R<T>` 信封：`{ ok: true; data } | { ok: false; code; message }`。
- `src/shared/ipc.ts` 是通道名与类型的唯一真相源。除规格 §4 表格外，实现补充内部通道：`notify:test`、`settings:autostart-get`、`autostart:set`、`hotkey:set`、`win:*`、`event:*`、`todos:list-all`。
- 快捷键默认 `Ctrl+Alt+A`；主题默认 `system`；优先级默认 1（中）。
- **better-sqlite3 ABI（实施时裁定更新）**：better-sqlite3@13 起随包携带 N-API 预编译（prebuildify），Node 与 Electron 双运行时通用，**无需 ABI 切换**；`db:node`/`db:electron` 脚本保留为无害兼容项，`test`/`build:win` 不再调用：
  - `"test": "vitest run"`、`"test:unit": "vitest run tests/unit"`
  - `"db:node": "npm rebuild better-sqlite3"`、`"db:electron": "electron-rebuild -f -w better-sqlite3"`（仅历史兼容）
- 提交遵循 Conventional Commits；每个任务结尾必须 commit。

## 文件结构（实现完成后的布局）

```
src/
├── shared/                 # 主/渲染共用（纯 TS，无 Electron/Node API）
│   ├── types.ts            领域类型 + R<T> 信封
│   ├── ipc.ts              Ipc 通道常量 + Api 接口
│   └── recurrence.ts       纯函数重复展开引擎（最高风险点，独立测试）
├── main/
│   ├── index.ts            生命周期装配：单实例/异常兜底/服务接线
│   ├── ipc.ts              ipcMain.handle 注册（全部 handler）
│   ├── windows.ts          AppWindowController（主窗+快添窗）+ TrayManager
│   ├── shortcuts.ts        globalShortcut 注册管理
│   ├── notify.ts           Notification 构造/汇总/权限探测
│   ├── db/
│   │   ├── schema.ts       SQL 迁移定义
│   │   ├── index.ts        openDb：integrity 检测 + 损坏恢复 + 迁移
│   │   └── dao.ts          TodoDao / OccurrenceDao / ReminderDao / SettingsDao
│   └── services/
│       ├── todo-service.ts CRUD + 虚拟展开 → OccurrenceItem[]
│       └── scheduler.ts    单指针 setTimeout 调度 + snooze/pause
├── preload/index.ts        contextBridge 暴露 window.api
└── renderer/src/
    ├── App.tsx             ?win=quickadd 路由分叉
    ├── index.css           Tailwind v4 + shadcn CSS 变量
    ├── lib/{utils,ipc,theme}.ts
    ├── hooks/{useDataVersion,useTodos,useSettings}.ts
    ├── components/
    │   ├── ui/*            shadcn 生成
    │   ├── Titlebar.tsx / Sidebar.tsx / TaskItem.tsx / VirtualList.tsx
    │   ├── TaskEditDialog.tsx / RepeatField.tsx
    │   └── calendar/{MonthCalendar,DayPanel}.tsx
    └── views/{MainShell,TodayView,CalendarView,AllTasksView,SettingsView,QuickAddView}.tsx
tests/
├── unit/{recurrence,scheduler}.test.ts        # 纯逻辑，无原生依赖
└── integration/{dao,todo-service}.test.ts     # :memory: SQLite（需 db:node）
resources/icon.png          托盘/通知图标源图
scripts/make-icon.mjs       png → ico 生成
electron-builder.yml
```

模块依赖方向（不允许反向）：`renderer → shared`、`preload → shared`、`main → shared`；`main/services → main/db`；UI 视图 → hooks → window.api。

---

## Task 1: 脚手架（electron-vite + Tailwind v4 + shadcn/ui + Vitest）

**Files:**
- Create: 项目根配置（package.json、tsconfig*.json、electron.vite.config.ts、components.json、vitest.config.ts）
- Create: `src/main/index.ts`、`src/preload/index.ts`、`src/renderer/**`（模板生成）

**Interfaces:**
- Produces: 可 `npm run dev` 弹窗口、可 `npm run build`、可 `npm run test`（暂无测试文件）

- [ ] **Step 1: 在临时子目录 scaffold 后移动到根**

工作目录已有 `docs/`，脚手架拒绝非空目录：

```powershell
npm create @quick-start/electron@latest scaffold -- --template react-ts
Get-ChildItem scaffold -Force | Move-Item -Destination . -Force
Remove-Item scaffold
```

- [ ] **Step 2: 安装依赖**

```powershell
npm install
npm install better-sqlite3 electron-log
npm install -D @electron/rebuild tailwindcss @tailwindcss/vite vitest png-to-ico electron-builder
```

- [ ] **Step 3: 配置 Tailwind v4（Vite 插件方式）+ 路径别名**

覆写 `electron.vite.config.ts`：

```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: { resolve: { alias: { '@shared': resolve('src/shared') } } },
  preload: { resolve: { alias: { '@shared': resolve('src/shared') } } },
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer/src'), '@shared': resolve('src/shared') } },
    plugins: [react(), tailwindcss()],
  },
})
```

`src/renderer/src/index.css` 首行替换为 `@import "tailwindcss";`（保留模板其余样式或删除均可）。

- [ ] **Step 4: tsconfig 别名**

确认模板 `tsconfig.web.json` 已含 `@/*` 与 `@shared/*` paths、`tsconfig.node.json` 含 `@shared/*`；缺少则补：

```json
"paths": { "@/*": ["./src/renderer/src/*"], "@shared/*": ["./src/shared/*"] }
```

- [ ] **Step 5: shadcn init + 基础组件**

```powershell
npx shadcn@latest init
# 选择 Neutral base color；确认生成 components.json 与 src/renderer/src/lib/utils.ts
npx shadcn@latest add button sonner
```

- [ ] **Step 6: 配置 Vitest 与 ABI 脚本**

新建根 `vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@shared': resolve('src/shared') } },
})
```

`package.json` scripts 增加（保留模板已有 dev/build/preview）：

```json
{
  "test": "npm run db:node && vitest run",
  "test:unit": "vitest run tests/unit",
  "db:node": "npm rebuild better-sqlite3",
  "db:electron": "electron-rebuild -f -w better-sqlite3",
  "postinstall": "electron-rebuild -f -w better-sqlite3"
}
```

执行 `npm run db:electron` 使初始二进制对齐 Electron。

- [ ] **Step 7: 验证**

```powershell
npm run build     # 期望：out/{main,preload,renderer} 三产物
npm run test:unit # 期望：No test files found（退出码 0 或 warn 均可）
npm run dev       # 期望：弹出模板窗口；Ctrl+C 退出
```

- [ ] **Step 8: Commit**

```powershell
git add -A
git commit -m "chore: scaffold electron-vite with react-ts, tailwind v4, shadcn, vitest"
```

---

## Task 2: 共享类型 + 重复展开引擎（TDD 纯函数）

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/recurrence.ts`
- Create: `tests/unit/recurrence.test.ts`

**Interfaces:**
- Produces:
  - 类型 `Priority / RepeatType / MonthlyMode / OccurrenceStatus / RecurrenceSpec / Todo / TodoDraft / OccurrenceItem / OccurrenceQuery`
  - `occursOn(spec, start, date): boolean`
  - `occurrencesInRange(spec, start, from, to): string[]`
  - `nextOccurrences(spec, start, afterExclusive, count, exclude?): string[]`
  - `todayStr(nowMs): string`、`dateToLocalMs(date, timeOfDay): number`、`addDays(d, n): string`、`weekdayOf(date): number`、`dateToNum(d): number`

- [ ] **Step 1: 定义共享类型 `src/shared/types.ts`**

```ts
export type Priority = 0 | 1 | 2;
export type RepeatType = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom';
export type MonthlyMode = 'by_date' | 'by_weekday';
export type OccurrenceStatus = 'active' | 'done' | 'skipped';

export interface RecurrenceSpec {
  repeatType: RepeatType;
  repeatInterval?: number | null;   // custom：每 N 天，>=1
  repeatWeekdays?: number[] | null; // weekly：0=周日 .. 6=周六
  monthlyMode?: MonthlyMode | null;
  monthlyDay?: number | null;       // by_date：目标日 1..31（当月无该日则跳过该月）
  monthlyWeekday?: number | null;   // by_weekday：目标周几 0..6
  monthlyWhich?: number | null;     // by_weekday：第 N 个 1..5，5=最后一个
}

export interface Todo extends RecurrenceSpec {
  id: number;
  title: string;
  notes: string | null;
  priority: Priority;
  dueDate: string | null;      // YYYY-MM-DD
  timeOfDay: string | null;    // HH:mm；null = 不发提醒
  startDate: string | null;    // 重复序列锚点（repeatType !== 'none' 时有值）
  completedAt: number | null;  // 仅一次性任务
  createdAt: number;
  updatedAt: number;
}

export type TodoDraft = Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>;

export interface OccurrenceItem {
  todoId: number;
  date: string;
  title: string;
  priority: Priority;
  timeOfDay: string | null;
  repeatType: RepeatType;
  state: OccurrenceStatus;
  overdue: boolean;
}

export interface OccurrenceQuery { from: string; to: string }
```

- [ ] **Step 2: 写失败测试 `tests/unit/recurrence.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { occursOn, occurrencesInRange, nextOccurrences } from '@shared/recurrence';
import type { RecurrenceSpec } from '@shared/types';

describe('occursOn', () => {
  it('none 仅 start 当天', () => {
    const s: RecurrenceSpec = { repeatType: 'none' };
    expect(occursOn(s, '2026-10-27', '2026-10-27')).toBe(true);
    expect(occursOn(s, '2026-10-27', '2026-10-28')).toBe(false);
    expect(occursOn(s, '2026-10-27', '2026-10-26')).toBe(false);
  });
  it('daily 覆盖 start 起每一天', () => {
    const s: RecurrenceSpec = { repeatType: 'daily' };
    expect(occursOn(s, '2026-10-01', '2026-12-31')).toBe(true);
    expect(occursOn(s, '2026-10-01', '2026-09-30')).toBe(false);
  });
  it('weekly 按 repeatWeekdays 过滤（周一/周四）', () => {
    const s: RecurrenceSpec = { repeatType: 'weekly', repeatWeekdays: [1, 4] };
    // 2026-10：周四 1/8/15/22/29，周一 5/12/19/26
    expect(occursOn(s, '2026-10-01', '2026-10-05')).toBe(true);  // Mon
    expect(occursOn(s, '2026-10-01', '2026-10-08')).toBe(true);  // Thu
    expect(occursOn(s, '2026-10-01', '2026-10-06')).toBe(false); // Tue
  });
  it('custom 每 3 天', () => {
    const s: RecurrenceSpec = { repeatType: 'custom', repeatInterval: 3 };
    expect(occursOn(s, '2026-10-01', '2026-10-01')).toBe(true);
    expect(occursOn(s, '2026-10-01', '2026-10-04')).toBe(true);
    expect(occursOn(s, '2026-10-01', '2026-10-03')).toBe(false);
  });
  it('monthly by_date=31：2 月跳过、3 月出现（规格 §7 月末滚动）', () => {
    const s: RecurrenceSpec = { repeatType: 'monthly', monthlyMode: 'by_date', monthlyDay: 31 };
    expect(occursOn(s, '2026-01-31', '2026-01-31')).toBe(true);
    expect(occursOn(s, '2026-01-31', '2026-02-28')).toBe(false);
    expect(occursOn(s, '2026-01-31', '2026-03-31')).toBe(true);
  });
  it('monthly by_date=29：闰年 2 月出现、平年跳过（规格 §7 闰年）', () => {
    const s: RecurrenceSpec = { repeatType: 'monthly', monthlyMode: 'by_date', monthlyDay: 29 };
    expect(occursOn(s, '2024-01-29', '2024-02-29')).toBe(true);
    expect(occursOn(s, '2024-01-29', '2025-02-28')).toBe(false);
  });
  it('monthly by_weekday 第 3 个周二（规格 §7）', () => {
    const s: RecurrenceSpec = { repeatType: 'monthly', monthlyMode: 'by_weekday', monthlyWeekday: 2, monthlyWhich: 3 };
    // 2026-10 的周二：6/13/20/27，第 3 个 = 20
    expect(occursOn(s, '2026-10-06', '2026-10-20')).toBe(true);
    expect(occursOn(s, '2026-10-06', '2026-10-13')).toBe(false);
    expect(occursOn(s, '2026-10-06', '2026-11-17')).toBe(true);
  });
  it('monthly by_weekday which=5 表示最后一个（不足 5 个也成立）', () => {
    const s: RecurrenceSpec = { repeatType: 'monthly', monthlyMode: 'by_weekday', monthlyWeekday: 0, monthlyWhich: 5 };
    // 2026-10 的周日：4/11/18/25 —— 最后一个是 25
    expect(occursOn(s, '2026-10-01', '2026-10-25')).toBe(true);
    expect(occursOn(s, '2026-10-01', '2026-10-18')).toBe(false);
  });
});

describe('occurrencesInRange', () => {
  it('weekly 单月展开', () => {
    const s: RecurrenceSpec = { repeatType: 'weekly', repeatWeekdays: [1, 4] };
    expect(occurrencesInRange(s, '2026-10-01', '2026-10-01', '2026-10-14')).toEqual([
      '2026-10-01', '2026-10-05', '2026-10-08', '2026-10-12',
    ]);
  });
  it('区间早于 start 返回空', () => {
    expect(occurrencesInRange({ repeatType: 'daily' }, '2026-10-10', '2026-10-01', '2026-10-05')).toEqual([]);
  });
});

describe('nextOccurrences', () => {
  it('排除 done/skipped 集合（规格 §7 状态过滤）', () => {
    const s: RecurrenceSpec = { repeatType: 'daily' };
    expect(nextOccurrences(s, '2026-10-01', '2026-10-05', 3, new Set(['2026-10-07'])))
      .toEqual(['2026-10-06', '2026-10-08', '2026-10-09']);
  });
  it('none 未来返回 1 项、过去返回空', () => {
    expect(nextOccurrences({ repeatType: 'none' }, '2026-12-31', '2026-10-01', 3)).toEqual(['2026-12-31']);
    expect(nextOccurrences({ repeatType: 'none' }, '2026-01-01', '2026-10-01', 3)).toEqual([]);
  });
  it('730 天安全阀：永不出现的规则返回空', () => {
    const s: RecurrenceSpec = { repeatType: 'weekly', repeatWeekdays: [] };
    expect(nextOccurrences(s, '2026-10-01', '2026-10-01', 5)).toEqual([]);
  });
});
```

- [ ] **Step 3: 运行确认失败**

```powershell
npm run test:unit
# 预期 FAIL：Cannot find module '@shared/recurrence'
```

- [ ] **Step 4: 实现 `src/shared/recurrence.ts`**

```ts
import type { RecurrenceSpec } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → 可比较数值（20261027） */
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
  const x = parse(a), y = parse(b);
  return Math.round((Date.UTC(y.y, y.m - 1, y.day) - Date.UTC(x.y, x.m - 1, x.day)) / 86_400_000);
}

export function todayStr(nowMs: number): string {
  const d = new Date(nowMs);
  return formatDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** 本地时区时间戳；DST 跳变不存在时刻由 Date 构造器归一到下一有效瞬间（规格 §7） */
export function dateToLocalMs(date: string, timeOfDay: string): number {
  const p = parse(date);
  const [h, mi] = timeOfDay.split(':').map(Number);
  return new Date(p.y, p.m - 1, p.day, h, mi, 0, 0).getTime();
}

function occursByDate(spec: RecurrenceSpec, date: string): boolean {
  const p = parse(date);
  const target = spec.monthlyDay ?? 1;
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
    case 'none':    return date === start;
    case 'daily':   return true;
    case 'weekly':  return (spec.repeatWeekdays ?? []).includes(weekdayOf(date));
    case 'monthly': return spec.monthlyMode === 'by_weekday'
      ? occursByWeekday(spec, date)
      : occursByDate(spec, date);
    case 'custom':  return dayDiff(start, date) % Math.max(1, spec.repeatInterval ?? 1) === 0;
  }
}

export function occurrencesInRange(spec: RecurrenceSpec, start: string, from: string, to: string): string[] {
  const out: string[] = [];
  const begin = dateToNum(start) >= dateToNum(from) ? start : from;
  if (dateToNum(to) < dateToNum(begin)) return out;
  for (let cur = begin; dateToNum(cur) <= dateToNum(to); cur = addDays(cur, 1)) {
    if (occursOn(spec, start, cur)) out.push(cur);
  }
  return out;
}

/** afterExclusive 之后的前 count 个发生日；exclude 过滤 done/skipped；730 天安全阀 */
export function nextOccurrences(
  spec: RecurrenceSpec, start: string, afterExclusive: string, count: number, exclude: Set<string> = new Set(),
): string[] {
  const out: string[] = [];
  const limit = dateToNum(addDays(start, 730));
  let cur = dateToNum(afterExclusive) >= dateToNum(start) ? addDays(afterExclusive, 1) : start;
  while (out.length < count && dateToNum(cur) <= limit) {
    if (occursOn(spec, start, cur) && !exclude.has(cur)) out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}
```

- [ ] **Step 5: 运行确认通过**

```powershell
npm run test:unit   # 预期全部 PASS
```

- [ ] **Step 6: Commit**

```powershell
git add src/shared/types.ts src/shared/recurrence.ts tests/unit/recurrence.test.ts
git commit -m "feat(shared): recurrence expansion engine with full edge-case tests"
```

---

## Task 3: 数据库层（openDb + 迁移 + 损坏恢复 + 四个 DAO）

**Files:**
- Create: `src/main/db/schema.ts`
- Create: `src/main/db/index.ts`
- Create: `src/main/db/dao.ts`
- Create: `tests/integration/dao.test.ts`

**Interfaces:**
- Consumes: `Todo / TodoDraft / Priority / OccurrenceStatus`（Task 2）
- Produces:
  - `openDb(dataDir: string): { db: Database; recovered: boolean }`（`Database = better-sqlite3`）
  - `migrate(db): void`（集成测试直接建表用）
  - `TodoDao`: `create(draft): Todo`、`getById(id): Todo | null`、`update(id, patch: Partial<TodoDraft>): Todo | null`、`deleteById(id): void`、`listActive(): Todo[]`、`listAll('all'|'open'|'done'): Todo[]`、`setCompleted(id, at): void`
  - `OccurrenceDao`: `setState(todoId, date, status)`、`getState(todoId, date)`、`getByTodo(todoId): Map<string, OccurrenceStatus>`
  - `ReminderDao`: `insertPending(todoId, date, fireAt)`（同 todo+date 已有 pending/snoozed 则跳过）、`insertSnoozed(todoId, date, fireAt)`、`dismissFor(todoId)`、`nextPending(now): Reminder | null`（fire_at **>** now 最小者）、`listExpired(now): Reminder[]`（fire_at **<=** now）、`markFired(ids)`；`Reminder = { id; todoId; occurrenceDate; fireAt; status }`
  - `SettingsDao`: `get<T>(key): T | null`、`set<T>(key, value)`（JSON 序列化）

- [ ] **Step 1: `src/main/db/schema.ts`**

```ts
export const SCHEMA_VERSION = 1;

export const MIGRATIONS: Record<number, string[]> = {
  1: [
    `CREATE TABLE todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      notes TEXT,
      priority INTEGER NOT NULL DEFAULT 1,
      due_date TEXT,
      time_of_day TEXT,
      repeat_type TEXT NOT NULL DEFAULT 'none',
      repeat_interval INTEGER,
      repeat_weekdays TEXT,
      monthly_mode TEXT,
      monthly_day INTEGER,
      monthly_weekday INTEGER,
      monthly_which INTEGER,
      start_date TEXT,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL)`,
    `CREATE INDEX idx_todos_due ON todos(due_date)`,
    `CREATE TABLE occurrence_states (
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      occurrence_date TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (todo_id, occurrence_date))`,
    `CREATE TABLE reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      occurrence_date TEXT NOT NULL,
      fire_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      snoozed_until INTEGER,
      created_at INTEGER NOT NULL)`,
    `CREATE INDEX idx_reminders_due ON reminders(status, fire_at)`,
    `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  ],
};
```

- [ ] **Step 2: `src/main/db/index.ts`**

```ts
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS, SCHEMA_VERSION } from './schema';

export type Db = Database.Database;
export interface DbHandle { db: Db; recovered: boolean }

export function openDb(dataDir: string): DbHandle {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'todo.db');
  let recovered = false;
  if (existsSync(file) && !integrityOk(file)) {
    renameSync(file, `${file}.corrupt.${Date.now()}`); // 规格 §6：保留可手动恢复的备份
    recovered = true;
  }
  const db = new Database(file);
  migrate(db);
  return { db, recovered };
}

function integrityOk(file: string): boolean {
  try {
    const d = new Database(file, { readonly: true });
    const res = d.pragma('integrity_check', { simple: true }) as string;
    d.close();
    return res === 'ok';
  } catch { return false; }
}

export function migrate(db: Db): void {
  const ver = db.pragma('user_version', { simple: true }) as number;
  db.transaction(() => {
    for (let v = ver + 1; v <= SCHEMA_VERSION; v++) {
      for (const sql of MIGRATIONS[v]) db.exec(sql);
    }
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
  db.pragma('foreign_keys = ON'); // 级联删除 occurrence_states / reminders
}
```

- [ ] **Step 3: `src/main/db/dao.ts`**

```ts
import type { Db } from './index';
import type { Todo, TodoDraft, OccurrenceStatus, Priority, RepeatType, MonthlyMode } from '@shared/types';

interface TodoRow {
  id: number; title: string; notes: string | null; priority: number;
  due_date: string | null; time_of_day: string | null;
  repeat_type: string; repeat_interval: number | null; repeat_weekdays: string | null;
  monthly_mode: string | null; monthly_day: number | null;
  monthly_weekday: number | null; monthly_which: number | null;
  start_date: string | null; completed_at: number | null;
  created_at: number; updated_at: number;
}

const unpack = (r: TodoRow): Todo => ({
  id: r.id, title: r.title, notes: r.notes, priority: r.priority as Priority,
  dueDate: r.due_date, timeOfDay: r.time_of_day,
  repeatType: r.repeat_type as RepeatType,
  repeatInterval: r.repeat_interval,
  repeatWeekdays: r.repeat_weekdays ? (JSON.parse(r.repeat_weekdays) as number[]) : null,
  monthlyMode: r.monthly_mode as MonthlyMode | null,
  monthlyDay: r.monthly_day, monthlyWeekday: r.monthly_weekday, monthlyWhich: r.monthly_which,
  startDate: r.start_date, completedAt: r.completed_at,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const pack = (t: Partial<Todo>, now: number) => ({
  title: t.title ?? '', notes: t.notes ?? null, priority: t.priority ?? 1,
  dueDate: t.dueDate ?? null, timeOfDay: t.timeOfDay ?? null,
  repeatType: t.repeatType ?? 'none', repeatInterval: t.repeatInterval ?? null,
  repeatWeekdays: t.repeatWeekdays ? JSON.stringify(t.repeatWeekdays) : null,
  monthlyMode: t.monthlyMode ?? null, monthlyDay: t.monthlyDay ?? null,
  monthlyWeekday: t.monthlyWeekday ?? null, monthlyWhich: t.monthlyWhich ?? null,
  startDate: t.startDate ?? null, completedAt: t.completedAt ?? null,
  createdAt: t.createdAt ?? now, updatedAt: now,
});

const COLS = `id, title, notes, priority, due_date, time_of_day, repeat_type,
  repeat_interval, repeat_weekdays, monthly_mode, monthly_day, monthly_weekday,
  monthly_which, start_date, completed_at, created_at, updated_at`;

export class TodoDao {
  constructor(private db: Db) {}

  create(draft: TodoDraft): Todo {
    const now = Date.now();
    const p = pack(draft, now);
    const info = this.db.prepare(
      `INSERT INTO todos (title, notes, priority, due_date, time_of_day, repeat_type,
        repeat_interval, repeat_weekdays, monthly_mode, monthly_day, monthly_weekday,
        monthly_which, start_date, completed_at, created_at, updated_at)
       VALUES (@title, @notes, @priority, @dueDate, @timeOfDay, @repeatType,
        @repeatInterval, @repeatWeekdays, @monthlyMode, @monthlyDay, @monthlyWeekday,
        @monthlyWhich, @startDate, @completedAt, @createdAt, @updatedAt)`,
    ).run(p);
    return this.getById(Number(info.lastInsertRowid))!;
  }

  getById(id: number): Todo | null {
    const row = this.db.prepare(`SELECT ${COLS} FROM todos WHERE id=?`).get(id) as TodoRow | undefined;
    return row ? unpack(row) : null;
  }

  update(id: number, patch: Partial<TodoDraft>): Todo | null {
    const cur = this.getById(id);
    if (!cur) return null;
    const merged: Partial<Todo> = { ...cur, ...patch, createdAt: cur.createdAt };
    const p = pack(merged, Date.now());
    this.db.prepare(
      `UPDATE todos SET title=@title, notes=@notes, priority=@priority, due_date=@dueDate,
        time_of_day=@timeOfDay, repeat_type=@repeatType, repeat_interval=@repeatInterval,
        repeat_weekdays=@repeatWeekdays, monthly_mode=@monthlyMode, monthly_day=@monthlyDay,
        monthly_weekday=@monthlyWeekday, monthly_which=@monthlyWhich, start_date=@startDate,
        completed_at=@completedAt, updated_at=@updatedAt WHERE id=@id`,
    ).run({ ...p, id });
    return this.getById(id);
  }

  deleteById(id: number): void { this.db.prepare('DELETE FROM todos WHERE id=?').run(id); }

  listActive(): Todo[] {
    return (this.db.prepare(`SELECT ${COLS} FROM todos WHERE completed_at IS NULL ORDER BY id`)
      .all() as TodoRow[]).map(unpack);
  }

  listAll(status: 'all' | 'open' | 'done'): Todo[] {
    const where = status === 'open' ? 'WHERE completed_at IS NULL'
      : status === 'done' ? 'WHERE completed_at IS NOT NULL' : '';
    return (this.db.prepare(`SELECT ${COLS} FROM todos ${where} ORDER BY id DESC`).all() as TodoRow[]).map(unpack);
  }

  setCompleted(id: number, at: number): void {
    this.db.prepare('UPDATE todos SET completed_at=?, updated_at=? WHERE id=?').run(at, at, id);
  }
}

export class OccurrenceDao {
  constructor(private db: Db) {}

  setState(todoId: number, date: string, status: OccurrenceStatus): void {
    this.db.prepare(
      `INSERT INTO occurrence_states (todo_id, occurrence_date, status) VALUES (?,?,?)
       ON CONFLICT(todo_id, occurrence_date) DO UPDATE SET status=excluded.status`,
    ).run(todoId, date, status);
  }

  getState(todoId: number, date: string): OccurrenceStatus | null {
    const row = this.db.prepare(
      'SELECT status FROM occurrence_states WHERE todo_id=? AND occurrence_date=?',
    ).get(todoId, date) as { status: OccurrenceStatus } | undefined;
    return row?.status ?? null;
  }

  getByTodo(todoId: number): Map<string, OccurrenceStatus> {
    const rows = this.db.prepare(
      'SELECT occurrence_date, status FROM occurrence_states WHERE todo_id=?',
    ).all(todoId) as Array<{ occurrence_date: string; status: OccurrenceStatus }>;
    return new Map(rows.map(r => [r.occurrence_date, r.status]));
  }
}

export type ReminderStatus = 'pending' | 'fired' | 'snoozed' | 'dismissed';

export interface Reminder {
  id: number; todoId: number; occurrenceDate: string; fireAt: number; status: ReminderStatus;
}

interface ReminderRow {
  id: number; todo_id: number; occurrence_date: string; fire_at: number; status: ReminderStatus;
}
const unpackR = (r: ReminderRow): Reminder => ({
  id: r.id, todoId: r.todo_id, occurrenceDate: r.occurrence_date, fireAt: r.fire_at, status: r.status,
});

export class ReminderDao {
  constructor(private db: Db) {}

  insertPending(todoId: number, date: string, fireAt: number): void {
    const existing = this.db.prepare(
      `SELECT id FROM reminders WHERE todo_id=? AND occurrence_date=? AND status IN ('pending','snoozed')`,
    ).get(todoId, date);
    if (existing) return; // 幂等：同发生日不重复排队
    this.db.prepare(
      `INSERT INTO reminders (todo_id, occurrence_date, fire_at, status, created_at)
       VALUES (?,?,?, 'pending', ?)`,
    ).run(todoId, date, fireAt, Date.now());
  }

  insertSnoozed(todoId: number, date: string, fireAt: number): void {
    this.db.prepare(
      `INSERT INTO reminders (todo_id, occurrence_date, fire_at, status, snoozed_until, created_at)
       VALUES (?,?,?, 'snoozed', ?, ?)`,
    ).run(todoId, date, fireAt, fireAt, Date.now());
  }

  dismissFor(todoId: number): void {
    this.db.prepare(
      `UPDATE reminders SET status='dismissed' WHERE todo_id=? AND status IN ('pending','snoozed')`,
    ).run(todoId);
  }

  nextPending(now: number): Reminder | null {
    const row = this.db.prepare(
      `SELECT id, todo_id, occurrence_date, fire_at, status FROM reminders
       WHERE status IN ('pending','snoozed') AND fire_at > ? ORDER BY fire_at LIMIT 1`,
    ).get(now) as ReminderRow | undefined;
    return row ? unpackR(row) : null;
  }

  listExpired(now: number): Reminder[] {
    return (this.db.prepare(
      `SELECT id, todo_id, occurrence_date, fire_at, status FROM reminders
       WHERE status IN ('pending','snoozed') AND fire_at <= ? ORDER BY fire_at`,
    ).all(now) as ReminderRow[]).map(unpackR);
  }

  markFired(ids: number[]): void {
    if (!ids.length) return;
    const ph = ids.map(() => '?').join(',');
    this.db.prepare(`UPDATE reminders SET status='fired' WHERE id IN (${ph})`).run(...ids);
  }
}

export class SettingsDao {
  constructor(private db: Db) {}

  get<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }

  set<T>(key: string, value: T): void {
    this.db.prepare(
      `INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).run(key, JSON.stringify(value));
  }
}
```

- [ ] **Step 4: 写集成测试 `tests/integration/dao.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, rm } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate } from '../../src/main/db';
import { TodoDao, OccurrenceDao, ReminderDao, SettingsDao } from '../../src/main/db/dao';
import type { TodoDraft } from '@shared/types';

const memDb = () => { const db = new Database(':memory:'); migrate(db); return db; };

const draft: TodoDraft = {
  title: '喝水', notes: null, priority: 2,
  dueDate: '2026-10-27', timeOfDay: '10:00',
  repeatType: 'weekly', repeatInterval: null, repeatWeekdays: [1, 4],
  monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  startDate: '2026-10-27', completedAt: null,
};

describe('TodoDao', () => {
  it('create/getById 往返保留 camelCase 与 JSON 数组', () => {
    const dao = new TodoDao(memDb());
    const t = dao.create(draft);
    expect(t.id).toBeGreaterThan(0);
    expect(t.repeatWeekdays).toEqual([1, 4]);
    expect(t.priority).toBe(2);
  });
  it('update 只覆盖给定字段', () => {
    const dao = new TodoDao(memDb());
    const t = dao.create(draft);
    const u = dao.update(t.id, { title: '改名' })!;
    expect(u.title).toBe('改名');
    expect(u.repeatType).toBe('weekly');
    expect(u.createdAt).toBe(t.createdAt);
  });
  it('deleteById 级联清理 occurrence_states 与 reminders', () => {
    const db = memDb();
    const todos = new TodoDao(db), occ = new OccurrenceDao(db), rem = new ReminderDao(db);
    const t = todos.create(draft);
    occ.setState(t.id, '2026-10-28', 'done');
    rem.insertPending(t.id, '2026-11-02', Date.now() + 60_000);
    todos.deleteById(t.id);
    expect(occ.getByTodo(t.id).size).toBe(0);
    expect(rem.nextPending(Date.now())).toBeNull();
  });
  it('setCompleted 后 listActive 不含、listAll(done) 含', () => {
    const db = memDb(); const dao = new TodoDao(db);
    const t = dao.create(draft);
    dao.setCompleted(t.id, 123);
    expect(dao.listActive().map(x => x.id)).not.toContain(t.id);
    expect(dao.listAll('done').map(x => x.id)).toContain(t.id);
  });
});

describe('OccurrenceDao', () => {
  it('setState 幂等 upsert', () => {
    const db = memDb(); const todos = new TodoDao(db); const occ = new OccurrenceDao(db);
    const t = todos.create(draft);
    occ.setState(t.id, '2026-10-28', 'done');
    occ.setState(t.id, '2026-10-28', 'skipped');
    expect(occ.getState(t.id, '2026-10-28')).toBe('skipped');
    expect(occ.getByTodo(t.id).size).toBe(1);
  });
});

describe('ReminderDao', () => {
  it('insertPending 对同 todo+date 幂等', () => {
    const r = new ReminderDao(memDb());
    r.insertPending(1, '2026-10-28', 2000);
    r.insertPending(1, '2026-10-28', 3000);
    expect(r.listExpired(4000).length).toBe(1);
  });
  it('nextPending 取 fireAt 最小；dismissFor 后不可见', () => {
    const r = new ReminderDao(memDb());
    r.insertPending(1, '2026-10-28', 2000);
    r.insertPending(2, '2026-10-28', 1000);
    expect(r.nextPending(0)!.todoId).toBe(2);
    r.dismissFor(2);
    expect(r.nextPending(0)!.todoId).toBe(1);
  });
  it('nextPending 用 >、listExpired 用 <=（边界互补）', () => {
    const r = new ReminderDao(memDb());
    r.insertPending(1, '2026-10-28', 1000);
    expect(r.nextPending(1000)).toBeNull();
    expect(r.listExpired(1000).length).toBe(1);
  });
  it('markFired 后 expired/pending 均消失', () => {
    const r = new ReminderDao(memDb());
    r.insertPending(1, '2026-10-28', 500);
    r.markFired(r.listExpired(1000).map(x => x.id));
    expect(r.listExpired(1000)).toHaveLength(0);
    expect(r.nextPending(0)).toBeNull();
  });
});

describe('SettingsDao', () => {
  it('JSON 值往返', () => {
    const s = new SettingsDao(memDb());
    expect(s.get('theme')).toBeNull();
    s.set('theme', 'dark');
    expect(s.get('theme')).toBe('dark');
    s.set('quickadd_shortcut', 'Ctrl+Alt+A');
    expect(s.get('quickadd_shortcut')).toBe('Ctrl+Alt+A');
  });
});

describe('openDb 损坏恢复（规格 §6）', () => {
  it('损坏 db 改名为 .corrupt.<ts> 并新建可用库', () => {
    const dir = mkdtempSync(join(tmpdir(), 'whchem-'));
    try {
      writeFileSync(join(dir, 'todo.db'), Buffer.alloc(64, 0xFF));
      const { db, recovered } = openDb(dir);
      expect(recovered).toBe(true);
      new TodoDao(db).create(draft); // 新库可写
      db.close();
      const files = readdirSync(dir);
      expect(files.some(f => f.startsWith('todo.db.corrupt.'))).toBe(true);
      expect(existsSync(join(dir, 'todo.db'))).toBe(true);
    } finally { rm(dir, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 5: 运行集成测试**

```powershell
npm run test   # db:node + vitest run；预期全部 PASS
npm run db:electron   # 恢复 Electron ABI，保持 dev 可用
```

- [ ] **Step 6: Commit**

```powershell
git add src/main/db tests/integration/dao.test.ts
git commit -m "feat(db): schema with migrations, integrity recovery and four DAOs"
```

---

## Task 4: TodoService（CRUD + 虚拟展开 + 预览）

**Files:**
- Create: `src/main/services/todo-service.ts`
- Create: `tests/integration/todo-service.test.ts`

**Interfaces:**
- Consumes: `TodoDao/OccurrenceDao`（Task 3）、`occurrencesInRange/nextOccurrences/todayStr/dateToLocalMs/dateToNum`（Task 2）
- Produces:

```ts
class TodoService {
  constructor(todos: TodoDao, occ: OccurrenceDao, clock?: () => number);
  create(draft: TodoDraft): Todo;
  update(id: number, patch: Partial<TodoDraft>): Todo | null;
  getById(id: number): Todo | null;
  remove(id: number): void;
  list(from: string, to: string): OccurrenceItem[];   // 已展开扁平条目，含 done/skipped 状态与 overdue 标记
  complete(todoId: number, date?: string): void;       // 一次性→setCompleted；重复→setState(done)
  setStatus(todoId: number, date: string, status: 'done'|'skipped'|'active'): void; // active=清除行恢复
  preview(draft: TodoDraft, count?: number, todoId?: number): string[]; // 编辑对话框"下次出现"（含今天）；todoId 给定时排除 done/skipped
}
```

业务规则：
- 创建/更新时 `repeatType !== 'none'` 且未给 `startDate` → 以 `dueDate` 为锚点；`none` 任务 `startDate` 同样存为 `dueDate`（展开函数统一签名需要 start 参数）。
- `list` 中一次性任务完成态读 `completedAt`；重复任务读 `occurrence_states`。
- `overdue`：`state==='active'` 且（`date < today` 或（`date === today` 且有 `timeOfDay` 且已过时刻）。
- `setStatus(..., 'active')`：删除该行（恢复为正常待办）。
- `preview`：从 `today`（含）起取前 5 个发生日。

- [ ] **Step 1: 写失败测试 `tests/integration/todo-service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/main/db';
import { TodoDao, OccurrenceDao } from '../../src/main/db/dao';
import { TodoService } from '../../src/main/services/todo-service';
import type { TodoDraft } from '@shared/types';

// 固定"现在" = 2026-10-27 12:00 本地
const clock = () => new Date(2026, 9, 27, 12, 0).getTime();
const base: TodoDraft = {
  title: 't', notes: null, priority: 1,
  dueDate: '2026-10-27', timeOfDay: null,
  repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
  monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  startDate: null, completedAt: null,
};

let svc: TodoService;
beforeEach(() => {
  const db = new Database(':memory:'); migrate(db);
  svc = new TodoService(new TodoDao(db), new OccurrenceDao(db), clock);
});

describe('TodoService', () => {
  it('create 自动补齐 startDate 锚点', () => {
    const t = svc.create({ ...base, repeatType: 'daily' });
    expect(t.startDate).toBe('2026-10-27');
  });

  it('daily 区间展开 12 条（10-20..10-31）', () => {
    svc.create({ ...base, repeatType: 'daily', dueDate: '2026-10-20' });
    const items = svc.list('2026-10-20', '2026-10-31');
    expect(items).toHaveLength(12);
    expect(items[0].date).toBe('2026-10-20');
    expect(items.every(i => i.state === 'active')).toBe(true);
  });

  it('区间完全在过去也返回条目并标 overdue', () => {
    svc.create({ ...base, dueDate: '2026-10-20' }); // 一次性，已过
    const items = svc.list('2026-10-20', '2026-10-20');
    expect(items[0].overdue).toBe(true);
  });

  it('timeOfDay 今天已过 → overdue；未到 → 不 overdue', () => {
    svc.create({ ...base, timeOfDay: '09:00' });   // 今天 09:00 < 12:00
    svc.create({ ...base, title: '晚', timeOfDay: '21:00' });
    const items = svc.list('2026-10-27', '2026-10-27');
    expect(items.find(i => i.title === 't')!.overdue).toBe(true);
    expect(items.find(i => i.title === '晚')!.overdue).toBe(false);
  });

  it('complete 重复任务单日 → 该条 done，其余 active', () => {
    const t = svc.create({ ...base, repeatType: 'daily' });
    svc.complete(t.id, '2026-10-27');
    const items = svc.list('2026-10-27', '2026-10-29');
    expect(items.map(i => i.state)).toEqual(['done', 'active', 'active']);
  });

  it('complete 一次性任务 → done 且不再 listActive', () => {
    const t = svc.create(base);
    svc.complete(t.id);
    expect(svc.list('2026-10-27', '2026-10-27')[0].state).toBe('done');
  });

  it('setStatus skipped 保留条目；active 恢复', () => {
    const t = svc.create({ ...base, repeatType: 'daily' });
    svc.setStatus(t.id, '2026-10-28', 'skipped');
    expect(svc.list('2026-10-28', '2026-10-28')[0].state).toBe('skipped');
    svc.setStatus(t.id, '2026-10-28', 'active');
    expect(svc.list('2026-10-28', '2026-10-28')[0].state).toBe('active');
  });

  it('update 改重复规则后 list 反映新规则（单一真相源验证）', () => {
    const t = svc.create({ ...base, repeatType: 'daily' });
    svc.update(t.id, { repeatType: 'weekly', repeatWeekdays: [1] });
    const items = svc.list('2026-10-27', '2026-11-03'); // 周二 27、周一 11-02
    expect(items.map(i => i.date)).toEqual(['2026-11-02']); // 10-27 是周二，新规则只留周一
  });

  it('preview 含今天起前 5 个发生日', () => {
    expect(svc.preview({ ...base, repeatType: 'daily', dueDate: '2026-10-27' }))
      .toEqual(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
  });

  it('preview 排除已 done/skipped 的发生日', () => {
    const t = svc.create({ ...base, repeatType: 'daily' });
    svc.setStatus(t.id, '2026-10-28', 'skipped');
    const out = svc.preview(svc.getById(t.id)!);
    expect(out).toEqual(['2026-10-27', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  });

  it('remove 后条目从 list 消失', () => {
    const t = svc.create({ ...base, repeatType: 'daily' });
    svc.remove(t.id);
    expect(svc.list('2026-10-27', '2026-10-31')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```powershell
npm run test   # 预期 FAIL：Cannot find module todo-service
```

- [ ] **Step 3: 实现 `src/main/services/todo-service.ts`**

前置：给 Task 3 的 `OccurrenceDao` 补一个删除方法（`src/main/db/dao.ts`）：

```ts
// 状态行只记录 done/skipped；"active"（恢复）= 删行
deleteState(todoId: number, date: string): void {
  this.db.prepare('DELETE FROM occurrence_states WHERE todo_id=? AND occurrence_date=?').run(todoId, date);
}
```

```ts
import type { TodoDao, OccurrenceDao } from '../db/dao';
import type { Todo, TodoDraft, OccurrenceItem, RecurrenceSpec, OccurrenceStatus } from '@shared/types';
import { occurrencesInRange, nextOccurrences, todayStr, dateToLocalMs, dateToNum } from '@shared/recurrence';

const toSpec = (t: RecurrenceSpec): RecurrenceSpec => ({
  repeatType: t.repeatType, repeatInterval: t.repeatInterval, repeatWeekdays: t.repeatWeekdays,
  monthlyMode: t.monthlyMode, monthlyDay: t.monthlyDay,
  monthlyWeekday: t.monthlyWeekday, monthlyWhich: t.monthlyWhich,
});

export class TodoService {
  constructor(
    private todos: TodoDao,
    private occ: OccurrenceDao,
    private clock: () => number = Date.now,
  ) {}

  create(draft: TodoDraft): Todo {
    const normalized: TodoDraft = { ...draft };
    // 统一锚点：重复与一次性都用 startDate 驱动展开（规格 §3.1）
    if (!normalized.startDate) normalized.startDate = normalized.dueDate;
    return this.todos.create(normalized);
  }

  update(id: number, patch: Partial<TodoDraft>): Todo | null {
    return this.todos.update(id, patch);
  }

  getById(id: number): Todo | null { return this.todos.getById(id); }

  remove(id: number): void { this.todos.deleteById(id); }

  list(from: string, to: string): OccurrenceItem[] {
    const out: OccurrenceItem[] = [];
    const today = todayStr(this.clock());
    const push = (t: Todo, date: string, state: OccurrenceStatus) =>
      out.push(this.item(t, date, state, today));

    for (const t of this.todos.listAll('all')) {
      const anchor = t.startDate ?? t.dueDate;
      if (!anchor) continue;
      if (t.repeatType === 'none') {
        if (dateToNum(anchor) < dateToNum(from) || dateToNum(anchor) > dateToNum(to)) continue;
        push(t, anchor, t.completedAt != null ? 'done' : 'active');
      } else {
        const states = this.occ.getByTodo(t.id);
        for (const d of occurrencesInRange(toSpec(t), anchor, from, to)) {
          push(t, d, states.get(d) ?? 'active');
        }
      }
    }
    return out.sort((a, b) => dateToNum(a.date) - dateToNum(b.date) || a.todoId - b.todoId);
  }

  complete(todoId: number, date?: string): void {
    const t = this.todos.getById(todoId);
    if (!t) return;
    if (t.repeatType === 'none') this.todos.setCompleted(todoId, this.clock());
    else if (date) this.occ.setState(todoId, date, 'done');
  }

  setStatus(todoId: number, date: string, status: OccurrenceStatus): void {
    const t = this.todos.getById(todoId);
    if (!t) return;
    if (t.repeatType === 'none') {
      // 一次性：done→setCompleted，active→清 completedAt，skipped 忽略
      if (status === 'done') this.todos.setCompleted(todoId, this.clock());
      else if (status === 'active') this.todos.update(todoId, { completedAt: null });
      return;
    }
    // 重复：active = 恢复为正常待办，删除状态行
    if (status === 'active') this.occ.deleteState(todoId, date);
    else this.occ.setState(todoId, date, status);
  }

  /**
   * 编辑对话框"下次出现"预览：含今天起前 count 个发生日（规格 §5.5）。
   * 编辑既有任务时显式传 todoId 排除已 done/skipped 的发生日。
   */
  preview(draft: TodoDraft, count = 5, todoId?: number): string[] {
    const today = todayStr(this.clock());
    const anchor = draft.startDate ?? draft.dueDate ?? today;
    if (draft.repeatType === 'none') {
      return dateToNum(anchor) >= dateToNum(today) ? [anchor] : [];
    }
    const exclude = new Set<string>();
    if (todoId != null) {
      for (const [d, s] of this.occ.getByTodo(todoId)) if (s !== 'active') exclude.add(d);
    }
    // "今天"单独判断命中，剩余量由 nextOccurrences（今天之后）补齐
    const todayHit = occurrencesInRange(toSpec(draft), anchor, today, today).filter(d => !exclude.has(d));
    const rest = nextOccurrences(toSpec(draft), anchor, today, count - todayHit.length,
      new Set([...exclude, ...todayHit]));
    return [...todayHit, ...rest];
  }
}
```

同时给 `TodoService` 补上 Task 6 需要的转发方法（与类内其他方法并列）：

```ts
listAll(status: 'all' | 'open' | 'done'): Todo[] { return this.todos.listAll(status); }
```

- [ ] **Step 4: 运行确认通过**

```powershell
npm run test   # 预期全部 PASS
```

- [ ] **Step 5: Commit**

```powershell
git add src/main/services/todo-service.ts src/main/db/dao.ts tests/integration/todo-service.test.ts
git commit -m "feat(service): TodoService with virtual expansion, complete/skip and live preview"
```

---

## Task 5: Scheduler（提醒调度器，TDD）

**Files:**
- Create: `src/main/services/scheduler.ts`
- Create: `tests/unit/scheduler.test.ts`

**Interfaces:**
- Consumes: `ReminderDao/TodoDao` 接口形状（Task 3，测试用内存 fake）、`dateToLocalMs/todayStr/nextOccurrences`（Task 2）
- Produces:

```ts
export interface NotifyItem {
  todoId: number; occurrenceDate: string; title: string; timeOfDay: string | null; overdue: boolean;
}
export interface SchedulerDeps {
  now: () => number;
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  notify: (items: NotifyItem[]) => void;
}
export class Scheduler {
  constructor(rem: ReminderDao, todos: TodoDao, deps: SchedulerDeps);
  start(): void;              // 应用启动 / powerMonitor resume：补发过期 → 重排
  syncAll(): void;            // 启动时全量为每个活动任务排下一期
  syncFor(todo: Todo): void;  // 任务增改删后：dismiss 旧 pending → 重排（规格 §4.1 规则3）
  snooze(todoId: number, date: string, minutes: number): void;
  pause(ms: number): void;    // 全局静音到 now+ms（规格 §4.1）
  tick(): void;               // timer 回调入口（测试手动驱动）
}
```

调度三规则实现要点（规格 §4.1）：
1. **单指针**：`arm()` 只维护一个 setTimeout 指向最近 pending，触发后 tick 重排。
2. **补发**：`start()/tick()` 先 `listExpired(now)`；`deliver()` 先 `markFired` 再判断 `pausedUntil`——暂停期间静默消费但不弹出。过期补发由 `notify` 的 `overdue: true` 标记（渲染/通知层加 "⚠ 已过期" 前缀；多条合并为一条汇总由 notify.ts 做）。
3. `nextPending` 用 `>`、`listExpired` 用 `<=`，严格互补不丢边界事件。

- [ ] **Step 1: 写失败测试 `tests/unit/scheduler.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Scheduler, type NotifyItem } from '../../src/main/services/scheduler';
import type { ReminderDao, TodoDao, Reminder } from '../../src/main/db/dao';
import type { Todo } from '@shared/types';

function fakeReminderDao() {
  const rows: Reminder[] = [];
  let nextId = 1;
  const active = (r: Reminder) => r.status === 'pending' || r.status === 'snoozed';
  const dao = {
    insertPending(todoId: number, date: string, fireAt: number) {
      if (rows.some(r => r.todoId === todoId && r.occurrenceDate === date && active(r))) return;
      rows.push({ id: nextId++, todoId, occurrenceDate: date, fireAt, status: 'pending' });
    },
    insertSnoozed(todoId: number, date: string, fireAt: number) {
      rows.push({ id: nextId++, todoId, occurrenceDate: date, fireAt, status: 'snoozed' });
    },
    dismissFor(todoId: number) {
      for (const r of rows) if (r.todoId === todoId && active(r)) r.status = 'dismissed';
    },
    nextPending(now: number) {
      return rows.filter(r => active(r) && r.fireAt > now).sort((a, b) => a.fireAt - b.fireAt)[0] ?? null;
    },
    listExpired(now: number) { return rows.filter(r => active(r) && r.fireAt <= now); },
    markFired(ids: number[]) { for (const r of rows) if (ids.includes(r.id)) r.status = 'fired'; },
  };
  return { dao: dao as unknown as ReminderDao, rows };
}

const makeTodo = (over: Partial<Todo> = {}): Todo => ({
  id: 1, title: '喝水', notes: null, priority: 1,
  dueDate: '2026-10-27', timeOfDay: '10:00',
  repeatType: 'daily', startDate: '2026-10-27', completedAt: null,
  createdAt: 0, updatedAt: 0, ...over,
});

const at = (h: number, m = 0) => new Date(2026, 9, 27, h, m).getTime(); // 2026-10-27 本地

let nowMs: number;
let timers: Array<{ cb: () => void; at: number }>;
let notified: NotifyItem[][];
function makeScheduler(activeTodos: Todo[]) {
  const { dao: rem, rows } = fakeReminderDao();
  const todos = { listActive: () => activeTodos } as unknown as TodoDao;
  const s = new Scheduler(rem, todos, {
    now: () => nowMs,
    setTimer: (cb, ms) => { const t = { cb, at: nowMs + ms }; timers.push(t); return t; },
    clearTimer: () => { timers = []; },
    notify: (items) => { notified.push(items); },
  });
  return { s, rows };
}

beforeEach(() => {
  nowMs = at(9);          // 现在 09:00
  timers = []; notified = [];
});

describe('Scheduler', () => {
  it('syncAll 为今日未来时刻排 pending', () => {
    const { s, rows } = makeScheduler([makeTodo()]);
    s.syncAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].fireAt).toBe(at(10));
  });

  it('syncAll 跳过 timeOfDay 为空与已完成任务', () => {
    const { s, rows } = makeScheduler([
      makeTodo({ id: 2, timeOfDay: null }),
      makeTodo({ id: 3, completedAt: 1 }),
    ]);
    s.syncAll();
    expect(rows).toHaveLength(0);
  });

  it('arm 只排一个 timer 指向最近 fireAt', () => {
    const { s } = makeScheduler([makeTodo(), makeTodo({ id: 2, timeOfDay: '11:00' })]);
    s.syncAll(); s.start();
    expect(timers).toHaveLength(1);
    expect(timers[0].at).toBe(at(10));
  });

  it('tick 到点弹出、markFired 并滚动排下一天', () => {
    const { s, rows } = makeScheduler([makeTodo()]);
    s.syncAll(); s.start();
    nowMs = at(10);
    s.tick();
    expect(notified).toHaveLength(1);
    expect(notified[0][0]).toMatchObject({ todoId: 1, overdue: false });
    expect(rows.filter(r => r.status === 'pending').map(r => r.fireAt))
      .toContain(at(10) + 86_400_000); // 次日 10:00
  });

  it('start 补发睡眠期间过期项并标 overdue', () => {
    const { s } = makeScheduler([makeTodo()]);
    s.syncAll();
    nowMs = at(15); // 睡了很久，10:00 已过
    s.start();
    expect(notified).toHaveLength(1);
    expect(notified[0][0].overdue).toBe(true);
  });

  it('pause 期间 tick 静默消费（fired 但不 notify）', () => {
    const { s, rows } = makeScheduler([makeTodo()]);
    s.syncAll(); s.pause(3_600_000); s.start();
    nowMs = at(10);
    s.tick();
    expect(notified).toHaveLength(0);
    expect(rows[0].status).toBe('fired');
  });

  it('syncFor 编辑：dismiss 旧 pending → 按新时刻重排', () => {
    const t = makeTodo();
    const { s, rows } = makeScheduler([t]);
    s.syncAll();
    t.timeOfDay = '14:00';
    s.syncFor(t);
    expect(rows[0].status).toBe('dismissed');
    expect(rows[1]).toMatchObject({ status: 'pending', fireAt: at(14) });
  });

  it('snooze 排入 now+minutes 的 snoozed 项', () => {
    const { s, rows } = makeScheduler([makeTodo()]);
    s.syncAll(); s.start();
    nowMs = at(10); s.tick();
    s.snooze(1, '2026-10-27', 10);
    const row = rows.find(r => r.status === 'snoozed')!;
    expect(row.fireAt).toBe(at(10) + 10 * 60_000);
  });

  it('一次性任务只排 dueDate 当天；过期不再排', () => {
    const t = makeTodo({ repeatType: 'none' });
    const { s, rows } = makeScheduler([t]);
    s.syncAll();
    nowMs = at(10); s.tick();
    s.syncAll(); // 再次同步不应排入 10-28（none 只有一天）
    expect(rows.filter(r => r.status === 'pending')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```powershell
npm run test:unit   # 预期 FAIL：Cannot find module scheduler
```

- [ ] **Step 3: 实现 `src/main/services/scheduler.ts`**

```ts
import type { ReminderDao, TodoDao } from '../db/dao';
import type { Todo, RecurrenceSpec } from '@shared/types';
import { dateToLocalMs, nextOccurrences, todayStr, addDays, dateToNum } from '@shared/recurrence';

export interface NotifyItem {
  todoId: number; occurrenceDate: string; title: string; timeOfDay: string | null; overdue: boolean;
}
export interface SchedulerDeps {
  now: () => number;
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  notify: (items: NotifyItem[]) => void;
}

const toSpec = (t: RecurrenceSpec): RecurrenceSpec => ({
  repeatType: t.repeatType, repeatInterval: t.repeatInterval, repeatWeekdays: t.repeatWeekdays,
  monthlyMode: t.monthlyMode, monthlyDay: t.monthlyDay,
  monthlyWeekday: t.monthlyWeekday, monthlyWhich: t.monthlyWhich,
});

export class Scheduler {
  private timer: unknown = null;
  private pausedUntil = 0;

  constructor(private rem: ReminderDao, private todos: TodoDao, private deps: SchedulerDeps) {}

  start(): void {
    const due = this.rem.listExpired(this.deps.now());
    if (due.length) this.deliver(due);
    this.arm();
  }

  syncAll(): void {
    for (const t of this.todos.listActive()) this.enqueueFor(t);
    this.arm();
  }

  syncFor(todo: Todo): void {
    this.rem.dismissFor(todo.id);
    this.enqueueFor(todo);
    this.arm();
  }

  snooze(todoId: number, date: string, minutes: number): void {
    this.rem.insertSnoozed(todoId, date, this.deps.now() + minutes * 60_000);
    this.arm();
  }

  pause(ms: number): void { this.pausedUntil = this.deps.now() + ms; }

  tick(): void {
    const due = this.rem.listExpired(this.deps.now());
    if (due.length) {
      this.deliver(due);
      // 触发过的任务滚动排下一期（规格 §3.3）
      for (const todoId of new Set(due.map(r => r.todoId))) {
        const t = this.todos.listActive().find(x => x.id === todoId);
        if (t) this.enqueueFor(t);
      }
    }
    this.arm();
  }

  /** 单指针：永远只排一个 timer（规格 §4.1 规则1） */
  private arm(): void {
    if (this.timer) { this.deps.clearTimer(this.timer); this.timer = null; }
    const next = this.rem.nextPending(this.deps.now());
    if (!next) return;
    this.timer = this.deps.setTimer(() => this.tick(), Math.max(1_000, next.fireAt - this.deps.now()));
  }

  private deliver(due: ReturnType<ReminderDao['listExpired']>): void {
    this.rem.markFired(due.map(r => r.id)); // 先消费：暂停/失败都不重复投递
    if (this.deps.now() < this.pausedUntil) return;
    const today = todayStr(this.deps.now());
    const active = this.todos.listActive();
    this.deps.notify(due.map(r => {
      const t = active.find(x => x.id === r.todoId);
      return {
        todoId: r.todoId, occurrenceDate: r.occurrenceDate,
        title: t?.title ?? '任务', timeOfDay: t?.timeOfDay ?? null,
        overdue: r.occurrenceDate < today || dateToLocalMs(r.occurrenceDate, t?.timeOfDay ?? '00:00') < this.deps.now(),
      };
    }));
  }

  /** 为任务排"今天或未来第一个尚未过点的发生日"（规格 §3.3） */
  private enqueueFor(todo: Todo): void {
    if (!todo.timeOfDay || todo.completedAt != null) return;
    const today = todayStr(this.deps.now());
    const anchor = todo.startDate ?? todo.dueDate;
    if (!anchor) return;

    let fireDate: string | undefined;
    if (todo.repeatType === 'none') {
      if (dateToNum(anchor) < dateToNum(today)) return;      // 已过期的一次性不再排
      fireDate = anchor;
    } else {
      // 今天（若时刻未到）或之后的第一个发生日
      const inToday = this.occursToday(todo, anchor, today);
      fireDate = inToday && dateToLocalMs(today, todo.timeOfDay) > this.deps.now()
        ? today
        : nextOccurrences(toSpec(todo), anchor, today, 1)[0];
    }
    if (!fireDate) return;
    this.rem.insertPending(todo.id, fireDate, dateToLocalMs(fireDate, todo.timeOfDay));
  }

  private occursToday(todo: Todo, anchor: string, today: string): boolean {
    const spec = toSpec(todo);
    if (dateToNum(anchor) > dateToNum(today)) return false;
    if (spec.repeatType === 'none') return todo.startDate === today || todo.dueDate === today;
    return nextOccurrences(spec, anchor, addDays(today, -1), 1)[0] === today;
  }
}
```

- [ ] **Step 4: 运行确认通过**

```powershell
npm run test:unit   # 预期全部 PASS
```

- [ ] **Step 5: Commit**

```powershell
git add src/main/services/scheduler.ts tests/unit/scheduler.test.ts
git commit -m "feat(scheduler): single-pointer reminder queue with pause/snooze/backfill"
```

---

## Task 6: IPC 契约 + preload 桥 + 主进程 handler

**Files:**
- Create: `src/shared/ipc.ts`
- Create: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`（覆写模板）
- Create: `src/renderer/src/env.d.ts`
- Create: `src/renderer/src/lib/ipc.ts`

**Interfaces:**
- Consumes: `TodoService`（Task 4）、`Scheduler`（Task 5）、`SettingsDao`（Task 3）
- Produces:
  - `Ipc` 通道常量对象（清单见下）与 `R<T>` / `ok()` / `fail()` 信封
  - `Api` 接口 = renderer 可用的完整 `window.api` 形状
  - 主进程 `registerIpc(deps: IpcDeps): void`
  - `IpcDeps`：`{ todoService, scheduler, settingsDao, windows: WindowOps, onHotkeyChange(acc): boolean }`
  - `WindowOps`（由 Task 7 的 AppWindowController 实现）：`broadcastChanged()`、`onChangedBroadcast(cb): () => void`、`minimize()`、`maximizeToggle()`、`hideToTray()`、`hideWindow(wc)`、`closeQuickAdd()`、`openEditorFromQuickAdd(title)`、`focusTodo(todoId, date)`、`showMain()`

通道清单：

```
todos:list / todos:create / todos:update / todos:delete / todos:complete /
todos:setStatus / todos:snooze / todos:preview / todos:list-all
settings:get / settings:set / autostart:get / autostart:set / hotkey:set / notify:test
win:minimize / win:maximize-toggle / win:hide / win:self-hide / win:close-quickadd / win:open-editor
event:data-changed (send) / event:show-main (send) / event:quickadd-focus-input (send)
```

- [ ] **Step 1: 定义 `src/shared/ipc.ts`**

```ts
import type { Todo, TodoDraft, OccurrenceItem, OccurrenceQuery, OccurrenceStatus } from './types';

export const Ipc = {
  TodosList: 'todos:list',
  TodosListAll: 'todos:list-all',
  TodosCreate: 'todos:create',
  TodosUpdate: 'todos:update',
  TodosDelete: 'todos:delete',
  TodosComplete: 'todos:complete',
  TodosSetStatus: 'todos:setStatus',
  TodosSnooze: 'todos:snooze',
  TodosPreview: 'todos:preview',
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  AutostartGet: 'autostart:get',
  AutostartSet: 'autostart:set',
  HotkeySet: 'hotkey:set',
  NotifyTest: 'notify:test',
  WinMinimize: 'win:minimize',
  WinMaximizeToggle: 'win:maximize-toggle',
  WinHide: 'win:hide',
  WinSelfHide: 'win:self-hide',
  WinCloseQuickAdd: 'win:close-quickadd',
  WinOpenEditor: 'win:open-editor',
  EventDataChanged: 'event:data-changed',
  EventShowMain: 'event:show-main',
  EventQuickAddFocusInput: 'event:quickadd-focus-input',
} as const;

export type R<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
export const ok = <T>(data: T): R<T> => ({ ok: true, data });
export const fail = (code: string, message: string): R<never> => ({ ok: false, code, message });

export interface ShowMainPayload {
  focusTodo?: { todoId: number; date: string };
  quickAddDraft?: string;   // 快添窗 Ctrl+Enter 预填标题
}

export interface Api {
  todos: {
    list(range: OccurrenceQuery): Promise<OccurrenceItem[]>;
    listAll(status: 'all' | 'open' | 'done'): Promise<Todo[]>;
    create(draft: TodoDraft): Promise<Todo>;
    update(id: number, patch: Partial<TodoDraft>): Promise<Todo | null>;
    remove(id: number): Promise<void>;
    complete(todoId: number, date?: string): Promise<void>;
    setStatus(todoId: number, date: string, status: OccurrenceStatus): Promise<void>;
    snooze(todoId: number, date: string, minutes: number): Promise<void>;
    preview(arg: { draft: TodoDraft; todoId?: number }): Promise<string[]>;
  };
  settings: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
  };
  autostart: { get(): Promise<boolean>; set(enabled: boolean): Promise<void> };
  hotkey: { set(accelerator: string): Promise<void> };
  notifyTest(): Promise<void>;
  win: {
    minimize(): Promise<void>;
    maximizeToggle(): Promise<void>;
    hideToTray(): Promise<void>;
    selfHide(): Promise<void>;
    closeQuickAdd(): Promise<void>;
    openEditor(title: string): Promise<void>;
  };
  onDataChanged(cb: () => void): () => void;
  onShowMain(cb: (p: ShowMainPayload) => void): () => void;
  onQuickAddFocusInput(cb: () => void): () => void;
}
```

- [ ] **Step 2: 主进程 `src/main/ipc.ts`**

```ts
import { ipcMain, app, Notification } from 'electron';
import { Ipc, ok, fail } from '@shared/ipc';
import type { TodoService } from './services/todo-service';
import type { Scheduler } from './services/scheduler';
import type { SettingsDao } from './db/dao';
import type { WindowOps } from './windows';
import type { TodoDraft, OccurrenceQuery, OccurrenceStatus } from '@shared/types';

export interface IpcDeps {
  todoService: TodoService;
  scheduler: Scheduler;
  settingsDao: SettingsDao;
  windows: WindowOps;
  onHotkeyChange: (acc: string) => boolean;
}

const wrap = (channel: string, fn: (...args: any[]) => any) => {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return ok(await fn(...args));
    } catch (err: any) {
      // 结构化错误：渲染层 Sonner 红 toast 展示 message（规格 §6）
      return fail(err?.code ?? 'INTERNAL', err?.message ?? String(err));
    }
  });
};

/** 需要 invoke 事件上下文（如 e.sender）的通道专用；宽 any 签名会让事件被吞掉且 typecheck 不拦 */
const wrapEv = (channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: any[]) => any) => {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      return ok(await fn(e, ...args));
    } catch (err: any) {
      return fail(err?.code ?? 'INTERNAL', err?.message ?? String(err));
    }
  });
};

export function registerIpc(deps: IpcDeps): void {
  const { todoService, scheduler, settingsDao, windows, dataDir } = deps;

  wrap(Ipc.TodosList, (q: OccurrenceQuery) => todoService.list(q.from, q.to));
  wrap(Ipc.TodosListAll, (status: 'all' | 'open' | 'done') => todoService.listAll(status));
  wrap(Ipc.TodosCreate, (draft: TodoDraft) => {
    const t = todoService.create(draft);
    scheduler.syncFor(t);           // 规格 §4：写操作立即重排提醒
    windows.broadcastChanged();
    return t;
  });
  wrap(Ipc.TodosUpdate, (id: number, patch: Partial<TodoDraft>) => {
    const t = todoService.update(id, patch);
    if (t) { scheduler.syncFor(t); windows.broadcastChanged(); }
    return t;
  });
  wrap(Ipc.TodosDelete, (id: number) => {
    todoService.remove(id);          // FK 级联清理 reminders/occurrence_states
    scheduler.syncAll();             // 全量重排兜底（成本可忽略）
    windows.broadcastChanged();
  });
  wrap(Ipc.TodosComplete, (id: number, date?: string) => {
    todoService.complete(id, date);
    const t = todoService.getById(id);
    if (t) scheduler.syncFor(t);     // 完成后排下一期
    windows.broadcastChanged();
  });
  wrap(Ipc.TodosSetStatus, (id: number, date: string, status: OccurrenceStatus) => {
    todoService.setStatus(id, date, status);
    const t = todoService.getById(id);
    if (t) scheduler.syncFor(t);
    windows.broadcastChanged();
  });
  wrap(Ipc.TodosSnooze, (id: number, date: string, minutes: number) => {
    scheduler.snooze(id, date, minutes);
  });
  wrap(Ipc.TodosPreview, (arg: { draft: TodoDraft; todoId?: number }) =>
    todoService.preview(arg.draft, 5, arg.todoId));

  wrap(Ipc.SettingsGet, (key: string) => settingsDao.get(key));
  wrap(Ipc.SettingsSet, (key: string, value: unknown) => settingsDao.set(key, value));
  wrap(Ipc.AutostartGet, () => app.getLoginItemSettings().openAtLogin);
  wrap(Ipc.AutostartSet, (enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? ['--hidden'] : [] });
    settingsDao.set('autostart', enabled);
  });
  wrap(Ipc.HotkeySet, (acc: string) => {
    if (!deps.onHotkeyChange(acc)) {
      throw Object.assign(new Error('快捷键注册失败（被占用或格式无效），已保留原设置'), { code: 'HOTKEY_CONFLICT' });
    }
    settingsDao.set('quickadd_shortcut', acc);
  });
  wrap(Ipc.NotifyTest, () => {
    if (!Notification.isSupported()) {
      throw Object.assign(new Error('系统通知不可用，请到 Windows 设置 → 通知 中开启本应用权限'), { code: 'NOTIFY_UNSUPPORTED' });
    }
    new Notification({ title: 'WhchemTodo', body: '这是一条测试通知' }).show();
  });

  wrap(Ipc.WinMinimize, () => windows.minimize());
  wrap(Ipc.WinMaximizeToggle, () => windows.maximizeToggle());
  wrap(Ipc.WinHide, () => windows.hideToTray());
  wrapEv(Ipc.WinSelfHide, (e) => windows.hideWindow(e.sender));
  wrap(Ipc.WinCloseQuickAdd, () => windows.closeQuickAdd());
  wrap(Ipc.WinOpenEditor, (title: string) => windows.openEditorFromQuickAdd(title));
}
```

**注**：`todoService.listAll(status)` 为 Task 4 服务补一个转发方法：

```ts
listAll(status: 'all' | 'open' | 'done'): Todo[] { return this.todos.listAll(status); }
```

- [ ] **Step 3: preload `src/preload/index.ts`（覆写模板）**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { Ipc, type Api, type R, type ShowMainPayload } from '@shared/ipc';

class IpcError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const env = (await ipcRenderer.invoke(channel, ...args)) as R<T>;
  if (!env.ok) throw new IpcError(env.code, env.message);
  return env.data;
}

function on(channel: string, cb: (...args: any[]) => void): () => void {
  const listener = (_e: unknown, ...args: any[]) => cb(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: Api = {
  todos: {
    list: (q) => call(Ipc.TodosList, q),
    listAll: (s) => call(Ipc.TodosListAll, s),
    create: (d) => call(Ipc.TodosCreate, d),
    update: (id, p) => call(Ipc.TodosUpdate, id, p),
    remove: (id) => call(Ipc.TodosDelete, id),
    complete: (id, date) => call(Ipc.TodosComplete, id, date),
    setStatus: (id, date, s) => call(Ipc.TodosSetStatus, id, date, s),
    snooze: (id, date, m) => call(Ipc.TodosSnooze, id, date, m),
    preview: (a) => call(Ipc.TodosPreview, a),
  },
  settings: {
    get: (k) => call(Ipc.SettingsGet, k),
    set: (k, v) => call(Ipc.SettingsSet, k, v),
  },
  autostart: {
    get: () => call(Ipc.AutostartGet),
    set: (v) => call(Ipc.AutostartSet, v),
  },
  hotkey: { set: (a) => call(Ipc.HotkeySet, a) },
  notifyTest: () => call(Ipc.NotifyTest),
  win: {
    minimize: () => call(Ipc.WinMinimize),
    maximizeToggle: () => call(Ipc.WinMaximizeToggle),
    hideToTray: () => call(Ipc.WinHide),
    selfHide: () => call(Ipc.WinSelfHide),
    closeQuickAdd: () => call(Ipc.WinCloseQuickAdd),
    openEditor: (t) => call(Ipc.WinOpenEditor, t),
  },
  onDataChanged: (cb) => on(Ipc.EventDataChanged, cb),
  onShowMain: (cb) => on(Ipc.EventShowMain, (p: ShowMainPayload) => cb(p)),
  onQuickAddFocusInput: (cb) => on(Ipc.EventQuickAddFocusInput, cb),
};

contextBridge.exposeInMainWorld('api', api);
```

- [ ] **Step 4: 渲染层类型声明 `src/renderer/src/env.d.ts`**

```ts
import type { Api } from '@shared/ipc';

declare global {
  interface Window { api: Api }
}
export {};
```

模板自带的 `src/preload/index.d.ts` 若与之冲突（声明 `window.api` 为模板形状），删除模板的 electronApi 声明，只保留本文件。

- [ ] **Step 5: 类型检查**

```powershell
npm run db:node
npx vitest run                      # Task 2-5 测试全部保持 PASS
npm run typecheck                   # 模板自带 typecheck script；预期无错误
npm run db:electron
```

- [ ] **Step 6: Commit**

```powershell
git add src/shared/ipc.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/env.d.ts src/main/services/todo-service.ts
git commit -m "feat(ipc): typed channel contract, envelope handlers and preload bridge"
```

---

## Task 7: 主进程装配（窗口 / 托盘 / 单实例 / 自启 / 异常兜底）

**Files:**
- Create: `src/main/windows.ts`（AppWindowController + TrayManager，单文件避免循环 import）
- Create: `src/main/notify.ts`
- Modify: `src/main/index.ts`（覆写模板）

**Interfaces:**
- Consumes: `openDb`（Task 3）、四 DAO（Task 3）、`TodoService`（Task 4）、`Scheduler`（Task 5）、`registerIpc` 与 `WindowOps`（Task 6）
- Produces:
  - `AppWindowController implements WindowOps`：`createMain(hidden: boolean)`、`showMain(payload?)`、`showQuickAdd()`、`focusTodo(id, date)`、`broadcastChanged()`、`minimize/maximizeToggle/hideToTray/hideWindow/closeQuickAdd/openEditorFromQuickAdd`
  - `TrayManager`：`setCount(n)`、`destroy()`
  - `dispatchNotify(items, onClick)`、`isNotifySupported()`

- [ ] **Step 1: `src/main/notify.ts`**

```ts
import { Notification } from 'electron';
import type { NotifyItem } from './services/scheduler';

export const isNotifySupported = () => Notification.isSupported();

/** 规格 §6：多条过期合并为一条汇总通知，避免轰炸 */
export function dispatchNotify(items: NotifyItem[], onClick: (item: NotifyItem) => void): void {
  if (!items.length || !isNotifySupported()) return; // 权限关闭：fired 已标记，设置页另出警示
  const build = (title: string, body: string, clickItem: NotifyItem) => {
    const n = new Notification({ title, body });
    n.on('click', () => onClick(clickItem));
    n.on('failed', (_e, err) => console.warn('[notify] failed:', err));
    n.show();
  };
  if (items.length === 1) {
    const it = items[0];
    build(
      `${it.overdue ? '⚠ 已过期 · ' : ''}${it.title}`,
      it.timeOfDay ? `提醒时间 ${it.timeOfDay}` : '定时提醒',
      it,
    );
  } else {
    const first = items[0];
    build(`⚠ ${items.length} 条任务已过期`, items.map(i => i.title).join('、').slice(0, 120), first);
  }
}
```

- [ ] **Step 2: `src/main/windows.ts`**

```ts
import { app, BrowserWindow, Menu, Tray, nativeImage, screen, type WebContents } from 'electron';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { Ipc, type ShowMainPayload } from '@shared/ipc';
import type { WindowOps } from './ipc';

const QUICK_W = 560, QUICK_H = 120;

export class AppWindowController implements WindowOps {
  private main: BrowserWindow | null = null;
  private quickAdd: BrowserWindow | null = null;
  private quitting = false;

  constructor() {
    app.on('before-quit', () => { this.quitting = true; });
  }

  private loadWindow(win: BrowserWindow, query?: string): void {
    const url = process.env['ELECTRON_RENDERER_URL'];
    if (url) win.loadURL(query ? `${url}?${query}` : url);
    else win.loadFile(join(__dirname, '../renderer/index.html'), query ? { search: query } : undefined);
  }

  createMain(hidden: boolean): BrowserWindow {
    this.main = new BrowserWindow({
      width: 1200, height: 750, minWidth: 960, minHeight: 600,
      show: false, frame: false, titleBarStyle: 'hidden',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    this.loadWindow(this.main);
    this.main.once('ready-to-show', () => { if (!hidden) this.main?.show(); });
    // 规格 §4.2：关窗 = 隐藏到托盘（退出只走托盘菜单），首次气泡提示
    this.main.on('close', (e) => {
      if (!this.quitting) {
        e.preventDefault();
        this.main?.hide();
        if (!store_bubbleShown()) {
          store_setBubbleShown();
          TrayManager.instance?.tray.displayBalloon({
            title: 'WhchemTodo 在后台运行',
            content: '提醒将继续送达。彻底退出请右键托盘图标 → 退出。',
          });
        }
      }
    });
    this.main.on('render-process-gone', () => this.main?.webContents.reload()); // 规格 §6
    this.main.setMenu(null);
    return this.main;
  }

  getMainWindow(): BrowserWindow | null { return this.main; }
  showMain(payload?: ShowMainPayload): void {
    if (!this.main || this.main.isDestroyed()) this.createMain(false);
    if (this.main!.isMinimized()) this.main!.restore();
    this.main!.show();
    this.main!.focus();
    if (payload) this.main!.webContents.send(Ipc.EventShowMain, payload);
  }

  showQuickAdd(): void {
    if (!this.quickAdd || this.quickAdd.isDestroyed()) {
      this.quickAdd = new BrowserWindow({
        width: QUICK_W, height: QUICK_H, frame: false, resizable: false,
        alwaysOnTop: true, skipTaskbar: true, show: false, maximizable: false, minimizable: false,
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          contextIsolation: true, nodeIntegration: false, sandbox: true,
        },
      });
      this.loadWindow(this.quickAdd, 'win=quickadd');
      this.quickAdd.once('ready-to-show', () => this.quickAdd!.show());
      this.quickAdd.on('blur', () => { if (!this.quickAdd!.isDestroyed()) this.quickAdd!.hide(); }); // 规格 §5.6：失焦即隐藏
      this.quickAdd.on('closed', () => { this.quickAdd = null; });
    } else {
      // 唤起位置：光标所在显示器居中（规格 §5.6）
      const cursor = screen.getCursorScreenPoint();
      const d = screen.getDisplayNearestPoint(cursor);
      this.quickAdd.setPosition(
        Math.round(d.bounds.x + (d.bounds.width - QUICK_W) / 2),
        Math.round(d.bounds.y + (d.bounds.height - QUICK_H) / 2),
      );
      this.quickAdd.show();
      this.quickAdd.focus();
    }
    this.quickAdd.webContents.send(Ipc.EventQuickAddFocusInput);
  }

  // ---- WindowOps 实现（Task 6 依赖）----
  private emitter = new EventEmitter();
  broadcastChanged(): void {
    this.main?.webContents.send(Ipc.EventDataChanged);
    this.emitter.emit('changed'); // 主进程本地订阅（托盘计数刷新）
  }
  onChangedBroadcast(cb: () => void): () => void {
    this.emitter.on('changed', cb);
    return () => this.emitter.off('changed', cb);
  }
  minimize(): void { this.main?.minimize(); }
  maximizeToggle(): void {
    if (!this.main) return;
    this.main.isMaximized() ? this.main.unmaximize() : this.main.maximize();
  }
  hideToTray(): void { this.main?.hide(); }
  hideWindow(wc: WebContents): void {
    if (this.quickAdd && wc === this.quickAdd.webContents) this.quickAdd.hide();
  }
  closeQuickAdd(): void { this.quickAdd?.hide(); }
  openEditorFromQuickAdd(title: string): void {
    this.showMain({ quickAddDraft: title });   // 主窗渲染层监听 EventShowMain 打开预填对话框
    this.quickAdd?.hide();
  }
  focusTodo(todoId: number, date: string): void {
    this.showMain({ focusTodo: { todoId, date } });
  }
}

// 首次气泡只提示一次（内存级即可，规格 §4.2；重启后再提示一次可接受）
let bubbleShown = false;
const store_bubbleShown = () => bubbleShown;
const store_setBubbleShown = () => { bubbleShown = true; };

export class TrayManager {
  static instance: TrayManager | null = null;
  readonly tray: Tray;
  private count = 0;

  constructor(private win: AppWindowController, onPause: () => void) {
    const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
      .resize({ width: 16, height: 16 });
    this.tray = new Tray(icon);
    this.tray.setToolTip('WhchemTodo');
    this.tray.on('click', () => this.win.showMain());
    this.tray.on('double-click', () => this.win.showMain());
    TrayManager.instance = this;
    this.refresh();
  }

  /** 规格 §4.2：'今日待办 n 条' 禁用项随队列变动实时刷新 */
  setCount(n: number): void { this.count = n; this.refresh(); }

  private refresh(): void {
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开主窗口', click: () => this.win.showMain() },
      { label: `今日待办：${this.count} 条`, enabled: false },
      { type: 'separator' },
      { label: '暂停所有提醒 1 小时', click: onPause },
      { type: 'separator' },
      { label: '退出 WhchemTodo', click: () => app.quit() },
    ]));
  }

  destroy(): void { this.tray.destroy(); TrayManager.instance = null; }
}
```

- [ ] **Step 3: 主入口 `src/main/index.ts`（覆写模板）**

```ts
import { app, dialog, powerMonitor } from 'electron';
import { join } from 'node:path';
import log from 'electron-log/main';
import { openDb } from './db';
import { TodoDao, OccurrenceDao, ReminderDao, SettingsDao } from './db/dao';
import { TodoService } from './services/todo-service';
import { Scheduler } from './services/scheduler';
import { registerIpc } from './ipc';
import { AppWindowController, TrayManager } from './windows';
import { dispatchNotify } from './notify';
import { registerQuickAddShortcut, unregisterAllShortcuts, DEFAULT_HOTKEY } from './shortcuts';
import { todayStr } from '@shared/recurrence';

log.initialize({ transport: 'console' });
log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024; // 规格 §6：滚动由 maxSize 限制

// 规格 §4.2：单实例锁；二次启动唤起已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  bootstrap().catch(err => log.error('[boot] failed', err));
}

const DATA_DIR = () => join(app.getPath('appData'), 'whchem-todo');
let windows: AppWindowController | null = null;

async function bootstrap(): Promise<void> {
  const hidden = process.argv.includes('--hidden'); // 自启带参 → 静默进托盘

  // 异常兜底（规格 §6）：托盘应用不闪退；60s 内 5 次才弹窗询问
  const errStamps: number[] = [];
  process.on('uncaughtException', (e) => {
    log.error('[uncaught]', e);
    const now = Date.now();
    errStamps.push(now);
    while (errStamps.length && now - errStamps[0] > 60_000) errStamps.shift();
    if (errStamps.length >= 5) {
      errStamps.length = 0;
      dialog.showMessageBox({
        type: 'error', title: 'WhchemTodo 连续异常',
        message: `最近 1 分钟内发生 ${5} 次未处理异常。\n日志：${log.transports.file.getFile().path}`,
      });
    }
  });
  process.on('unhandledRejection', (e) => log.error('[unhandledRejection]', e));

  await app.whenReady();

  // 数据库：损坏自动恢复 + 对话框告知（规格 §6）
  const { db, recovered } = openDb(DATA_DIR());
  if (recovered) {
    dialog.showMessageBoxSync({
      type: 'warning', title: '数据库已恢复',
      message: '检测到数据库文件损坏，已重建空数据库。\n损坏文件保留为同目录下的 todo.db.corrupt.<时间戳>，可尝试手动恢复。',
    });
  }

  const todosDao = new TodoDao(db);
  const occDao = new OccurrenceDao(db);
  const remDao = new ReminderDao(db);
  const settingsDao = new SettingsDao(db);
  const todoService = new TodoService(todosDao, occDao);
  windows = new AppWindowController();

  const scheduler = new Scheduler(remDao, todosDao, {
    now: () => Date.now(),
    setTimer: (cb, ms) => setTimeout(cb, ms),
    clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
    // 点击通知唤起主窗并定位任务（规格 §4.2）
    notify: (items) => dispatchNotify(items, (i) => windows!.focusTodo(i.todoId, i.occurrenceDate)),
  });

  const refreshTrayCount = () => {
    const today = todayStr(Date.now());
    tray?.setCount(todoService.list(today, today).filter(i => i.state === 'active').length);
  };

  windows.createMain(hidden);

  const tray = new TrayManager(windows, () => {
    scheduler.pause(60 * 60 * 1000);
    dialog.showMessageBoxSync({ type: 'info', title: '提醒已暂停', message: '1 小时内的提醒将静默处理，过期项在恢复后补发。' });
  });

  registerIpc({
    todoService, scheduler, settingsDao,
    windows,
    onHotkeyChange: (acc) => registerQuickAddShortcut(acc, () => windows!.showQuickAdd()),
  });

  // 全局热键（Task 8 实现 shortcuts.ts）
  const acc = settingsDao.get<string>('quickadd_shortcut') ?? DEFAULT_HOTKEY;
  if (!registerQuickAddShortcut(acc, () => windows!.showQuickAdd())) {
    registerQuickAddShortcut(DEFAULT_HOTKEY, () => windows!.showQuickAdd()); // 规格 §6：回退默认
  }

  // 调度：从库恢复 pending（规格 §3.3 重启可靠性）
  scheduler.syncAll();
  scheduler.start();
  refreshTrayCount();

  // 自启意图与实际状态对齐（规格 §4.2：真相以 getLoginItemSettings 为准）
  const wantAuto = settingsDao.get<boolean>('autostart') ?? false;
  if (wantAuto !== app.getLoginItemSettings().openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: wantAuto, args: wantAuto ? ['--hidden'] : [] });
  }

  // 数据变更 → 托盘计数刷新（broadcastChanged 同时触发本地回调）
  windows.onChangedBroadcast(refreshTrayCount);

  // 睡眠唤醒全量重排 + 补发（规格 §4.1 规则2）
  powerMonitor.on('resume', () => { scheduler.start(); refreshTrayCount(); });

  app.on('second-instance', () => windows?.showMain());
  app.on('window-all-closed', () => { /* 托盘应用：不退出 */ });
  app.on('before-quit', () => { unregisterAllShortcuts(); tray.destroy(); db.close(); });
}
```

- [ ] **Step 4: 占位 shortcuts.ts（Task 8 完整实现，此处先提供可编译占位）**

```ts
import { globalShortcut } from 'electron';

export const DEFAULT_HOTKEY = 'Ctrl+Alt+A';

export function registerQuickAddShortcut(_acc: string, _cb: () => void): boolean { return true; }
export function unregisterAllShortcuts(): void { globalShortcut.unregisterAll(); }
```

- [ ] **Step 5: 手动验证**

```powershell
npm run db:electron
npm run dev
```

- 主窗显示 → 点关闭 → 窗口隐藏、托盘仍在、进程不退出（任务管理器确认）
- 双击托盘 → 主窗恢复；托盘"暂停所有提醒 1 小时"→ 弹提示框
- 托盘"退出"→ 进程干净结束
- `%APPDATA%\whchem-todo\todo.db` 与 `logs\main.log` 存在
- 再开一个 `npm run dev` 实例 → 不产生第二进程，已有窗口被唤起

- [ ] **Step 6: Commit**

```powershell
git add src/main/windows.ts src/main/notify.ts src/main/index.ts src/main/shortcuts.ts src/main/ipc.ts
git commit -m "feat(main): window controller, tray, single instance, autostart and boot assembly"
```

---

## Task 8: 全局热键完整实现 + 快添窗前端

**Files:**
- Modify: `src/main/shortcuts.ts`（替换占位实现）
- Create: `src/renderer/src/views/QuickAddView.tsx`
- Modify: `src/renderer/src/App.tsx`（`?win=quickadd` 分叉）

**Interfaces:**
- Consumes: `window.api.todos.create`、`window.api.win.{closeQuickAdd, selfHide, openEditor}`、`onQuickAddFocusInput`（Task 6）、`AppWindowController.showQuickAdd`（Task 7）
- Produces: `registerQuickAddShortcut(acc, cb): boolean`（真实注册）、`unregisterAllShortcuts()`

- [ ] **Step 1: 实现 `src/main/shortcuts.ts`（覆盖占位）**

```ts
import { globalShortcut } from 'electron';
import log from 'electron-log/main';

export const DEFAULT_HOTKEY = 'Ctrl+Alt+A';

let current: string | null = null;
let currentCb: (() => void) | null = null;

/** 返回 false = 注册失败（冲突/非法），保留原注册不动（规格 §6） */
export function registerQuickAddShortcut(acc: string, cb: () => void): boolean {
  if (acc === current && cb === currentCb) return true;
  const previous = current;
  if (previous) globalShortcut.unregister(previous);
  let registered = false;
  try {
    registered = globalShortcut.register(acc, cb);
  } catch (e) {
    log.warn('[shortcut] invalid accelerator', acc, e);
  }
  if (!registered) {
    // 回滚：恢复原注册
    if (previous && currentCb) globalShortcut.register(previous, currentCb);
    return false;
  }
  current = acc;
  currentCb = cb;
  log.info('[shortcut] registered', acc);
  return true;
}

export function unregisterAllShortcuts(): void {
  globalShortcut.unregisterAll();
  current = null;
  currentCb = null;
}
```

- [ ] **Step 2: `QuickAddView.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { todayStr } from '@shared/recurrence';
import type { TodoDraft } from '@shared/types';

const draftOf = (title: string): TodoDraft => ({
  title, notes: null, priority: 1,
  dueDate: todayStr(Date.now()), timeOfDay: null,
  repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
  monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  startDate: null, completedAt: null,
});

export default function QuickAddView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    return window.api.onQuickAddFocusInput(() => {
      if (inputRef.current) { inputRef.current.value = ''; inputRef.current.focus(); }
    });
  }, []);

  const close = () => window.api.win.closeQuickAdd();

  const submit = async (openEditor: boolean) => {
    const title = inputRef.current?.value.trim();
    if (!title || busy) { close(); return; }   // 空输入 = 直接关闭（规格 §5.6）
    setBusy(true);
    try {
      if (openEditor) await window.api.win.openEditor(title); // Ctrl+Enter → 主窗编辑对话框预填
      else await window.api.todos.create(draftOf(title));       // Enter → 今日、不提醒
      close();
    } finally { setBusy(false); }
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <input
        ref={inputRef}
        className="min-h-0 flex-1 bg-transparent px-6 text-2xl outline-none"
        placeholder={busy ? '保存中…' : '输入任务标题…'}
        disabled={busy}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void submit(e.ctrlKey || e.metaKey); }
          else if (e.key === 'Escape') { e.preventDefault(); close(); }
        }}
      />
      <div className="px-6 pb-3 text-xs text-muted-foreground">
        Enter 添加到今日 · Ctrl+Enter 详细编辑 · Esc 关闭
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `App.tsx` 路由分叉**

```tsx
import QuickAddView from './views/QuickAddView';
// MainShell 在 Task 9 提供；本任务期间用占位保持可编译：
const MainPlaceholder = () => <div className="p-8 text-muted-foreground">主窗口（Task 9 实现）</div>;

export default function App() {
  const isQuickAdd = new URLSearchParams(window.location.search).get('win') === 'quickadd';
  return isQuickAdd ? <QuickAddView /> : <MainPlaceholder />;
}
```

- [ ] **Step 4: 手动验证**

```powershell
npm run dev
```

- 任意前台应用（浏览器/资源管理器）下按 `Ctrl+Alt+A` → 小窗在当前光标显示器居中弹出、输入框自动聚焦
- 输入"买牛奶"回车 → 小窗隐藏；托盘双击开主窗（Console `await window.api.todos.list({from:'2026-10-27',to:'2026-10-27'})`）确认任务存在
- 再唤起输入"写周报"按 `Ctrl+Enter` → 主窗唤起（Task 10 后验证对话框预填）
- 空输入回车 / Esc / 点窗外 → 均直接隐藏不产生任务
- 设置一个已冲突热键（在 DevTools 执行 `await window.api.hotkey.set('Ctrl+Alt+A')` 两次后重启换 `F1`）验证注册失败不崩溃

- [ ] **Step 5: Commit**

```powershell
git add src/main/shortcuts.ts src/renderer/src/views/QuickAddView.tsx src/renderer/src/App.tsx
git commit -m "feat(quickadd): working global hotkey capture and quick-add window"
```

---

## Task 9: 渲染层基础（MainShell / Titlebar / Sidebar / Theme / 数据 hooks）

**Files:**
- Create: `src/renderer/src/views/MainShell.tsx`
- Create: `src/renderer/src/components/Titlebar.tsx`
- Create: `src/renderer/src/components/Sidebar.tsx`
- Create: `src/renderer/src/hooks/{useDataVersion,useTodos,useSettings}.ts`
- Create: `src/renderer/src/lib/theme.ts`
- Modify: `src/renderer/src/index.css`（shadcn CSS 变量 + dark 变体）
- Modify: `src/renderer/src/App.tsx`（占位替换为 MainShell）
- Run: `npx shadcn@latest add input select switch tabs dialog sheet popover calendar toggle-group checkbox badge tooltip dropdown-menu separator scroll-area sonner`

**Interfaces:**
- Consumes: `window.api`（Task 6）
- Produces:
  - `useDataVersion(): number` —— 主进程 `event:data-changed` 时自增，作为所有查询 useEffect 的依赖
  - `useTodos(from, to): { items: OccurrenceItem[]; error: string | null }`
  - `useSettings<K>(key, initial): [K, (v: K) => Promise<void>]`
  - `applyTheme(mode)` / `EditorState`（Task 10 的对话框状态形状）：`{ open: boolean; todo?: Todo; dueDate?: string; draftTitle?: string }`

- [ ] **Step 1: hooks**

```ts
// hooks/useDataVersion.ts
import { useEffect, useState } from 'react';
export function useDataVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => window.api.onDataChanged(() => setV(x => x + 1)), []);
  return v;
}
```

```ts
// hooks/useTodos.ts
import { useEffect, useState } from 'react';
import { useDataVersion } from './useDataVersion';
import type { OccurrenceItem } from '@shared/types';
export function useTodos(from: string, to: string) {
  const [items, setItems] = useState<OccurrenceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const version = useDataVersion();
  useEffect(() => {
    let alive = true;
    window.api.todos.list({ from, to })
      .then(r => { if (alive) { setItems(r); setError(null); } })
      .catch(e => { if (alive) setError(String(e?.message ?? e)); });
    return () => { alive = false; };
  }, [from, to, version]);
  return { items, error };
}
```

```ts
// hooks/useSettings.ts
import { useEffect, useState } from 'react';
export function useSettings<K>(key: string, initial: K) {
  const [value, setValue] = useState<K>(initial);
  useEffect(() => { void window.api.settings.get<K>(key).then(v => { if (v != null) setValue(v); }); }, [key]);
  const set = async (v: K) => { setValue(v); await window.api.settings.set(key, v); };
  return [value, set] as const;
}
```

- [ ] **Step 2: theme**

`src/renderer/src/index.css`（shadcn init 若已生成变量则跳过此步；否则手工加入标准 zinc 色系 `:root`/`.dark` 块）：

```css
@import "tailwindcss";

:root { --background: 0 0% 100%; --foreground: 240 10% 3.9%; --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%; --border: 240 5.9% 90%; --primary: 240 5.9% 10%;
  --primary-foreground: 0 0% 98%; --accent: 240 4.8% 95.9%; --ring: 240 5.9% 10%; }
.dark { --background: 240 10% 3.9%; --foreground: 0 0% 98%; --muted: 240 3.7% 15.9%;
  --muted-foreground: 240 5% 64.9%; --border: 240 3.7% 15.9%; --primary: 0 0% 98%;
  --primary-foreground: 240 5.9% 10%; --accent: 240 3.7% 15.9%; --ring: 240 4.9% 83.9%; }
```

注：Tailwind v4 需在 CSS 中用 `@theme inline` 映射以上变量到 `--color-background` 等，执行时按 `shadcn init` 实际产出为准（init 步骤会自动生成正确格式，此步仅在 init 输出缺失时手工补）。

```ts
// lib/theme.ts
export type ThemeMode = 'light' | 'dark' | 'system';
export function applyTheme(mode: ThemeMode): void {
  const dark = mode === 'dark'
    || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
```

- [ ] **Step 3: Titlebar（拖拽区 + 窗口按钮，规格 §5）**

```tsx
// components/Titlebar.tsx
const drag = { style: { WebkitAppRegion: 'drag' } as React.CSSProperties };
const noDrag = { style: { WebkitAppRegion: 'no-drag' } as React.CSSProperties };

export function Titlebar() {
  return (
    <div {...drag} className="flex h-9 shrink-0 items-center justify-end border-b border-border bg-background">
      <span className="me-auto ps-3 text-xs text-muted-foreground">WhchemTodo</span>
      <button {...noDrag} className="h-9 w-11 hover:bg-muted" onClick={() => void window.api.win.minimize()}>—</button>
      <button {...noDrag} className="h-9 w-11 hover:bg-muted" onClick={() => void window.api.win.maximizeToggle()}>▢</button>
      <button {...noDrag} className="h-9 w-11 hover:bg-destructive hover:text-white"
        onClick={() => void window.api.win.hideToTray()}>×</button>
    </div>
  );
}
```

- [ ] **Step 4: Sidebar**

```tsx
// components/Sidebar.tsx
import { cn } from '@/lib/utils';
export type NavKey = 'today' | 'calendar' | 'all' | 'settings';
const ITEMS: Array<[NavKey, string]> = [['today', '今日'], ['calendar', '日历'], ['all', '全部任务'], ['settings', '设置']];

export function Sidebar({ active, onChange }: { active: NavKey; onChange: (k: NavKey) => void }) {
  return (
    <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-border bg-muted/40 p-2">
      {ITEMS.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)}
          className={cn('rounded-md px-3 py-2 text-left text-sm hover:bg-muted',
            active === k && 'bg-background font-medium shadow-sm')}>
          {label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 5: MainShell（组装 + 全局对话框状态 + show-main 事件）**

```tsx
// views/MainShell.tsx
import { useEffect, useState } from 'react';
import { Titlebar } from '@/components/Titlebar';
import { Sidebar, type NavKey } from '@/components/Sidebar';
import { applyTheme } from '@/lib/theme';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { IpcError } from '@/lib/ipc-error';
import TodayView from './TodayView';
import CalendarView from './CalendarView';
import AllTasksView from './AllTasksView';
import SettingsView from './SettingsView';
import TaskEditDialog, { type EditorState } from '@/components/TaskEditDialog';
import type { ShowMainPayload } from '@shared/ipc';

export default function MainShell() {
  const [nav, setNav] = useState<NavKey>('today');
  const [editor, setEditor] = useState<EditorState>({ open: false });

  useEffect(() => {
    void window.api.settings.get<string>('theme').then(v => applyTheme((v as never) ?? 'system'));
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onMq = () => void window.api.settings.get<string>('theme')
      .then(v => { if ((v ?? 'system') === 'system') applyTheme('system'); });
    mq.addEventListener('change', onMq);

    const off = window.api.onShowMain((p: ShowMainPayload) => {
      if (p.quickAddDraft) setEditor({ open: true, draftTitle: p.quickAddDraft });
      else if (p.focusTodo) toast.info('已定位到提醒任务', { description: p.focusTodo.date });
    });
    return () => { mq.removeEventListener('change', onMq); off(); };
  }, []);

  // IPC 错误统一 toast（捕获 Api 调用 reject 的 IpcError）
  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => toast.error(String(e.reason?.message ?? e.reason));
    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <Titlebar />
      <div className="flex min-h-0 flex-1">
        <Sidebar active={nav} onChange={setNav} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          {nav === 'today' && <TodayView onEdit={t => setEditor({ open: true, todo: t })}
            onNew={() => setEditor({ open: true })} />}
          {nav === 'calendar' && <CalendarView onEdit={t => setEditor({ open: true, todo: t })}
            onNewOnDate={d => setEditor({ open: true, dueDate: d })} />}
          {nav === 'all' && <AllTasksView onEdit={t => setEditor({ open: true, todo: t })}
            onNew={() => setEditor({ open: true })} />}
          {nav === 'settings' && <SettingsView />}
        </main>
      </div>
      <TaskEditDialog state={editor} onClose={() => setEditor({ open: false })} />
      <Toaster position="top-center" richColors />
    </div>
  );
}
```

需要 `src/renderer/src/lib/ipc-error.ts`（与 preload 同形状，渲染侧判类型用）：

```ts
export class IpcError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
```

`App.tsx` 把占位替换为：`isQuickAdd ? <QuickAddView /> : <MainShell />`。

- [ ] **Step 6: 空壳视图占位文件**

`TodayView/CalendarView/AllTasksView/SettingsView/TaskEditDialog` 先各创建一个默认导出空组件（`export default function X(_: Record<string, unknown>) { return null; }`），保证编译通过；Task 10–14 逐个替换。`TaskEditDialog` 需导出 `EditorState` 类型（定义见 Task 10）。

- [ ] **Step 7: 验证 + Commit**

```powershell
npm run dev
# 主窗显示：自定义标题栏可拖动、按钮工作（最小化/最大化/关闭隐藏）；侧边栏可切换（内容暂空白）；
# Windows 切换深浅色 → 应用跟随
npm run typecheck
git add src/renderer/src
git commit -m "feat(renderer): app shell with custom titlebar, sidebar, theme and data hooks"
```

---

## Task 10: 任务编辑对话框 + RepeatField + 实时预览

**Files:**
- Create: `src/renderer/src/components/RepeatField.tsx`
- Modify: `src/renderer/src/components/TaskEditDialog.tsx`（替换空壳）

**Interfaces:**
- Consumes: `window.api.todos.{create,update,preview}`、shadcn `Dialog/Select/Popover/Calendar/ToggleGroup/Input/Textarea/Button`
- Produces: `EditorState`、`TaskEditDialog({ state, onClose })`

- [ ] **Step 1: `RepeatField.tsx`**

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Input } from '@/components/ui/input';
import type { RecurrenceSpec, RepeatType, MonthlyMode } from '@shared/types';

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export function RepeatField({ value, onChange }:
  { value: RecurrenceSpec; onChange: (v: RecurrenceSpec) => void }) {
  const set = (patch: Partial<RecurrenceSpec>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-2">
      <Select value={value.repeatType}
        onValueChange={(v) => {
          const rt = v as RepeatType;
          // 切换类型时重置子字段，避免脏数据（表单是规则唯一真相源，规格 §5.5）
          set(rt === 'weekly' ? { repeatType: rt, repeatWeekdays: [1] }
            : rt === 'monthly' ? { repeatType: rt, monthlyMode: value.monthlyMode ?? 'by_date', monthlyDay: value.monthlyDay ?? 1 }
            : rt === 'custom' ? { repeatType: rt, repeatInterval: 2 }
            : { repeatType: rt });
        }}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">不重复</SelectItem>
          <SelectItem value="daily">每天</SelectItem>
          <SelectItem value="weekly">每周</SelectItem>
          <SelectItem value="monthly">每月</SelectItem>
          <SelectItem value="custom">自定义间隔</SelectItem>
        </SelectContent>
      </Select>

      {value.repeatType === 'weekly' && (
        <ToggleGroup type="multiple" variant="outline" className="flex-wrap"
          value={(value.repeatWeekdays ?? []).map(String)}
          onValueChange={(v) => set({ repeatWeekdays: v.map(Number) })}>
          {WEEK_LABELS.map((l, i) => (
            <ToggleGroupItem key={i} value={String(i)} aria-label={`周${l}`}>周{l}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      {value.repeatType === 'monthly' && (
        <div className="space-y-2">
          <Select value={value.monthlyMode ?? 'by_date'}
            onValueChange={(v) => set({ monthlyMode: v as MonthlyMode })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="by_date">每月几号</SelectItem>
              <SelectItem value="by_weekday">每月第 N 个周几</SelectItem>
            </SelectContent>
          </Select>
          {(value.monthlyMode ?? 'by_date') === 'by_date' ? (
            <div className="flex items-center gap-2 text-sm">
              <span>每月</span>
              <Input type="number" min={1} max={31} className="w-20"
                value={value.monthlyDay ?? 1}
                onChange={e => set({ monthlyDay: Number(e.target.value) })} />
              <span>号（当月无该日则跳过）</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Select value={String(value.monthlyWhich ?? 1)}
                onValueChange={v => set({ monthlyWhich: Number(v) })}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map(n => (
                    <SelectItem key={n} value={String(n)}>{n === 5 ? '最后一个' : `第${'一二三四五'[n - 1]}个`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(value.monthlyWeekday ?? 1)}
                onValueChange={v => set({ monthlyWeekday: Number(v) })}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEK_LABELS.map((l, i) => <SelectItem key={i} value={String(i)}>周{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {value.repeatType === 'custom' && (
        <div className="flex items-center gap-2 text-sm">
          <span>每</span>
          <Input type="number" min={1} className="w-20" value={value.repeatInterval ?? 2}
            onChange={e => set({ repeatInterval: Number(e.target.value) })} />
          <span>天</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `TaskEditDialog.tsx`**

```tsx
// components/TaskEditDialog.tsx
import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { RepeatField } from './RepeatField';
import { todayStr } from '@shared/recurrence';
import type { EditorState } from './editor-state';
import type { Todo, TodoDraft, Priority } from '@shared/types';

export type { EditorState };

const emptyDraft = (dueDate: string): TodoDraft => ({
  title: '', notes: null, priority: 1, dueDate, timeOfDay: null,
  repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
  monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  startDate: null, completedAt: null,
});

const todoToDraft = (t: Todo): TodoDraft => {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = t;
  return rest;
};

export default function TaskEditDialog({ state, onClose }:
  { state: EditorState; onClose: () => void }) {
  const [draft, setDraft] = useState<TodoDraft>(emptyDraft(todayStr(Date.now())));
  const [dateOpen, setDateOpen] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 打开时重置表单（新建带预填 / 编辑带既有任务）
  useEffect(() => {
    if (!state.open) return;
    const base = state.todo ? todoToDraft(state.todo) : emptyDraft(state.dueDate ?? todayStr(Date.now()));
    setDraft(state.draftTitle ? { ...base, title: state.draftTitle } : base);
    setPreviews([]);
  }, [state]);

  // 防抖 300ms 调用主进程预览"下次出现"（规格 §5.5）
  useEffect(() => {
    if (!state.open || !draft.dueDate) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void window.api.todos.preview({ draft, todoId: state.todo?.id }).then(setPreviews).catch(() => setPreviews([]));
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [draft, state.open]);

  const canSave = draft.title.trim().length > 0 && !!draft.dueDate;

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const payload = { ...draft, title: draft.title.trim() };
      if (state.todo) {
        await window.api.todos.update(state.todo.id, payload);
        toast.success('任务已更新');
      } else {
        await window.api.todos.create(payload);
        toast.success('任务已创建');
      }
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? '保存失败');
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!state.todo) return;
    await window.api.todos.remove(state.todo.id);
    toast.success('任务已删除');
    onClose();
  };

  const dateValue = draft.dueDate ? new Date(draft.dueDate + 'T00:00:00') : undefined;
  const previewLine = previews.slice(0, 5)
    .map(d => `${['日','一','二','三','四','五','六'][new Date(d + 'T00:00:00').getDay()]} ${d.slice(5)}`)
    .join(' · ');

  return (
    <Dialog open={state.open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{state.todo ? '编辑任务' : '新建任务'}</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <Input placeholder="任务标题 *" value={draft.title}
            onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') void save(); }} />
          <Textarea placeholder="备注（可选）" rows={2} value={draft.notes ?? ''}
            onChange={e => setDraft(d => ({ ...d, notes: e.target.value || null }))} />

          <div className="flex gap-3">
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="flex-1 justify-start font-normal">
                  <CalendarIcon className="me-2 h-4 w-4" />
                  {dateValue ? format(dateValue, 'yyyy-MM-dd') : '选择日期 *'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={dateValue} autoFocus
                  onSelect={(d) => { if (d) { setDraft(x => ({ ...x, dueDate: format(d, 'yyyy-MM-dd') })); setDateOpen(false); } }} />
              </PopoverContent>
            </Popover>
            <Input type="time" className="w-32" value={draft.timeOfDay ?? ''}
              onChange={e => setDraft(d => ({ ...d, timeOfDay: e.target.value || null }))} />
            <Select value={String(draft.priority)}
              onValueChange={v => setDraft(d => ({ ...d, priority: Number(v) as Priority }))}>
              <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">低</SelectItem>
                <SelectItem value="1">中</SelectItem>
                <SelectItem value="2">高</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">提醒时刻留空 = 只显示在日历，不发送通知</p>

          <div>
            <p className="mb-2 text-sm font-medium">重复</p>
            <RepeatField value={draft} onChange={v => setDraft(d => ({ ...d, ...v }))} />
          </div>

          {previewLine && <p className="text-xs text-muted-foreground">下次出现：{previewLine}</p>}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {state.todo
            ? <Button variant="destructive" onClick={() => void remove()}>删除</Button>
            : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={() => void save()} disabled={!canSave || saving}>保存</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`components/editor-state.ts`（独立小文件，供 MainShell 与各视图共享）：

```ts
import type { Todo } from '@shared/types';
export interface EditorState {
  open: boolean;
  todo?: Todo;          // 编辑既有
  dueDate?: string;     // 新建时预填日期（日历 Sheet）
  draftTitle?: string;  // 快添窗 Ctrl+Enter 预填标题
}
```

依赖：`npm i date-fns lucide-react`（shadcn 组件 peer 已含 lucide；date-fns 供 Calendar 与格式化）。

- [ ] **Step 3: 验证**

`npm run dev` → 因视图尚未接对话框，用 DevTools Console 验证预览通道：

```js
await window.api.todos.preview({ title:'x', notes:null, priority:1, dueDate:'2026-10-27',
  timeOfDay:'10:00', repeatType:'monthly', repeatInterval:null, repeatWeekdays:null,
  monthlyMode:'by_date', monthlyDay:31, monthlyWeekday:null, monthlyWhich:null,
  startDate:'2026-10-27', completedAt:null })
// 期望：['2026-10-31','2026-11-30'... ] —— 注意 12-31、2027-01-31，2 月跳过；实际以展开引擎为准
```

- [ ] **Step 4: Commit**

```powershell
git add src/renderer/src/components/TaskEditDialog.tsx src/renderer/src/components/RepeatField.tsx src/renderer/src/components/editor-state.ts package.json package-lock.json
git commit -m "feat(renderer): task edit dialog with recurrence editor and live preview"
```

---

## Task 11: 今日视图

**Files:**
- Create: `src/renderer/src/components/TaskItem.tsx`
- Modify: `src/renderer/src/views/TodayView.tsx`（替换空壳）

**Interfaces:**
- Consumes: `useTodos`、`TaskEditDialog` 回调上提（props `onEdit(todo: Todo)` / `onNew()`）、`window.api.todos.{complete,setStatus,snooze,create}`
- Produces: `TaskItem`（Task 12/13 复用）

注意 props 对齐：MainShell 传给 TodayView 的 `onEdit` 需要 `Todo` 实体；`OccurrenceItem` 只有 `todoId`——TaskItem 的编辑动作先经 `window.api.todos.listAll('all')` 缓存 Map 查询（TodayView 内部 `todoById` 由 `useEffect + listAll` 建立），编辑时 `onEdit(todoById.get(item.todoId)!)`。

- [ ] **Step 1: `TaskItem.tsx`**

```tsx
// components/TaskItem.tsx
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { OccurrenceItem } from '@shared/types';

const PRIORITY_DOT = ['bg-slate-300', 'bg-amber-400', 'bg-rose-500'];

export function TaskItem({ item, timeLabel, onToggle, onSkip, onUnskip, onSnooze, onEdit }: {
  item: OccurrenceItem;
  timeLabel?: string;                       // 例 '今天' / '周三'，列表视图传入
  onToggle: () => void;
  onSkip: () => void;
  onUnskip: () => void;
  onSnooze: () => void;
  onEdit: () => void;
}) {
  const isRepeat = item.repeatType !== 'none';
  const done = item.state === 'done';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className={cn('flex cursor-default items-center gap-3 rounded-md p-2 select-none hover:bg-muted',
          item.state === 'skipped' && 'opacity-40')}
          onDoubleClick={onEdit} onContextMenu={(e) => e.preventDefault()}>
          <Checkbox checked={done} onCheckedChange={onToggle} aria-label={item.title} />
          <span className={cn('h-2 w-2 shrink-0 rounded-full', PRIORITY_DOT[item.priority])} />
          <span className={cn('min-w-0 flex-1 truncate', done && 'line-through')}>{item.title}</span>
          {timeLabel && <span className="shrink-0 text-xs text-muted-foreground">{timeLabel}</span>}
          {item.timeOfDay && <span className="shrink-0 text-xs text-muted-foreground">{item.timeOfDay}</span>}
          {item.overdue && !done && <Badge variant="destructive" className="shrink-0">逾期</Badge>}
          {isRepeat && <Badge variant="outline" className="shrink-0">重复</Badge>}
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={onToggle}>{done ? '取消完成' : '完成'}</DropdownMenuItem>
        {isRepeat && !done && <DropdownMenuItem onSelect={onSkip}>跳过这一天</DropdownMenuItem>}
        {isRepeat && item.state === 'skipped' && <DropdownMenuItem onSelect={onUnskip}>恢复这一天</DropdownMenuItem>}
        {item.timeOfDay && !done && <DropdownMenuItem onSelect={onSnooze}>稍后再提醒（10 分钟）</DropdownMenuItem>}
        <DropdownMenuItem onSelect={onEdit}>编辑任务…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: `TodayView.tsx`**

```tsx
// views/TodayView.tsx
import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useTodos } from '@/hooks/useTodos';
import { TaskItem } from '@/components/TaskItem';
import { todayStr } from '@shared/recurrence';
import type { OccurrenceItem, Todo, TodoDraft } from '@shared/types';

const quickDraft = (title: string): TodoDraft => ({
  title, notes: null, priority: 1, dueDate: todayStr(Date.now()), timeOfDay: null,
  repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
  monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  startDate: null, completedAt: null,
});

export default function TodayView({ onEdit, onNew }:
  { onEdit: (t: Todo) => void; onNew: () => void }) {
  const today = todayStr(Date.now());
  const { items } = useTodos('2020-01-01', today); // 含逾期一直到今天
  const [todoById, setTodoById] = useState<Map<number, Todo>>(new Map());
  const [quick, setQuick] = useState('');

  useEffect(() => {
    void window.api.todos.listAll('all').then(ts => setTodoById(new Map(ts.map(t => [t.id, t]))));
  }, [items]);

  const { active, overdue, done } = useMemo(() => {
    const pick = (f: (i: OccurrenceItem) => boolean) => items.filter(f);
    return {
      overdue: pick(i => i.state === 'active' && i.date < today && i.repeatType === 'none'
        || (i.repeatType !== 'none' && i.state === 'active' && i.date < today)),
      active: pick(i => i.state === 'active' && i.date === today),
      done: pick(i => i.state === 'done' && i.date === today),
    };
  }, [items, today]);

  // 逾期 = 过去日且 active；重复任务逾期只展示"最近一天"避免刷屏 → 取每个 todoId 最大日期
  const overdueDedup = useMemo(() => {
    const byTodo = new Map<number, OccurrenceItem>();
    for (const i of overdue) {
      const cur = byTodo.get(i.todoId);
      if (!cur || i.date > cur.date) byTodo.set(i.todoId, i);
    }
    return [...byTodo.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [overdue]);

  const edit = (i: OccurrenceItem) => { const t = todoById.get(i.todoId); if (t) onEdit(t); };
  const toggle = async (i: OccurrenceItem) => {
    if (i.state === 'done') await window.api.todos.setStatus(i.todoId, i.date, 'active');
    else await window.api.todos.complete(i.todoId, i.repeatType === 'none' ? undefined : i.date);
  };
  const submitQuick = async () => {
    const title = quick.trim();
    if (!title) return;
    await window.api.todos.create(quickDraft(title));
    setQuick('');
    toast.success('已添加到今日');
  };

  const Section = (title: string, list: OccurrenceItem[], timeLabel?: (i: OccurrenceItem) => string | undefined) => (
    list.length > 0 && (
      <section className="mb-6">
        <h2 className="mb-1 text-xs font-semibold text-muted-foreground">{title}</h2>
        {list.map(i => (
          <TaskItem key={`${i.todoId}-${i.date}`} item={i} timeLabel={timeLabel?.(i)}
            onToggle={() => void toggle(i)}
            onSkip={() => void window.api.todos.setStatus(i.todoId, i.date, 'skipped')}
            onUnskip={() => void window.api.todos.setStatus(i.todoId, i.date, 'active')}
            onSnooze={() => void window.api.todos.snooze(i.todoId, i.date, 10).then(() => toast('10 分钟后再提醒'))}
            onEdit={() => edit(i)} />
        ))}
      </section>
    )
  );

  return (
    <div className="p-6">
      <div className="flex items-end justify-between">
        <h1 className="text-3xl font-bold">{today}</h1>
        <Button variant="outline" onClick={onNew}>新建任务</Button>
      </div>
      <Input className="mt-4" placeholder="快速添加：输入标题，回车存入今日"
        value={quick} onChange={e => setQuick(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') void submitQuick(); }} />

      {Section('已逾期', overdueDedup, i => i.date)}
      {Section('今日', active)}
      {Section('今日已完成', done)}
      {active.length === 0 && done.length === 0 && overdueDedup.length === 0 && (
        <p className="py-16 text-center text-sm text-muted-foreground">今天没有安排</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 手动验证**

- 快速添加"买牛奶"→ 列表出现、托盘计数 +1
- 勾选完成 → 移入"今日已完成"；取消 → 回来
- 右键（或双击标题区触发菜单）→ 跳过这一天（重复任务）→ 条目消失，"恢复"后回来
- Console 建一条昨天的一次性任务验证"已逾期"分组与红色 Badge

- [ ] **Step 4: Commit**

```powershell
git add src/renderer/src/components/TaskItem.tsx src/renderer/src/views/TodayView.tsx
git commit -m "feat(renderer): today view with quick add, overdue grouping and item actions"
```

---

## Task 12: 日历视图（月网格 + 当日 Sheet）

**Files:**
- Create: `src/renderer/src/components/calendar/MonthCalendar.tsx`
- Create: `src/renderer/src/components/calendar/DayPanel.tsx`
- Modify: `src/renderer/src/views/CalendarView.tsx`（替换空壳）

**Interfaces:**
- Consumes: `useTodos`、`TaskItem`、`Sheet`
- Produces: `MonthCalendar({ days, cursorMonth, selected, onSelect })`，`days: OccurrenceItem[]`

规格 §5.2 约束：单日最多 3 条标题缩写，超出显示 `+n`；优先级色点；点选日期开 `Sheet`。

- [ ] **Step 1: `MonthCalendar.tsx`**

```tsx
// components/calendar/MonthCalendar.tsx
import { cn } from '@/lib/utils';
import { dateToNum, addDays } from '@shared/recurrence';
import type { OccurrenceItem } from '@shared/types';

const PRIORITY_DOT = ['bg-slate-300', 'bg-amber-400', 'bg-rose-500'];
const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/** monthStart/monthEnd: 'YYYY-MM-01' 与当月最后一天 */
export function buildGrid(y: number, m: number): string[] {
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const startIdx = new Date(first + 'T00:00:00').getDay();
  const gridStart = addDays(first, -startIdx);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

export default function MonthCalendar({ days, y, m, selected, onSelect }: {
  days: OccurrenceItem[]; y: number; m: number;
  selected: string | null; onSelect: (date: string) => void;
}) {
  const grid = buildGrid(y, m);
  const byDate = new Map<string, OccurrenceItem[]>();
  for (const d of days) {
    if (d.state === 'skipped') continue;
    byDate.set(d.date, [...(byDate.get(d.date) ?? []), d]);
  }
  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-7 border-b border-border text-center text-xs text-muted-foreground">
        {WEEK_LABELS.map(w => <div key={w} className="py-1">周{w}</div>)}
      </div>
      <div className="grid flex-1 grid-cols-7 grid-rows-6">
        {grid.map(date => {
          const inMonth = date.slice(5, 7) === String(m).padStart(2, '0');
          const list = byDate.get(date) ?? [];
          const shown = list.filter(i => i.state === 'active').slice(0, 3);
          const extra = list.filter(i => i.state === 'active').length - shown.length;
          return (
            <button key={date} onClick={() => onSelect(date)}
              className={cn('flex flex-col items-start gap-0.5 border-b border-r border-border/50 p-1 text-left align-top hover:bg-muted/60',
                !inMonth && 'text-muted-foreground/50',
                selected === date && 'bg-muted ring-1 ring-ring',
                date.slice(8) === String(new Date().getDate()) && date.slice(0, 7) === `${y}-${String(m).padStart(2, '0')}`
                  && 'bg-accent')}
              title={list.map(i => i.title).join('\n')}>
              <span className="text-xs font-medium">{Number(date.slice(8, 10))}</span>
              <div className="flex gap-0.5">
                {list.slice(0, 5).map(i => (
                  <span key={`${i.todoId}`} className={cn('h-1.5 w-1.5 rounded-full',
                    PRIORITY_DOT[i.priority], i.state === 'done' && 'opacity-30')} />
                ))}
              </div>
              {shown.map(i => (
                <span key={i.todoId} className={cn('w-full truncate text-[11px] leading-tight',
                  i.state === 'done' && 'text-muted-foreground line-through')}>
                  {i.timeOfDay ? `${i.timeOfDay} ` : ''}{i.title}
                </span>
              ))}
              {extra > 0 && <span className="text-[11px] text-muted-foreground">+{extra}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `DayPanel.tsx`（Sheet 内容）**

```tsx
// components/calendar/DayPanel.tsx
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { TaskItem } from '@/components/TaskItem';
import type { OccurrenceItem, Todo, TodoDraft } from '@shared/types';

export default function DayPanel({ date, items, todoById, onEdit, onNew }: {
  date: string; items: OccurrenceItem[];
  todoById: Map<number, Todo>;
  onEdit: (t: Todo) => void;
  onNew: (draft: TodoDraft) => Promise<void>;
}) {
  const [quick, setQuick] = useState('');
  const submit = async () => {
    const title = quick.trim(); if (!title) return;
    await onNew({
      title, notes: null, priority: 1, dueDate: date, timeOfDay: null,
      repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
      monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
      startDate: null, completedAt: null,
    });
    setQuick(''); toast.success(`已添加到 ${date}`);
  };
  return (
    <div className="flex h-full flex-col gap-2 p-1">
      <div className="flex gap-2">
        <Input placeholder="添加任务到此日" value={quick}
          onChange={e => setQuick(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void submit(); }} />
        <Button onClick={() => void submit()}>添加</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">无任务</p>}
        {items.map(i => {
          const edit = () => { const t = todoById.get(i.todoId); if (t) onEdit(t); };
          return (
            <TaskItem key={`${i.todoId}-${i.date}`} item={i}
              onToggle={() => void (i.state === 'done'
                ? window.api.todos.setStatus(i.todoId, i.date, 'active')
                : window.api.todos.complete(i.todoId, i.repeatType === 'none' ? undefined : i.date))}
              onSkip={() => void window.api.todos.setStatus(i.todoId, i.date, 'skipped')}
              onUnskip={() => void window.api.todos.setStatus(i.todoId, i.date, 'active')}
              onSnooze={() => void window.api.todos.snooze(i.todoId, i.date, 10)}
              onEdit={edit} />
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `CalendarView.tsx`**

```tsx
// views/CalendarView.tsx
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';
import MonthCalendar from '@/components/calendar/MonthCalendar';
import DayPanel from '@/components/calendar/DayPanel';
import { useTodos } from '@/hooks/useTodos';
import { todayStr, addDays } from '@shared/recurrence';
import { dateToNum } from '@shared/recurrence';
import type { Todo, TodoDraft } from '@shared/types';

const monthRange = (y: number, m: number) => {
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const gridStart = addDays(first, -new Date(first + 'T00:00:00').getDay());
  const gridEnd = addDays(gridStart, 41);
  return { from: gridStart, to: gridEnd };
};

export default function CalendarView({ onEdit, onNewOnDate }: {
  onEdit: (t: Todo) => void;
  onNewOnDate: (date: string) => void;
}) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const { from, to } = useMemo(() => monthRange(cursor.y, cursor.m), [cursor]);
  const { items } = useTodos(from, to);
  const [todoById, setTodoById] = useState<Map<number, Todo>>(new Map());
  useEffect(() => {
    void window.api.todos.listAll('all').then(ts => setTodoById(new Map(ts.map(t => [t.id, t]))));
  }, [items]);

  const selectedItems = items.filter(i => i.date === selected);

  const prev = () => setCursor(c => c.m === 1 ? { y: c.y - 1, m: 12 } : { y: c.y, m: c.m - 1 });
  const next = () => setCursor(c => c.m === 12 ? { y: c.y + 1, m: 1 } : { y: c.y, m: c.m + 1 });
  const goToday = () => { const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() + 1 }); setSelected(todayStr(Date.now())); };

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        <h1 className="me-auto text-lg font-semibold">{cursor.y} 年 {cursor.m} 月</h1>
        <Button size="sm" variant="outline" onClick={prev}>←</Button>
        <Button size="sm" variant="outline" onClick={goToday}>今天</Button>
        <Button size="sm" variant="outline" onClick={next}>→</Button>
      </div>
      <div className="min-h-0 flex-1">
        <MonthCalendar days={items} y={cursor.y} m={cursor.m} selected={selected}
          onSelect={(d) => setSelected(d)} />
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <SheetContent className="flex w-[400px] flex-col gap-0 sm:w-[400px]">
          <SheetHeader><SheetTitle>{selected}</SheetTitle></SheetHeader>
          {selected && (
            <div className="min-h-0 flex-1">
              <DayPanel date={selected} items={selectedItems} todoById={todoById}
                onEdit={onEdit}
                onNew={async (d: TodoDraft) => { await window.api.todos.create(d); }} />
            </div>
          )}
          <Button variant="outline" className="mt-2"
            onClick={() => { if (selected) { const d = selected; setSelected(null); onNewOnDate(d); } }}>
            带完整选项新建…
          </Button>
        </SheetContent>
      </Sheet>
    </div>
  );
}
```

- [ ] **Step 4: 手动验证**

- 月网格渲染；今天高亮；翻页 / "今天"按钮工作
- 建"每周四 15:00 周会"→ 日历各周四显示；点周四 → Sheet 列出并可勾选完成
- 单日 4 条任务 → 3 条缩写 + "+1"
- Sheet 内快速添加 → 立刻出现在当日格
- 2 月查看"每月 31 号"任务 → 无点

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/src/components/calendar src/renderer/src/views/CalendarView.tsx
git commit -m "feat(renderer): month calendar grid with day detail sheet"
```

---

## Task 13: 全部任务视图 + VirtualList

**Files:**
- Create: `src/renderer/src/components/VirtualList.tsx`
- Modify: `src/renderer/src/views/AllTasksView.tsx`（替换空壳）

**Interfaces:**
- Consumes: `window.api.todos.listAll('all'|'open'|'done')`（Task 6）、`Todo` 实体
- Produces: `VirtualList({ items, rowHeight, renderRow, className })`

- [ ] **Step 1: `VirtualList.tsx`（固定行高 48px，规格 §5.3）**

```tsx
// components/VirtualList.tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function VirtualList<T>({ items, rowHeight = 48, renderRow, className }: {
  items: T[]; rowHeight?: number;
  renderRow: (item: T, index: number) => ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = items.length * rowHeight;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
  const end = Math.min(items.length, start + Math.ceil(viewport / rowHeight) + 4);

  return (
    <div ref={ref} className={className}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}>
      <div style={{ height: total, position: 'relative' }}>
        {items.slice(start, end).map((item, i) => (
          <div key={start + i}
            style={{ position: 'absolute', top: (start + i) * rowHeight, left: 0, right: 0, height: rowHeight }}>
            {renderRow(item, start + i)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `AllTasksView.tsx`**

行渲染使用 `Todo` 实体行（非 OccurrenceItem）：显示 标题、重复摘要（"每天/每周 一四/每月31号/每 N 天"）、下次日期（`preview(draft of t)[0]` 或 `dueDate`）、优先级 Badge、完成 Checkbox。筛选：状态 Tabs（进行中/已完成/全部）+ 优先级下拉。已完成区域折叠（规格 §5.3）。

实现要点：
- 数据源 `window.api.todos.listAll(statusFilter)`，`useDataVersion` 触发刷新
- `nextDate` 一次性计算：加载后对每个 open 任务调 `preview`，结果缓存 `Map<number, string>`（任务量大时串行慢——用 `Promise.all`，规格 §5.3 未定上限，个人应用 <500 条可接受）
- 点击行 → `onEdit(todo)`；勾选 → `complete(t.id)`（无 date）
- VirtualList `rowHeight={48}`，容器 `className="h-full"`

完整组件代码：

```tsx
// views/AllTasksView.tsx
import { useEffect, useMemo, useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { VirtualList } from '@/components/VirtualList';
import { useDataVersion } from '@/hooks/useDataVersion';
import type { Priority, Todo } from '@shared/types';

const REPEAT_SUMMARY: Record<string, string> =
  { none: '', daily: '每天', weekly: '每周', monthly: '每月', custom: '按间隔' };
const PRIORITY_LABEL: Record<Priority, string> = { 0: '低', 1: '中', 2: '高' };

export default function AllTasksView({ onEdit, onNew }: {
  onEdit: (t: Todo) => void; onNew: () => void;
}) {
  const [status, setStatus] = useState<'all' | 'open' | 'done'>('open');
  const [priority, setPriority] = useState<'all' | string>('all');
  const [todos, setTodos] = useState<Todo[]>([]);
  const [nextDates, setNextDates] = useState<Map<number, string>>(new Map());
  const version = useDataVersion(); // 主进程 broadcastChanged 后自动刷新

  useEffect(() => { void window.api.todos.listAll(status).then(setTodos); }, [status, version]);

  // 下次发生日：对 open 任务一次性并发计算并缓存（<500 条可接受，规格 §5.3）
  useEffect(() => {
    const open = todos.filter(t => !t.completedAt);
    void Promise.all(open.map(async t => [t.id, (await window.api.todos.preview({ draft: t, todoId: t.id }))[0]] as const))
      .then(pairs => setNextDates(new Map(pairs.filter(([, d]) => !!d) as Array<[number, string]>)));
  }, [todos]);

  const rows = useMemo(() => {
    const list = priority === 'all' ? todos : todos.filter(t => t.priority === Number(priority));
    return [...list].sort((a, b) =>
      (a.completedAt ? 1 : 0) - (b.completedAt ? 1 : 0)
      || (a.completedAt ? 0
        : (nextDates.get(a.id) ?? '9999-99-99').localeCompare(nextDates.get(b.id) ?? '9999-99-99'))
      || b.id - a.id);
  }, [todos, priority, nextDates]);

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="me-auto text-xl font-semibold">全部任务</h1>
        <Button variant="outline" onClick={onNew}>新建任务</Button>
      </div>
      <div className="mb-3 flex items-center gap-3">
        <Tabs value={status} onValueChange={v => setStatus(v as typeof status)}>
          <TabsList>
            <TabsTrigger value="open">进行中</TabsTrigger>
            <TabsTrigger value="done">已完成</TabsTrigger>
            <TabsTrigger value="all">全部</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有优先级</SelectItem>
            <SelectItem value="0">低</SelectItem>
            <SelectItem value="1">中</SelectItem>
            <SelectItem value="2">高</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <VirtualList items={rows} rowHeight={48} className="min-h-0 flex-1"
        renderRow={t => (
          <div className="flex h-12 cursor-default items-center gap-3 rounded-md px-2 hover:bg-muted"
            onDoubleClick={() => onEdit(t)}>
            <Checkbox checked={!!t.completedAt} aria-label={t.title}
              onCheckedChange={() => void (t.completedAt
                ? window.api.todos.update(t.id, { completedAt: null })
                : window.api.todos.complete(t.id))} />
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            <Badge variant={t.priority === 2 ? 'destructive' : t.priority === 0 ? 'secondary' : 'outline'}>
              {PRIORITY_LABEL[t.priority]}
            </Badge>
            {t.repeatType !== 'none' && <Badge variant="outline">{REPEAT_SUMMARY[t.repeatType]}</Badge>}
            <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
              {t.completedAt ? '已完成' : nextDates.get(t.id) ?? '—'}
            </span>
          </div>
        )} />
    </div>
  );
}
```

- [ ] **Step 3: 手动验证**

- Console 批量建 200 任务：`for (let i=0;i<200;i++) await window.api.todos.create({...})`
- 切换到"全部任务"：滚动流畅（DevTools Performance 帧率正常），行渲染正确
- 筛选"已完成"只显示完成项；点击行打开编辑对话框

- [ ] **Step 4: Commit**

```powershell
git add src/renderer/src/components/VirtualList.tsx src/renderer/src/views/AllTasksView.tsx
git commit -m "feat(renderer): all-tasks view with filters and virtual scrolling"
```

---

## Task 14: 设置视图

**Files:**
- Modify: `src/renderer/src/views/SettingsView.tsx`（替换空壳）
- Modify: `src/main/ipc.ts`（新增 `settings:db-path` 通道：返回 `join(app.getPath('appData'),'whchem-todo')`；`shared/ipc.ts` 同步 `Ipc.SettingsDbPath` + `Api.dbPath()` + `Api.openDbFolder()`（主进程 `shell.openPath`）；preload 桥接）

**Interfaces:**
- Consumes: `window.api.autostart.{get,set}`、`hotkey.set`、`notifyTest`、`settings.get/set('theme'|'notify_sound')`、`dbPath/openDbFolder`（本次新增）
- Produces: 完整设置页（规格 §5.4）

- [ ] **Step 1: 实现设置页五个区块**

```tsx
// views/SettingsView.tsx（关键逻辑，样式按 shadcn 惯例组装）
import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useSettings } from '@/hooks/useSettings';
import { applyTheme, type ThemeMode } from '@/lib/theme';

export default function SettingsView() {
  // 1) 开机自启：真相来自系统（规格 §5.4 回显真实状态）
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => { void window.api.autostart.get().then(setAutostart); }, []);
  const toggleAuto = async (v: boolean) => {
    await window.api.autostart.set(v);
    setAutostart(await window.api.autostart.get()); // 再读一次防系统侧失败
  };

  // 2) 主题
  const [theme, setTheme] = useSettings<ThemeMode>('theme', 'system');
  const changeTheme = (m: string) => { const t = m as ThemeMode; void setTheme(t); applyTheme(t); };

  // 3) 通知音效（提示用户：Windows 端实际由系统通知设置控制音量，应用侧用 silent 开关影响构造）
  const [sound, setSound] = useSettings<boolean>('notify_sound', true);

  // 4) 快捷键录制
  const [hotkey, setHotkey] = useState('Ctrl+Alt+A');
  const [recording, setRecording] = useState(false);
  useEffect(() => { void window.api.settings.get<string>('quickadd_shortcut').then(v => v && setHotkey(v)); }, []);
  useEffect(() => {
    if (!recording) return;
    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === 'Escape') { setRecording(false); return; }
      const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.metaKey && 'Super'].filter(Boolean);
      const main = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (!mods.length && !e.key.startsWith('F')) return; // 至少一个修饰键或功能键
      const acc = [...mods, main].join('+');
      try {
        await window.api.hotkey.set(acc);
        setHotkey(acc);
        toast.success(`快捷键已更新为 ${acc}`);
        setRecording(false);
      } catch (err: any) {
        toast.error(err?.message ?? '注册失败'); // 冲突回退，规格 §6
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording]);

  // 5) 通知权限探测 + 数据库位置
  const [notifyOk, setNotifyOk] = useState(true);
  useEffect(() => {
    window.api.notifyTest().catch(() => setNotifyOk(false)); // 失败即通知不可用
  }, []);
  const [dbPath, setDbPath] = useState('');
  useEffect(() => { void window.api.dbPath().then(setDbPath); }, []);

  return (
    <div className="space-y-8 p-6">
      {/* 每区块 = Card：开关自启 / Tabs 主题 / Switch 音效+测试按钮 / 快捷键按钮 / db 路径+打开+损坏恢复说明 */}
      {/* 完整 JSX 约 120 行：使用上述 state 与 handler 按规格 §5.4 顺序渲染；
          音效开关需接入 notify.ts —— Scheduler.notify 构造 Notification 时读取 settings.notify_sound，
          silent: !sound（Task 7 装配时在 index.ts 的 notify 闭包内注入 settingsDao.get('notify_sound')） */}
    </div>
  );
}
```

执行时要求：
1. 五区块用 shadcn `Card`（`npx shadcn@latest add card`）包裹，标题依次为：开机自启 / 外观 / 通知 / 快捷键 / 数据。
2. 通知区块含"发送测试通知"按钮（`notifyTest`，失败 toast 展示错误并显示黄色警示条 + "打开系统通知设置"按钮 `shell.openExternal('ms-settings:notifications')`——新增 `Api.openNotifySettings()` 通道）。
3. 数据区块显示只读 `dbPath`，按钮"打开所在文件夹"（`openDbFolder`），附一行说明"数据库损坏时将自动备份为 todo.db.corrupt.<时间戳>"。
4. `notify_sound` 生效链路：`index.ts` 中 `notify: (items) => dispatchNotify(items, click, settingsDao.get('notify_sound') ?? true)`，`dispatchNotify` 增加第三参 `withSound: boolean` → `new Notification({ ..., silent: !withSound })`。同步更新 Task 7/14 相关签名与 notify 单测（若有）。

- [ ] **Step 2: 手动验证**

- 拨动自启 → `regedit HKCU\...\Run` 出现/消失 `WhchemTodo` 键值（args 含 --hidden）
- 主题三档切换即时生效
- 测试通知弹出；关闭系统通知权限后显示警示与跳转按钮
- 录制新热键 F1 → 全屏其他应用中按 F1 弹快添窗；录一个被占用组合 → 报错 toast 且旧热键仍有效
- 设置音效开关 → 通知静音/有声跟随

- [ ] **Step 3: Commit**

```powershell
git add src/renderer/src/views/SettingsView.tsx src/shared/ipc.ts src/main/ipc.ts src/main/notify.ts src/main/index.ts src/preload/index.ts
git commit -m "feat(settings): autostart, theme, notify sound, hotkey recorder and data folder"
```

---

## Task 15: 图标资源 + NSIS 打包

**Files:**
- Create: `resources/icon.png`（256×256，模板图标即可）
- Create: `scripts/make-icon.mjs`
- Create: `electron-builder.yml`
- Modify: `package.json`（`build:win` 脚本、`build` 字段引用 yml）

**Interfaces:**
- Consumes: `png-to-ico`（Task 1 devDep 已装）、electron-builder
- Produces: `dist/WhchemTodo Setup 0.1.0.exe`

- [ ] **Step 1: 图标**

`scripts/make-icon.mjs`：

```js
import pngToIco from 'png-to-ico';
import { copyFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';

if (!existsSync('resources/icon.png')) {
  console.error('缺少 resources/icon.png（256x256 PNG）');
  process.exit(1);
}
mkdirSync('build', { recursive: true });
copyFileSync('resources/icon.png', 'build/icon.png'); // 托盘与通知引用的 png
const ico = await pngToIco('resources/icon.png');     // 内部自动缩放多尺寸
writeFileSync('build/icon.ico', ico);
console.log('build/icon.{png,ico} 生成完成');
```

图标内容：临时使用 electron-vite 模板自带 icon 复制为 `resources/icon.png`；正式图标后续替换（不影响功能）。

```powershell
mkdir build -ea 0; mkdir resources -ea 0
Copy-Item node_modules/electron-vite/template/... # 若模板无源图，则用 scaffold 时生成的 resources/icon.png 保留副本
npm run make-icon   # package.json: "make-icon": "node scripts/make-icon.mjs"
```

（scaffold 模板自带 `resources/icon.png`，Task 1 移动文件时已在根目录 `resources/` 下，直接复用。）

- [ ] **Step 2: `electron-builder.yml`**

```yaml
appId: com.whchem.todo
productName: WhchemTodo
directories:
  buildResources: build
files:
  - '!**/.vscode/*'
  - '!src/*'
  - '!docs/*'
  - '!tests/*'
  - '!resources/icon.png'
asarUnpack:
  - node_modules/better-sqlite3/**   # 规格 §8：原生二进制不进 asar
win:
  icon: build/icon.ico
  target:
    - target: nsis
      arch: [x64]
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  installerIcon: build/icon.ico
  uninstallerIcon: build/icon.ico
  shortcutName: WhchemTodo
publish: null   # 规格 §8：预留自动更新配置位（v1 不启用）
```

`package.json` scripts 增加：`"build:win": "npm run db:electron && npm run build && electron-builder --win nsis --x64"`。

- [ ] **Step 3: 验证**

```powershell
npm run build:win
# 预期 dist/ 下生成 "WhchemTodo Setup 0.1.0.exe"
# 安装 → 开始菜单启动 → 托盘出现 → 全流程冒烟（创建任务/提醒 Toast/快添窗）
```

安装版冒烟重点：安装包内 better-sqlite3 从 `app.asar.unpacked` 正确加载（若报 NODE_MODULE_VERSION / Cannot find module，检查 asarUnpack 与 db:electron 是否执行）。

- [ ] **Step 4: Commit**

```powershell
git add resources scripts electron-builder.yml package.json .gitignore
git add dist 2>$null   # dist 不入库：.gitignore 追加 "dist/"、"node_modules/"、"out/"、"*.local"
git commit -m "build: NSIS x64 packaging with generated icons and sqlite unpack"
```

---

## Task 16: 真机验收走查 + 规格对齐收尾

**Files:**
- Modify: 走查中发现问题的修复（无固定文件清单）
- Create: `docs/superpowers/plans/2026-10-27-acceptance-report.md`（勾清单）

**Interfaces:**
- Consumes: 规格 §9 的 12 项验收清单
- Produces: 勾选完毕的报告 + 最终可安装版本

- [ ] **Step 1: 环境准备**

```powershell
npm run build:win
# 安装 NSIS 包；卸载开发版（避免单实例锁互踩）
```

- [ ] **Step 2: 逐项走查规格 §9**

复制清单到报告文件并逐项验证（每项记录 通过/失败+备注）：

1. 卸载后重装 → 注册表 Run 键开启自启 → 重启系统 → 仅托盘图标、无窗口弹出
2. 设置页自启开关往返 → Run 键同步增删
3. 建"明天 现在+2分钟 每天"任务 → 到点 Toast；点击通知主窗定位
4. 建"每月31号"→ 日历 2 月无、3 月有；预览行正确
5. 触发提醒前睡眠机器 → 唤醒后 60s 内收到"⚠ 已过期"补发；2 条以上合并
6. 托盘"暂停所有提醒 1 小时"→ 期间静默、恢复后过期补发
7. 全屏应用中 `Ctrl+Alt+A` → 快添窗弹出、回车建今日任务
8. 快添窗 `Ctrl+Enter` → 主窗编辑对话框预填标题
9. 关主窗 → 提醒仍送达；托盘退出 → 进程结束、热键失效
10. 双击 exe 二次启动 → 唤起已有窗口
11. 关闭系统通知权限 → 设置页警示 + 跳转按钮
12. 删除重复任务 → 日历消失、未触发提醒不再送达

- [ ] **Step 3: 修复失败项并回归**

每项失败按 systematic-debugging 流程处理（复现 → 定位 → 修复 → 加测试防回归）。

- [ ] **Step 4: 最终提交**

```powershell
npm run test    # 全量测试绿
git add docs/superpowers/plans/2026-10-27-acceptance-report.md
git commit -m "docs: acceptance report - all checklist items verified"
```

---

## 自检记录（writing-plans self-review）

**1. 规格覆盖**：规格 §1 功能 → Task 1–14；§2 技术栈 → Task 1；§3 数据模型 → Task 2–4；§4 架构/IPC/调度 → Task 5–8；§5 UI → Task 9–14；§6 错误处理 → Task 3（损坏恢复）/5（补发）/6（信封）/7（异常兜底/渲染崩溃 reload）/14（通知权限）；§7 测试 → Task 2–5 内嵌 + Task 16；§8 打包 → Task 15；§9 验收 → Task 16。**§6"数据库位置只读展示"与"notify_sound 生效链路"在 Task 14 步骤内定义；"未捕获异常兜底"在 Task 7 Step 3。** 无遗漏。

**2. 占位符扫描**："草稿+更正"模式已全部移除：Task 4 直接给出终版 `setStatus/preview` 实现与 `OccurrenceDao.deleteState` 前置步骤；Task 7 托盘刷新订阅改为 `onChangedBroadcast` 正式实现；Task 10/11/12 的示意 import 块与无效三元分支已删除，唯一版本即入库代码；Task 13 提供完整 AllTasksView 代码。剩余的现场实现自由度仅在 Task 14 设置页 JSX 布局（state/handler 已全部定义，Card 文案依规格 §5.4），属排版自由而非逻辑占位。验证：`npm run typecheck` 通过 + grep `dueDateForRepeat|MonthCalendarHost|ipcRendererShim|fixIncludesToday|useNavigate` 无结果。

**3. 类型一致性**：`OccurrenceItem.state` 三值（active/done/skipped）贯穿 Task 2/4/11/12；`Scheduler.syncFor(todo: Todo)` 与 `ipc.ts` 调用一致；`WindowOps` 由 Task 6 定义、Task 7 实现、Task 6 handler 引用，闭环；`EditorState` 定义于 `components/editor-state.ts`，Task 9 MainShell 与 Task 10 对话框共用；`Api` 新增 `dbPath/openDbFolder/openNotifySettings` 在 Task 14 同步补 `shared/ipc.ts` 三处（契约、handler、preload）。
