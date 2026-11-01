# 任务计时（Task Timer）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为待办任务增加「开始计时 → 暂停/继续 → 完成后记录用时」能力，支持一次性任务与重复任务的每一期独立计时。

**Architecture:** 新增 `task_timers` 表（`(todo_id, occurrence_date)` 复合键），`TimerDao` 封装读写，`TodoService` 承载状态机（单任务计时），IPC 两条新通道，渲染层用自 tick 的 `Elapsed` 组件显示实时用时。

**Tech Stack:** Electron, React 19, Tailwind v4, better-sqlite3, Vitest

**Spec:** `docs/superpowers/specs/2026-10-29-task-timer-design.md`

## Global Constraints

- 不改动现有 `completed_at` / `occurrence_states` 语义
- 一次性任务计时用 `occurrence_date = ''` 哨兵
- 单任务计时为硬约束，由 `TimerDao.pauseAllRunning` + `TodoService.startTimer` 保证
- `TodoService` 构造签名变为 `(todos, occ, timers, clock?)`
- 迁移版本 1 → 2，不改动 v1 的 DDL

---

### Task 1: Schema v2 + TimerState 类型 + TimerDao

**Files:**
- Modify: `src/main/db/schema.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/db/dao.ts`
- Test: `tests/integration/timer-dao.test.ts`

**Interfaces:**
- Produces: `TimerState` 类型；`TimerDao` 类（`get` / `getByTodo` / `upsert` / `pauseAllRunning` / `pause` / `settle` / `resetCompleted`）

- [ ] **Step 1: 写失败的测试**

创建 `tests/integration/timer-dao.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/main/db';
import { TodoDao, TimerDao } from '../../src/main/db/dao';
import type { TodoDraft } from '@shared/types';

const base: TodoDraft = {
  title: 't', notes: null, priority: 1,
  dueDate: '2026-10-27', timeOfDay: null,
  repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
  monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  startDate: null, completedAt: null,
};

let db: Database.Database;
let todoId: number;
let timers: TimerDao;
beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  todoId = new TodoDao(db).create(base).id;
  timers = new TimerDao(db);
});

describe('TimerDao', () => {
  it('get 无记录返回 null', () => {
    expect(timers.get(todoId, '')).toBeNull();
  });

  it('upsert 插入与合并', () => {
    timers.upsert(todoId, '', { runningSince: 1000 });
    expect(timers.get(todoId, '')).toEqual({ accumulatedMs: 0, runningSince: 1000, totalMs: null });
    timers.upsert(todoId, '', { totalMs: null, runningSince: null });
    expect(timers.get(todoId, '')?.runningSince).toBeNull();
  });

  it('pauseAllRunning 累计运行段时间并停止', () => {
    timers.upsert(todoId, '', { runningSince: 1000 });
    timers.pauseAllRunning(4000);
    expect(timers.get(todoId, '')).toEqual({ accumulatedMs: 3000, runningSince: null, totalMs: null });
  });

  it('pause 只影响指定单元', () => {
    timers.upsert(todoId, '', { runningSince: 1000 });
    timers.upsert(todoId, '2026-10-27', { runningSince: 1000 });
    timers.pause(todoId, '2026-10-27', 3000);
    expect(timers.get(todoId, '')?.runningSince).toBe(1000);
    expect(timers.get(todoId, '2026-10-27')?.accumulatedMs).toBe(2000);
  });

  it('settle 冻结 total_ms（含运行中段）', () => {
    timers.upsert(todoId, '', { accumulatedMs: 5000, runningSince: 2000 });
    timers.settle(todoId, '', 5000);
    expect(timers.get(todoId, '')).toEqual({ accumulatedMs: 8000, runningSince: null, totalMs: 8000 });
  });

  it('settle 无计时记录时为空操作', () => {
    timers.settle(todoId, '', 5000);
    expect(timers.get(todoId, '')).toBeNull();
  });

  it('resetCompleted 保留 accumulated 清 total', () => {
    timers.upsert(todoId, '', { accumulatedMs: 8000, totalMs: 8000 });
    timers.resetCompleted(todoId, '');
    expect(timers.get(todoId, '')).toEqual({ accumulatedMs: 8000, runningSince: null, totalMs: null });
  });

  it('getByTodo 返回 date 到状态的映射', () => {
    timers.upsert(todoId, '', { runningSince: 1 });
    timers.upsert(todoId, '2026-10-27', { accumulatedMs: 100 });
    const m = timers.getByTodo(todoId);
    expect(m.get('')?.runningSince).toBe(1);
    expect(m.get('2026-10-27')?.accumulatedMs).toBe(100);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/integration/timer-dao.test.ts`
Expected: FAIL（`TimerDao` 未定义）

- [ ] **Step 3: schema.ts 升版本 + 加迁移**

把 `SCHEMA_VERSION` 改为 `2`，并在 `MIGRATIONS` 对象内、`1:` 之后追加 `2:`：

```ts
export const SCHEMA_VERSION = 2;

export const MIGRATIONS: Record<number, string[]> = {
  1: [ /* 既有内容保持不变 */ ],
  2: [
    `CREATE TABLE task_timers (
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      occurrence_date TEXT NOT NULL,
      accumulated_ms INTEGER NOT NULL DEFAULT 0,
      running_since INTEGER,
      total_ms INTEGER,
      PRIMARY KEY (todo_id, occurrence_date))`,
    `CREATE INDEX idx_task_timers_running ON task_timers(running_since)`,
  ],
};
```

- [ ] **Step 4: types.ts 加 TimerState 字段**

在 `types.ts` 末尾追加：

```ts
export interface TimerState {
  accumulatedMs: number;
  runningSince: number | null;
  totalMs: number | null;
}
```

并在 `Todo` 与 `OccurrenceItem` 接口内各加一行可选字段：

```ts
  timer?: TimerState | null;
```

- [ ] **Step 5: dao.ts 实现 TimerDao**

在 `dao.ts` 顶部 import 增补 `TimerState`：

```ts
import type {
  Todo, TodoDraft, OccurrenceStatus, Priority, RepeatType, MonthlyMode, TimerState,
} from '@shared/types';
```

文件末尾追加：

```ts
interface TimerRow {
  todo_id: number; occurrence_date: string;
  accumulated_ms: number; running_since: number | null; total_ms: number | null;
}

const unpackT = (r: TimerRow): TimerState => ({
  accumulatedMs: r.accumulated_ms, runningSince: r.running_since, totalMs: r.total_ms,
});

const TIMER_COLS = 'todo_id, occurrence_date, accumulated_ms, running_since, total_ms';

export class TimerDao {
  constructor(private db: Db) {}

  get(todoId: number, date: string): TimerState | null {
    const row = this.db.prepare(
      `SELECT ${TIMER_COLS} FROM task_timers WHERE todo_id=? AND occurrence_date=?`,
    ).get(todoId, date) as TimerRow | undefined;
    return row ? unpackT(row) : null;
  }

  getByTodo(todoId: number): Map<string, TimerState> {
    const rows = this.db.prepare(
      `SELECT ${TIMER_COLS} FROM task_timers WHERE todo_id=?`,
    ).all(todoId) as TimerRow[];
    return new Map(rows.map(r => [r.occurrence_date, unpackT(r)]));
  }

  /** 不存在则插入默认行后合并 patch；显式 null 会覆盖 */
  upsert(todoId: number, date: string, patch: Partial<TimerState>): void {
    const cur = this.get(todoId, date) ?? { accumulatedMs: 0, runningSince: null, totalMs: null };
    const next = { ...cur, ...patch };
    this.db.prepare(
      `INSERT INTO task_timers (todo_id, occurrence_date, accumulated_ms, running_since, total_ms)
       VALUES (?,?,?,?,?)
       ON CONFLICT(todo_id, occurrence_date) DO UPDATE SET
         accumulated_ms=excluded.accumulated_ms,
         running_since=excluded.running_since,
         total_ms=excluded.total_ms`,
    ).run(todoId, date, next.accumulatedMs, next.runningSince, next.totalMs);
  }

  /** 单任务约束：把所有运行中的计时累计并停止 */
  pauseAllRunning(now: number): void {
    this.db.prepare(
      `UPDATE task_timers
       SET accumulated_ms = accumulated_ms + (? - running_since), running_since = NULL
       WHERE running_since IS NOT NULL`,
    ).run(now);
  }

  /** 暂停指定单元（非运行中则空操作） */
  pause(todoId: number, date: string, now: number): void {
    this.db.prepare(
      `UPDATE task_timers
       SET accumulated_ms = accumulated_ms + (? - running_since), running_since = NULL
       WHERE todo_id=? AND occurrence_date=? AND running_since IS NOT NULL`,
    ).run(now, todoId, date);
  }

  /** 完成时冻结 total_ms（含当前运行段）；无记录则空操作 */
  settle(todoId: number, date: string, now: number): void {
    const cur = this.get(todoId, date);
    if (!cur) return;
    const total = cur.accumulatedMs + (cur.runningSince != null ? now - cur.runningSince : 0);
    this.upsert(todoId, date, { accumulatedMs: total, runningSince: null, totalMs: total });
  }

  /** 取消完成：清 total 与 running，保留 accumulated 供后续继续累加 */
  resetCompleted(todoId: number, date: string): void {
    this.db.prepare(
      `UPDATE task_timers SET total_ms=NULL, running_since=NULL
       WHERE todo_id=? AND occurrence_date=?`,
    ).run(todoId, date);
  }
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run tests/integration/timer-dao.test.ts`
Expected: PASS（8 个用例）

- [ ] **Step 7: Commit**

```bash
git add src/main/db/schema.ts src/shared/types.ts src/main/db/dao.ts tests/integration/timer-dao.test.ts
git commit -m "feat(timer): add task_timers table, TimerState type and TimerDao"
```

---

### Task 2: TodoService 状态机 + IPC + Preload

**Files:**
- Modify: `src/main/services/todo-service.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `tests/integration/todo-service.test.ts`（构造签名）
- Test: `tests/integration/timer-service.test.ts`

**Interfaces:**
- Consumes: `TimerDao`（Task 1）
- Produces: `TodoService.startTimer(todoId, date?)`, `TodoService.pauseTimer(todoId, date?)`；`window.api.todos.startTimer/pauseTimer`

- [ ] **Step 1: 写失败的测试**

创建 `tests/integration/timer-service.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/main/db';
import { TodoDao, OccurrenceDao, TimerDao } from '../../src/main/db/dao';
import { TodoService } from '../../src/main/services/todo-service';
import type { TodoDraft } from '@shared/types';

let now = 0;
const clock = () => now;

const base: TodoDraft = {
  title: 't', notes: null, priority: 1,
  dueDate: '2026-10-27', timeOfDay: null,
  repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
  monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  startDate: null, completedAt: null,
};

function make() {
  const db = new Database(':memory:');
  migrate(db);
  const todos = new TodoDao(db);
  const occ = new OccurrenceDao(db);
  const timers = new TimerDao(db);
  return { svc: new TodoService(todos, occ, timers, clock), todos, timers };
}

beforeEach(() => { now = 1_000_000; });

describe('TodoService 计时状态机', () => {
  it('一次性任务 start → pause → 再 start 继续累加', () => {
    const { svc, timers } = make();
    const t = svc.create(base);
    svc.startTimer(t.id);
    now += 5000;
    svc.pauseTimer(t.id);
    expect(timers.get(t.id, '')).toEqual({ accumulatedMs: 5000, runningSince: null, totalMs: null });
    now += 1000;
    svc.startTimer(t.id);
    now += 3000;
    svc.pauseTimer(t.id);
    expect(timers.get(t.id, '')?.accumulatedMs).toBe(8000);
  });

  it('开始 B 自动暂停 A（单任务约束）', () => {
    const { svc, timers } = make();
    const a = svc.create(base);
    const b = svc.create({ ...base, title: 'b' });
    svc.startTimer(a.id);
    now += 4000;
    svc.startTimer(b.id);
    expect(timers.get(a.id, '')?.runningSince).toBeNull();
    expect(timers.get(a.id, '')?.accumulatedMs).toBe(4000);
    expect(timers.get(b.id, '')?.runningSince).toBe(now);
  });

  it('complete 冻结 total_ms', () => {
    const { svc, timers } = make();
    const t = svc.create(base);
    svc.startTimer(t.id);
    now += 6000;
    svc.complete(t.id);
    expect(timers.get(t.id, '')).toEqual({ accumulatedMs: 6000, runningSince: null, totalMs: 6000 });
  });

  it('取消完成后保留累计、清 total，再开始继续累加', () => {
    const { svc, timers } = make();
    const t = svc.create(base);
    svc.startTimer(t.id);
    now += 6000;
    svc.complete(t.id);
    svc.setStatus(t.id, base.dueDate!, 'active');
    expect(timers.get(t.id, '')).toEqual({ accumulatedMs: 6000, runningSince: null, totalMs: null });
    svc.startTimer(t.id);
    now += 2000;
    svc.complete(t.id);
    expect(timers.get(t.id, '')?.totalMs).toBe(8000);
  });

  it('重复任务按发生日独立计时', () => {
    const { svc, timers } = make();
    const t = svc.create({ ...base, repeatType: 'daily' });
    svc.startTimer(t.id, '2026-10-27');
    now += 3000;
    svc.pauseTimer(t.id, '2026-10-27');
    svc.startTimer(t.id, '2026-10-28');
    now += 1000;
    svc.pauseTimer(t.id, '2026-10-28');
    expect(timers.get(t.id, '2026-10-27')?.accumulatedMs).toBe(3000);
    expect(timers.get(t.id, '2026-10-28')?.accumulatedMs).toBe(1000);
  });

  it('list 关联 timer 字段', () => {
    const { svc } = make();
    const t = svc.create(base);
    svc.startTimer(t.id);
    const items = svc.list('2026-10-27', '2026-10-27');
    expect(items[0].timer?.runningSince).toBe(now);
  });

  it('listAll 为一次性任务关联 timer，重复任务为 null', () => {
    const { svc } = make();
    const one = svc.create(base);
    svc.create({ ...base, title: 'r', repeatType: 'daily' });
    svc.startTimer(one.id);
    const rows = svc.listAll('all');
    expect(rows.find(r => r.id === one.id)?.timer?.runningSince).toBe(now);
    expect(rows.find(r => r.title === 'r')?.timer).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/integration/timer-service.test.ts`
Expected: FAIL（`TimerDao` 参数不匹配 / `startTimer` 未定义）

- [ ] **Step 3: TodoService 构造签名 + 计时方法 + complete/setStatus/list/listAll 改造**

`src/main/services/todo-service.ts`：

```ts
import type { TodoDao, OccurrenceDao, TimerDao } from '../db/dao';

export class TodoService {
  constructor(
    private todos: TodoDao,
    private occ: OccurrenceDao,
    private timers: TimerDao,
    private clock: () => number = Date.now,
  ) {}

  /** 计时键：一次性任务用 '' 哨兵，重复任务用发生日 */
  private timerKey(t: Todo, date?: string): string {
    return t.repeatType === 'none' ? '' : (date ?? '');
  }

  startTimer(todoId: number, date?: string): void {
    const t = this.todos.getById(todoId);
    if (!t) return;
    const now = this.clock();
    this.timers.pauseAllRunning(now); // 单任务约束
    this.timers.upsert(todoId, this.timerKey(t, date), { runningSince: now, totalMs: null });
  }

  pauseTimer(todoId: number, date?: string): void {
    const t = this.todos.getById(todoId);
    if (!t) return;
    this.timers.pause(todoId, this.timerKey(t, date), this.clock());
  }

  complete(todoId: number, date?: string): void {
    const t = this.todos.getById(todoId);
    if (!t) return;
    const now = this.clock();
    this.timers.settle(todoId, this.timerKey(t, date), now);
    if (t.repeatType === 'none') this.todos.setCompleted(todoId, now);
    else if (date) this.occ.setState(todoId, date, 'done');
  }

  setStatus(todoId: number, date: string, status: OccurrenceStatus): void {
    const t = this.todos.getById(todoId);
    if (!t) return;
    const now = this.clock();
    const key = this.timerKey(t, date);
    if (t.repeatType === 'none') {
      if (status === 'done') {
        this.timers.settle(todoId, key, now);
        this.todos.setCompleted(todoId, now);
      } else if (status === 'active') {
        this.timers.resetCompleted(todoId, key);
        this.todos.update(todoId, { completedAt: null });
      }
      return;
    }
    if (status === 'active') {
      this.timers.resetCompleted(todoId, key);
      this.occ.deleteState(todoId, date);
    } else {
      if (status === 'done') this.timers.settle(todoId, key, now);
      this.occ.setState(todoId, date, status);
    }
  }

  list(from: string, to: string): OccurrenceItem[] {
    const out: OccurrenceItem[] = [];
    const today = todayStr(this.clock());
    for (const t of this.todos.listAll('all')) {
      const anchor = t.startDate ?? t.dueDate;
      if (!anchor) continue;
      const map = this.timers.getByTodo(t.id);
      if (t.repeatType === 'none') {
        if (dateToNum(anchor) < dateToNum(from) || dateToNum(anchor) > dateToNum(to)) continue;
        out.push({
          ...this.item(t, anchor, t.completedAt != null ? 'done' : 'active', today),
          timer: map.get('') ?? null,
        });
      } else {
        const states = this.occ.getByTodo(t.id);
        for (const d of occurrencesInRange(toSpec(t), anchor, from, to)) {
          out.push({ ...this.item(t, d, states.get(d) ?? 'active', today), timer: map.get(d) ?? null });
        }
      }
    }
    return out.sort((a, b) => dateToNum(a.date) - dateToNum(b.date) || a.todoId - b.todoId);
  }

  listAll(status: 'all' | 'open' | 'done'): Todo[] {
    return this.todos.listAll(status).map(t =>
      t.repeatType === 'none' ? { ...t, timer: this.timers.get(t.id, '') } : { ...t, timer: null },
    );
  }
}
```

（其余方法 `create` / `update` / `getById` / `remove` / `preview` / `item` 保持不变。）

- [ ] **Step 4: 更新 `src/main/index.ts` 装配**

```ts
const timersDao = new TimerDao(db);
// 现有：const todoService = new TodoService(todosDao, occDao);
const todoService = new TodoService(todosDao, occDao, timersDao);
```

import 行增补 `TimerDao`：

```ts
import { TodoDao, OccurrenceDao, ReminderDao, SettingsDao, TimerDao } from './db/dao';
```

- [ ] **Step 5: 更新已有测试的构造签名**

`tests/integration/todo-service.test.ts` 的 `makeService()` 改为：

```ts
import { TodoDao, OccurrenceDao, TimerDao } from '../../src/main/db/dao';
// ...
function makeService() {
  const db = new Database(':memory:');
  migrate(db);
  const todos = new TodoDao(db);
  const occ = new OccurrenceDao(db);
  const timers = new TimerDao(db);
  return { service: new TodoService(todos, occ, timers, clock), todos, occ };
}
```

- [ ] **Step 6: shared/ipc.ts 加通道与 Api 方法**

`Ipc` 对象内（`TodosPreview` 之后）追加：

```ts
  TodosStartTimer: 'todos:start-timer',
  TodosPauseTimer: 'todos:pause-timer',
```

`Api.todos` 内追加：

```ts
    startTimer(todoId: number, date?: string): Promise<void>;
    pauseTimer(todoId: number, date?: string): Promise<void>;
```

- [ ] **Step 7: main/ipc.ts 注册 handler**

在 `wrap(Ipc.TodosComplete, ...)` 之后追加：

```ts
  wrap(Ipc.TodosStartTimer, (id: number, date?: string) => {
    todoService.startTimer(id, date);
    windows.broadcastChanged();
  });
  wrap(Ipc.TodosPauseTimer, (id: number, date?: string) => {
    todoService.pauseTimer(id, date);
    windows.broadcastChanged();
  });
```

- [ ] **Step 8: preload/index.ts 暴露方法**

`api.todos` 内追加：

```ts
    startTimer: (id, date) => call(Ipc.TodosStartTimer, id, date),
    pauseTimer: (id, date) => call(Ipc.TodosPauseTimer, id, date),
```

- [ ] **Step 9: 运行测试 + typecheck**

Run: `npx vitest run tests/integration/timer-service.test.ts; npm run typecheck`
Expected: 全部 PASS，typecheck 零错误

- [ ] **Step 10: Commit**

```bash
git add src/main/services/todo-service.ts src/main/index.ts src/shared/ipc.ts src/main/ipc.ts src/preload/index.ts tests/integration/todo-service.test.ts tests/integration/timer-service.test.ts
git commit -m "feat(timer): service state machine, IPC channels and preload API"
```

---

### Task 3: formatDuration + Elapsed 组件

**Files:**
- Create: `src/renderer/src/lib/duration.ts`
- Create: `src/renderer/src/components/Elapsed.tsx`
- Test: `tests/unit/duration.test.ts`

**Interfaces:**
- Produces: `formatDuration(ms: number): string`；`<Elapsed accumulatedMs runningSince />`

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/duration.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/duration.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/renderer/src/lib/duration.ts`**

```ts
/** 毫秒 → `MM:SS`（<1h）或 `H:MM:SS`（≥1h）；负数/亚秒归零 */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
```

- [ ] **Step 4: 创建 `src/renderer/src/components/Elapsed.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { formatDuration } from '@/lib/duration';

/** 计时中每秒自 tick；仅该组件重渲染，全站最多一个在跑 */
export function Elapsed({ accumulatedMs, runningSince }: {
  accumulatedMs: number;
  runningSince: number | null;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (runningSince == null) return;
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [runningSince]);

  const ms = accumulatedMs + (runningSince != null ? Date.now() - runningSince : 0);
  return <span className="font-mono tabular-nums">{formatDuration(ms)}</span>;
}
```

- [ ] **Step 5: 运行测试 + typecheck**

Run: `npx vitest run tests/unit/duration.test.ts; npm run typecheck:web`
Expected: PASS，零错误

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/duration.ts src/renderer/src/components/Elapsed.tsx tests/unit/duration.test.ts
git commit -m "feat(timer): formatDuration helper and self-ticking Elapsed component"
```

---

### Task 4: TaskTimer 控件 + TaskItem 集成

**Files:**
- Create: `src/renderer/src/components/TaskTimer.tsx`
- Modify: `src/renderer/src/components/TaskItem.tsx`

**Interfaces:**
- Consumes: `window.api.todos.startTimer/pauseTimer`, `Elapsed`, `formatDuration`
- Produces: `<TaskTimer item={OccurrenceItem} />`

- [ ] **Step 1: 创建 `src/renderer/src/components/TaskTimer.tsx`**

```tsx
import type { MouseEvent } from 'react';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Elapsed } from '@/components/Elapsed';
import { formatDuration } from '@/lib/duration';
import { cn } from '@/lib/utils';
import type { OccurrenceItem } from '@shared/types';

/** 计时控件：idle=开始 / running=暂停 / paused=继续 / done=用时；重复任务带发生日 */
export function TaskTimer({ item }: { item: OccurrenceItem }) {
  const timer = item.timer ?? null;
  const done = item.state === 'done';
  const running = timer?.runningSince != null;
  const dateArg = item.repeatType === 'none' ? undefined : item.date;

  if (done) {
    return timer?.totalMs != null ? (
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        用时 {formatDuration(timer.totalMs)}
      </span>
    ) : null;
  }

  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    if (running) void window.api.todos.pauseTimer(item.todoId, dateArg);
    else void window.api.todos.startTimer(item.todoId, dateArg);
  };

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={toggle}
        aria-label={running ? '暂停计时' : '开始计时'}
        title={running ? '暂停计时' : '开始计时'}
      >
        {running ? <Pause /> : <Play />}
      </Button>
      {timer && (timer.accumulatedMs > 0 || running) && (
        <span className={cn('font-mono text-[11px]', running ? 'text-primary' : 'text-muted-foreground')}>
          <Elapsed accumulatedMs={timer.accumulatedMs} runningSince={timer.runningSince} />
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 2: TaskItem 集成**

在 `src/renderer/src/components/TaskItem.tsx` 顶部 import 增补：

```ts
import { TaskTimer } from '@/components/TaskTimer';
```

在行内「重复」徽标之后、`</div>` 之前插入：

```tsx
          <TaskTimer item={item} />
```

- [ ] **Step 3: typecheck + build**

Run: `npm run typecheck; npm run build`
Expected: 零错误

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/TaskTimer.tsx src/renderer/src/components/TaskItem.tsx
git commit -m "feat(timer): start/pause control with live elapsed in task rows"
```

---

### Task 5: StripRow 集成 + 全量验证

**Files:**
- Modify: `src/renderer/src/views/StripView.tsx`

**Interfaces:**
- Consumes: `TaskTimer`（Task 4）

- [ ] **Step 1: StripRow 内加计时控件**

`src/renderer/src/views/StripView.tsx` 顶部 import 增补：

```ts
import { TaskTimer } from '@/components/TaskTimer';
```

`StripRow` 的返回 JSX 内，在 `{item.timeOfDay && (...)}` 之后、`</div>` 之前插入：

```tsx
      <TaskTimer item={item} />
```

- [ ] **Step 2: 全量验证**

Run: `npm run typecheck; npm test; npm run build`
Expected: typecheck 零错误；测试全绿（原 65 + 新增约 18）；构建成功

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/views/StripView.tsx
git commit -m "feat(timer): show timer control in strip expanded rows"
```

- [ ] **Step 4: 手动验证清单**

- [ ] 今日视图任务行出现 ▶ 按钮
- [ ] 点 ▶ → 变 ⏸ 且用时每秒跳动
- [ ] 点 ⏸ → 用时冻结，按钮回 ▶
- [ ] 开始任务 A 后开始任务 B → A 自动暂停
- [ ] 勾选完成 → 行尾显示「用时 X」
- [ ] 取消完成 → 用时消失，再 ▶ 继续累加
- [ ] 重启应用时正在计时的任务 → 用时继续正确
- [ ] 日历 Sheet 内任务行同样有计时控件
