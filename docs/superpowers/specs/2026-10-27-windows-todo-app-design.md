# Windows 桌面 Todo App 设计规格

- 日期：2026-10-27
- 状态：已与用户逐节确认
- 范围：仅 Windows 端（x64），个人使用场景

## 1. 产品概述

一款常驻系统托盘的 Windows 桌面 Todo 应用：

- **开机自启进托盘**：自启后静默常驻后台，保证提醒随时可达；设置页可开关。
- **普通 Todo + 周期重复任务**：支持每天/每周/每月/自定义间隔的重复规则。
- **应用内日历视图**：月视图展示任务发生日，点选日期查看/添加当天任务（不联动系统/在线日历）。
- **系统通知提醒**：通过 Windows 通知中心（Toast）在任务到期时刻送达，点击通知唤起主窗口。
- **全局热键快速添加**：任意界面下 `Ctrl+Alt+A` 弹出轻量快添窗，回车即建今日任务。
- **本地存储**：SQLite（better-sqlite3），无云同步。

### 明确不做（YAGNI 边界）

- 不做自然语言解析的快速添加（快添窗仅"标题 + 回车建今日任务"）
- 不做系统日历 / Google 日历 / ICS 同步
- 不做多设备云同步、多用户、协作
- 不渲染层 e2e 测试、不做自动更新、不做代码签名
- 主窗关窗 = 最小化到托盘（不提供"关窗即退出"选项，退出走托盘菜单）

## 2. 技术栈与工程骨架

| 层 | 选型 |
|---|---|
| 脚手架 | electron-vite（main / preload / renderer 三入口）+ TypeScript 全栈 |
| UI | React 19 + Tailwind CSS v4 + shadcn/ui；日历底层用 react-day-picker |
| 数据 | better-sqlite3（主进程独占），electron-log（日志），electron-store 不使用（设置存 SQLite） |
| 打包 | electron-builder，NSIS x64 安装包 |
| 测试 | Vitest（单元 + 集成，内存 SQLite） |

关键依赖清单：`electron`、`electron-vite`、`electron-builder`、`react`、`react-dom`、`tailwindcss`、`shadcn/ui 组件`、`react-day-picker`、`better-sqlite3`、`electron-log`、`vitest`。

## 3. 数据模型（SQLite）

数据库文件：`%APPDATA%\whchem-todo\todo.db`。共 3 张业务表 + 1 张设置表，全部由主进程访问。

### 3.1 `todos` —— 任务本体

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `title` | TEXT NOT NULL | 任务标题 |
| `notes` | TEXT | 备注，可空 |
| `priority` | INTEGER NOT NULL DEFAULT 1 | 0=低 / 1=中 / 2=高 |
| `due_date` | TEXT | 到期日 `YYYY-MM-DD`（本地日期），日历视图按此查询 |
| `time_of_day` | TEXT | 当日提醒时刻 `HH:mm`；为空 = 只显示在日历、不发 Toast |
| `repeat_type` | TEXT NOT NULL DEFAULT 'none' | `none` / `daily` / `weekly` / `monthly` / `custom` |
| `repeat_interval` | INTEGER | 配合 `custom` 的间隔天数（如每 3 天）；其余类型视为 1 |
| `repeat_weekdays` | TEXT | `weekly` 时生效，JSON 数组（0=周日…6=周六），如 `[1,4]` |
| `monthly_mode` | TEXT | `monthly` 时生效：`by_date`（每月几号）/ `by_weekday`（每月第 N 个周几） |
| `monthly_day` | INTEGER | `by_date` 的目标日（1–31） |
| `monthly_weekday` / `monthly_which` | INTEGER | `by_weekday` 的目标周几（0–6）与第几个（1–5，5=最后一个） |
| `start_date` | TEXT | 重复序列起算日（锚点，决定"第几个周几"与 custom 间隔的相位） |
| `completed_at` | INTEGER | 一次性任务的完成时间戳（Unix 毫秒）；重复任务恒为 NULL |
| `created_at` / `updated_at` | INTEGER NOT NULL | Unix 毫秒时间戳 |

### 3.2 `occurrence_states` —— 重复任务的发生态

| 字段 | 类型 | 说明 |
|---|---|---|
| `todo_id` | INTEGER NOT NULL，FK→todos.id | 级联删除 |
| `occurrence_date` | TEXT NOT NULL | 具体发生日 `YYYY-MM-DD` |
| `status` | TEXT NOT NULL | `done` / `skipped` |
| 主键 | (`todo_id`, `occurrence_date`) | 复合主键 |

**核心策略：虚拟展开**。重复任务不预生成实例。日历/列表查询时，`TodoService` 按 `start_date + repeat 规则`在请求区间内计算发生日；完成某一天仅写入一行 `occurrence_states`。库中永远只有一条 todo 记录，修改重复规则不产生历史实例不一致问题。

### 3.3 `reminders` —— 提醒调度队列

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `todo_id` | INTEGER NOT NULL，FK→todos.id | 级联删除 |
| `occurrence_date` | TEXT NOT NULL | 本次提醒对应的发生日 |
| `fire_at` | INTEGER NOT NULL | 绝对触发时刻（Unix 毫秒） |
| `status` | TEXT NOT NULL DEFAULT 'pending' | `pending` / `fired` / `snoozed` / `dismissed` |
| `snoozed_until` | INTEGER | 稍后再提醒的新触发时刻 |
| `created_at` | INTEGER NOT NULL | |

调度器只认这张表。为"今天/下一个发生日 + time_of_day"写入 pending 行；触发后翻 `fired`；`snoozed` 由调度器按 `snoozed_until` 重新排期。应用重启时从 `fire_at > now` 的 pending/snoozed 行恢复定时——**提醒可靠性不依赖渲染进程存活**。

### 3.4 `settings` —— 键值表

`key TEXT PRIMARY KEY, value TEXT NOT NULL`。当前键：`autostart`（bool）、`theme`（`light`/`dark`/`system`）、`notify_sound`（bool）、`quickadd_shortcut`（字符串，默认 `Ctrl+Alt+A`）。开机自启的实际真相以 `app.getLoginItemSettings()` 为准，本表仅作 UI 意图记录。

## 4. 进程架构与 IPC 契约

```
┌─────────────────────────────────────────────────┐
│ Main 进程                                        │
│  ├─ DbService        better-sqlite3、迁移、DAO    │
│  ├─ TodoService      CRUD + 发生日虚拟展开         │
│  ├─ Scheduler        排 setTimeout、发通知、滚动排期 │
│  ├─ TrayManager      托盘图标、菜单、关窗最小化      │
│  ├─ QuickAddManager  快添窗创建/隐藏/复用           │
│  └─ SettingsService  自启(setLoginItemSettings)/主题 │
├─────────────────────────────────────────────────┤
│ Preload：contextBridge 暴露 window.api（白名单）    │
├─────────────────────────────────────────────────┤
│ Renderer（React + shadcn/ui，无 Node 权限）        │
│  视图：今日 / 日历(月) / 全部任务 / 设置            │
└─────────────────────────────────────────────────┘
```

**安全基线**：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；渲染进程只能经 `window.api` 通信。

**IPC 契约**：`src/shared/ipc.ts` 单一定义通道名与请求/响应类型，主/渲染共用。

| 通道 | 方向 | 载荷 → 返回 | 说明 |
|---|---|---|---|
| `todos:list` | invoke | `{ range: {from, to} }` → `OccurrenceItem[]` | 日历/列表查询，返回**已展开**的带具体日期扁平条目 |
| `todos:create` | invoke | `TodoDraft` → `Todo` | 成功后主进程立即排入 reminders |
| `todos:update` | invoke | `{ id, patch }` → `Todo` | 旧 pending reminders 置 dismissed 后重排 |
| `todos:delete` | invoke | `{ id }` → `void` | 级联清理 reminders / occurrence_states |
| `todos:complete` | invoke | `{ todoId, date? }` → `void` | 一次性置 completed_at；重复任务写 occurrence_states(done) 并排下一期 |
| `todos:setStatus` | invoke | `{ todoId, date, status }` → `void` | 跳过/恢复某个发生日 |
| `todos:snooze` | invoke | `{ todoId, date, minutes }` → `void` | 稍后再提醒（写 snoozed） |
| `todos:preview` | invoke | `{ draft, todoId? }` → `string[]` | 编辑对话框实时预览：返回前 5 个发生日；编辑态传 todoId 排除 done/skipped（复用 `todos:list` 同一展开函数） |
| `settings:get` / `settings:set` | invoke | 键值 | 自启/主题/音效/热键 |
| `app:show-main` | ← send | `{ focusTodo?: {todoId, date} }` | 托盘/通知点击唤起主窗并定位任务 |
| `quickadd:open` | ← send | — | 全局热键触发，主进程创建/唤起快添窗 |
| `quickadd:open-editor` | invoke | `{ title }` → `void` | 快添窗 Ctrl+Enter：唤起主窗并打开预填编辑对话框 |
| `reminders:changed` | ← send | — | 队列变动广播，渲染层刷新角标 |

`OccurrenceItem`：`{ todoId, date, title, priority, timeOfDay, repeatType, state: 'active'|'done'|'skipped', overdue }`——所有"今天该做什么"的计算（重复展开、时区归一、逾期判定）都在主进程完成，UI 不实现任何 RRULE 逻辑。

### 4.1 调度器规则（三条硬规则）

1. 每次只排**一个** `setTimeout` 指向最近的 `fire_at`；触发或唤醒后重查队列取下一个——避免大量 timer 常驻。
2. 触发时若机器处于睡眠，`powerMonitor.on('resume')` 全量重排；已过期的 pending **立即补发**，通知标题前缀"⚠ 已过期"；同一时刻多条过期合并为一条汇总通知（"n 条任务已过期"，点击逐条列出）。
3. 任务编辑/删除时，对应 pending/snoozed reminders 置 `dismissed` 并重排。

全局暂停：托盘菜单"暂停所有提醒 1 小时"实现为 Scheduler 的静音截止时间戳，期间到期的提醒直接标 `fired` 不弹出；暂停结束后过期项按规则 2 补发。

### 4.2 通知与自启

- 通知：主进程 `new Notification({ title, body, icon }).show()`；`on('click')` 唤起主窗定位任务；`on('close')` 视为已读。Windows 下自动进入通知中心，遵循专注助手。
- 自启：`app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })`（写注册表 Run 键，零额外依赖）；主进程检测 `--hidden` 参数 → 启动即隐藏主窗、只显示托盘。设置页 Switch 进入时回显 `getLoginItemSettings()` 真实状态（防止用户在 Windows 设置中改动造成 UI 失真）。
- 单实例：`app.requestSingleInstanceLock()`；二次启动 → 唤起已有主窗。
- 托盘：图标 + 菜单（打开主窗口 / `今日待办 n 条`（禁用项纯展示，随队列变动实时刷新文案）/ 暂停所有提醒 1 小时 / 退出）。主窗关窗按钮 = 隐藏到托盘；首次点击时气泡提示一次"应用在后台继续运行提醒"。

## 5. UI 设计

主窗口 1200×750（最小 960×600），无边框自定义标题栏（`titleBarStyle: 'hidden'` + 自绘窗口按钮，shadcn 一体化风格），左侧导航 + 右侧内容区。

### 5.1 今日（默认首页）

- 顶部大字日期 + 逾期计数徽标。
- 两个分组列表：**今日发生**、**已逾期**。
- 条目右键菜单：完成 / 跳过今天 / 稍后再提醒（10 分钟）/ 编辑。
- 顶部快速添加输入框：输入标题回车 = 创建今日到期、不提醒的普通 Todo（显式规则，不解析自然语言）。

### 5.2 日历（核心视图）

- 月视图：shadcn `Calendar`（react-day-picker）扩展网格。每格渲染优先级色点 + 任务数；**单日最多显示 3 条标题缩写，超出显示 `+n`**。
- 点选日期 → 右侧 `Sheet` 滑出面板：当天任务列表 + 内联添加（日期预填所选日）。
- 顶部工具条：月视图/列表切换、"今天"按钮、月份翻页。

### 5.3 全部任务

- 简单虚拟滚动列表（自研 `VirtualList`，行高固定 44px）。
- 筛选：状态（进行中/已完成/全部）× 优先级。已完成归档区可折叠。

### 5.4 设置

- 开机自启 `Switch`（读写 `setLoginItemSettings`，回显真实状态）。
- 主题：亮/暗/跟随系统（`Tabs`）。
- 通知音效 `Switch`。
- 快速添加热键自定义（输入新组合键 → 主进程先 unregister 再注册；冲突则回退默认并提示）。
- 数据库位置只读展示 + "打开所在文件夹"。
- "立即测试通知"按钮。
- 通知权限状态指示：检测到 `Notification.isSupported()` 为 false 时显示黄色警示 + 跳转 Windows 通知设置按钮（`shell.openExternal('ms-settings:notifications')`）。

### 5.5 任务编辑对话框（创建/编辑共用 `Dialog`）

- 标题（Input）、备注（Textarea）、优先级（Select）。
- 日期（Popover + Calendar）、提醒时刻（`Input type=time`，留空则不提醒）。
- 重复（Select：不重复/每天/每周/每月/自定义间隔）：
  - `每周` → 展开周几 `ToggleGroup`（多选）
  - `每月` → 展开 `by_date`（每月 X 号）/ `by_weekday`（第 N 个周几）二级选择
  - `自定义` → 展开间隔天数数字输入
- 表单是重复规则的唯一真相源，提交时映射为数据模型 repeat 字段。
- 底部实时预览："下次出现：周四 10/29 · 周五 10/30 …"——调用主进程展开引擎计算前 5 次发生日（经 `todos:preview` invoke 通道，复用 `todos:list` 同一展开函数）。

### 5.6 快速添加窗（独立小窗）

- 默认全局快捷键 `Ctrl+Alt+A`（`globalShortcut`，任何前台应用下可唤起；设置页可自定义）。
- 窗口：无边框约 560×120，仅输入框 + 一行操作提示；`skipTaskbar: true`、`alwaysOnTop`；失焦/Esc/点窗外自动隐藏；首次唤起时创建、之后复用隐藏。
- 行为：
  - 回车 = 创建"今日到期、不提醒"普通 Todo，窗口关闭，Sonner 确认
  - `Ctrl+Enter` = 打开主窗完整编辑对话框（预填已输入标题）；主窗不存在时先创建再传参
  - 空输入回车 = 直接关闭，不产生垃圾任务
- 唤起位置：记住当前光标所在显示器，窗口居中于该屏。

### 5.7 shadcn 组件清单

Button、Input、Textarea、Select、Switch、Tabs、Dialog、Sheet、Popover、Calendar、ToggleGroup、Checkbox、Badge、Tooltip、DropdownMenu、Separator、ScrollArea、Sonner（操作反馈 toast）。

## 6. 错误处理

| 场景 | 策略 |
|---|---|
| SQLite 写入失败 | DAO 层统一 try → electron-log 记日志 → IPC 返回 `{ ok:false, code, message }` → 渲染层 Sonner 红色 toast |
| 数据库文件损坏 | 启动迁移前用 `PRAGMA integrity_check` 检测；失败则旧库改名 `todo.db.corrupt.<时间戳>` 并建新库，弹对话框告知可手动恢复 |
| 通知发送失败（系统权限关闭） | `isSupported()` + `on('failed')` 双检；失败仍标记 fired；设置页黄色警示 + 跳转 Windows 设置按钮 |
| 睡眠错过提醒 | `powerMonitor 'resume'` 全量重排，过期立即补发"⚠ 已过期"前缀，多条合并汇总 |
| 全局热键被占用 | 注册失败回退默认值并在设置页提示，不崩溃 |
| 渲染进程崩溃 | `render-process-gone` → 自动 reload 窗口；托盘与提醒链路（主进程）不受影响 |
| 未捕获异常 | `process.on('uncaughtException'/'unhandledRejection')` 记日志后保持存活（托盘应用不能闪退）；连续 5 次/分钟才弹窗询问是否退出 |
| 二次实例启动 | `second-instance` 事件唤起已有主窗，新进程退出 |

日志：electron-log，路径 `%APPDATA%\whchem-todo\logs\main.log`，按天轮转保留 7 天。

## 7. 测试策略

- **单元测试（Vitest，纯逻辑）**：重复展开引擎是全项目最高风险点，独立纯函数模块 `src/shared/recurrence.ts`（无 Electron/DB 依赖），用例必须覆盖：
  - 月末滚动：1月31日"每月 31 号"在 2 月的行为（当月无此日 → 跳过该月，顺延次月）
  - 2月29日闰年：`by_date=29` 在平年 2 月跳过、闰年出现
  - `by_weekday` 第 N 个周几（含 5=最后一个）
  - 跨时区/夏令时切换日的提醒时刻正确性（按本地时区计算，DST 跳变当天取实际存在时刻）
  - `skipped` / `done` 状态对展开结果与"下一个发生日"预览的过滤
- **调度器单测**：fire_at 推导、snooze 重排、编辑后重排、暂停 1 小时窗口逻辑。
- **集成测试（Vitest + 内存 SQLite `:memory:`）**：DAO + TodoService 全链路——建重复任务→区间展开→完成某日→改规则→删任务→reminders 队列联动断言。
- **手动验收清单（发布前真机走查，附录于 §9）**：Toast 送达/点击唤起定位、睡眠唤醒补发、全局热键全屏应用下唤起、注册表自启项验证、通知权限关闭降级提示。
- 不引入 Playwright/渲染层 e2e（单机工具，核心逻辑已被前两层锁定，YAGNI）。

## 8. 打包与分发

- electron-builder，`nsis` x64，产物安装器 `.exe`（个人使用，用户级安装即可）。
- `better-sqlite3`：`asarUnpack` + 依赖 npm 安装期预编译二进制，运行环境免装 VC++ 工具链。
- 应用数据目录：`%APPDATA%\whchem-todo\`（todo.db、logs/）。
- 资源：托盘 16/32px ICO、通知图标、安装器品牌图（NSIS installerIcon）。
- **不做代码签名**（个人使用；首次运行 SmartScreen 可能警告）。
- 自动更新 v1 不含；electron-builder 配置预留 publish 注释位。
- 项目名/包名：`whchem-todo`，productName `WhchemTodo`。

## 9. 手动验收清单

- [ ] 全新机器安装 → 开机后托盘图标存在，主窗不弹出
- [ ] 设置页开关自启 → `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 对应项增删一致
- [ ] 创建"每天 18:30"任务 → 次日日历显示，18:30 Toast 送达，点击通知主窗定位该任务
- [ ] 创建"每月31号"任务 → 2月无发生、3月31有发生，预览行显示正确
- [ ] Toast 送达前让机器睡眠 10 分钟再唤醒 → 补发"⚠ 已过期"通知
- [ ] 托盘"暂停所有提醒 1 小时" → 期间无 Toast，之后恢复且过期项补发
- [ ] 全屏游戏中按 `Ctrl+Alt+A` → 快添窗置顶弹出，回车后任务出现在今日
- [ ] 快添窗 `Ctrl+Enter` → 主窗唤起且编辑对话框预填标题
- [ ] 关主窗 → 托盘仍在，提醒功能正常；托盘退出 → 进程完全结束、热键释放
- [ ] 二次启动 exe → 不产生新实例，唤起已有主窗
- [ ] 关闭系统通知权限 → 设置页显示警示并可跳转修复
- [ ] 删除重复任务 → 日历条目消失，未触发提醒不再送达

## 10. 决策记录（与用户确认的选型）

| 决策 | 结论 | 理由 |
|---|---|---|
| 日历形态 | 应用内日历视图 | 无外部 OAuth/同步复杂度，满足查看需求 |
| 定时语义 | 周期重复任务 + 到期日提醒 | 覆盖例会/打卡等场景 |
| 提醒通道 | 系统通知 Toast | 后台常驻可达、原生体验 |
| 存储 | SQLite 本地库 | 范围查询与展开性能，可持续演进 |
| 运行形态 | 自启进托盘 | 保证提醒随时可达 |
| 快速添加 | 全局热键 + 独立快添窗 | 任意场景低摩擦捕捉 |
| 工程骨架 | electron-vite + 主进程 IPC 服务层（方案 A） | Forge 体验略逊；tRPC/RxJS 过度设计 |
| 重复实例策略 | 虚拟展开 + occurrence_states | 避免历史实例不一致 |
| 自然语言解析 | 不做 | 解析歧义与训练数据成本不匹配收益 |
| 签名/自动更新 | 不做 | 个人使用，v1 不引入 |
