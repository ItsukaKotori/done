# 任务计时（Task Timer）设计规格

## 摘要

为待办任务增加计时能力：开始计时 → 暂停/继续 → 完成时冻结并记录用时。支持一次性任务与重复任务的每一期（occurrence）独立计时，同一时刻最多一个任务在计时。

## 动机

用户希望记录"真正花在任务上的时间"。简单耗时（完成时刻-开始时刻）无法反映中途暂停，故需要累计实际计时段的模型；重复任务需要按"本期"而非整个任务计时。

## 决策记录

| 决策点 | 选择 | 理由 |
|---|---|---|
| 暂停/继续 | 支持 | 累计实际计时段，暂停期间不计 |
| 并发 | 单任务计时 | 开始新任务时自动暂停上一个 |
| 重复任务 | 按 occurrence 计时 | 每期独立，写入 `(todo_id, occurrence_date)` |
| 取消完成后 | 保留累计、后续继续累加 | `total_ms` 清零、`accumulated_ms` 保留、`running_since` 置空 |

## 数据模型

### 新表 `task_timers`

沿用 `occurrence_states` 的 `(todo_id, occurrence_date)` 复合键模式：

```sql
CREATE TABLE task_timers (
  todo_id          INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  occurrence_date  TEXT    NOT NULL,            -- ''=一次性任务；YYYY-MM-DD=重复任务某期
  accumulated_ms   INTEGER NOT NULL DEFAULT 0,  -- 已暂停段累计
  running_since    INTEGER,                     -- 非空=正在计时（绝对时间戳）
  total_ms         INTEGER,                     -- 完成时冻结的最终用时
  PRIMARY KEY (todo_id, occurrence_date)
);
CREATE INDEX idx_task_timers_running ON task_timers(running_since);
```

- 一次性任务用 `occurrence_date = ''` 哨兵（避免 dueDate 变更导致计时行孤立）
- `running_since` 存绝对时间戳 → 应用重启后仍能正确计时
- `idx_task_timers_running` 支撑"查找当前正在计时的行"

### 迁移

`SCHEMA_VERSION` 1 → 2，`MIGRATIONS[2]` 增加建表 + 建索引语句。不改动 v1。

### 类型

`src/shared/types.ts` 新增：

```ts
export interface TimerState {
  accumulatedMs: number;
  runningSince: number | null;
  totalMs: number | null;
}
```

`Todo` 与 `OccurrenceItem` 各加可选字段 `timer?: TimerState | null`（可选，不影响既有 draft 构造）。

## 状态机

一个计时单元 = 一次性任务，或重复任务的某一期。

```
idle ──start──> running ──pause──> paused ──start(继续)──> running
                  │                   │
                  └──── complete ─────┴──> done (total_ms 冻结)
                                          │
                         un-complete ─────┘──> paused (保留 accumulated, 清 total)
```

- **实时用时** = `accumulated_ms + (running_since ? now - running_since : 0)`
- **单任务约束**：全表任意时刻最多一行 `running_since` 非空

## 服务层

`src/main/db/dao.ts` 新增 `TimerDao`：

```ts
class TimerDao {
  get(todoId: number, date: string): TimerState | null;
  getByTodo(todoId: number): Map<string, TimerState>;   // date -> state
  upsert(todoId: number, date: string, patch: Partial<TimerState>): void;
  pauseAllRunning(now: number): void;                    // 单任务约束
  settle(todoId: number, date: string, now: number): void; // complete 时冻结 total_ms
  resetCompleted(todoId: number, date: string): void;    // 取消完成：清 total，留 accumulated
}
```

`src/main/services/todo-service.ts` 新增/改造：

- **`startTimer(todoId, date?)`**：确定 `occDate`（一次性 `''`，重复 `date!`）→ `pauseAllRunning(now)` → `upsert(todoId, occDate, { runningSince: now, totalMs: null })`（若原为 paused，accumulated 保留；同时清 total 以防从 done 状态重开）
- **`pauseTimer(todoId, date?)`**：仅当该单元 `running_since` 非空时结算：`accumulated += now - runningSince; runningSince = null`（非 running 时为空操作，幂等）
- **`complete(todoId, date?)` 改造**：先 `settle(todoId, occDate, now)`（若 running 则累计后冻结 `total_ms`），再执行现有完成逻辑
- **`setStatus(todoId, date, status)` 改造**：
  - `done` → 先 `settle` 再完成（与 complete 对齐）
  - `active`（取消完成）→ `resetCompleted`（`total_ms=null`、`running_since=null`、`accumulated_ms` 保留）后恢复状态
  - `skipped` → 不改动计时数据
- `list(from, to)`：对每个 `OccurrenceItem` 关联 `timer`（一次性取 `map.get('')`，重复取 `map.get(d)`）
- `listAll(status)`：为一次性任务关联 `timer`（`map.get('')`）；重复任务 `timer` 为 null（任务级视图不含期级计时）

## IPC

`src/shared/ipc.ts`：

| 通道 | 载荷 | 作用 |
|---|---|---|
| `TodosStartTimer` = `'todos:start-timer'` | `(todoId, date?)` | 开始/继续（内部先暂停其他 running） |
| `TodosPauseTimer` = `'todos:pause-timer'` | `(todoId, date?)` | 暂停 |

两者处理完成都调 `windows.broadcastChanged()`，让主窗与 strip 同步。

`Api.todos` 扩展：

```ts
startTimer(todoId: number, date?: string): Promise<void>;
pauseTimer(todoId: number, date?: string): Promise<void>;
```

## 渲染层

### TaskItem（今日视图 + 日历 Sheet 共用）

行内新增计时控件（标题右侧、状态徽标之后）：

| 状态 | 按钮 | 用时显示 |
|---|---|---|
| idle | ▶ 开始 | — |
| running | ⏸ 暂停 | 实时跳动 `12:34` |
| paused | ▶ 继续 | 冻结 `12:34`（弱化色） |
| done | 无 | `用时 1:02:33` |

- 按钮：`Button variant="ghost" size="icon-xs"`，`Play` / `Pause`（lucide）
- 点击按钮不得触发行的编辑/菜单（`e.stopPropagation()`）
- 重复任务 `date` 传 `item.date`；一次性任务不传

### `Elapsed` 组件（`src/renderer/src/components/Elapsed.tsx`）

```tsx
function Elapsed({ accumulatedMs, runningSince }: { accumulatedMs: number; runningSince: number | null })
```

- `runningSince` 非空时每秒自 tick（`setInterval`），仅该组件重渲染
- 用时 = `accumulatedMs + (runningSince ? Date.now() - runningSince : 0)`
- 渲染 `<span className="font-mono tabular-nums">`，内容为 `formatDuration`

### `formatDuration`（`src/renderer/src/lib/duration.ts`）

- `<1h`：`MM:SS`
- `≥1h`：`H:MM:SS`

### Strip 展开面板（StripRow）

紧凑的 ▶/⏸ 图标 + 实时用时，保持"快速完成"场景可顺手计时。收起态轮播行不加计时控件（空间有限）。

## 边界情况

| 场景 | 处理 |
|---|---|
| 开始任务 B 时任务 A 正在计时 | `pauseAllRunning` 暂停 A（累计保留），B 开始 |
| 完成一个正在计时的任务 | `settle` 自动结算并冻结 `total_ms` |
| 取消完成后 | 保留 `accumulated_ms`，清 `total_ms` 与 `running_since`；再次开始继续累加 |
| 跳过某期（recurring skipped） | 不改动计时数据 |
| 应用重启时正在计时 | `running_since` 为绝对时间戳，重启后实时用时自动正确 |
| 删除任务 | `ON DELETE CASCADE` 清理计时行 |
| 重复任务在 AllTasksView | 不显示计时控件（任务级视图无法表达期级计时） |

## 测试策略

| 层 | 内容 |
|---|---|
| 单元（TimerDao） | upsert 幂等；pauseAllRunning 累计正确；settle 冻结 total；resetCompleted 保留 accumulated |
| 单元（TodoService） | startTimer 抢占暂停其他；pauseTimer 累计；complete 冻结；setStatus('active') 保留累计 |
| 单元（formatDuration） | `<1h` / `≥1h` 格式 |
| 集成 | v1→v2 迁移建表成功且旧数据不丢；list/listAll 关联 timer 正确 |
| 手动 | 开始→暂停→继续→完成；跨任务抢占；重启后计时连续；取消完成后继续累加 |

## 约束

- 不改动现有 `completed_at` / `occurrence_states` 语义
- 计时仅作用于有日期的任务（与 list() 现有 anchor 约束一致）
- 单任务计时为硬约束，由服务层 `pauseAllRunning` 保证
- StripView 收起态不显示计时（仅展开态 StripRow）
