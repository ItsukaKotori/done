# 收缩长条模式（Strip Mini-Mode）设计规格

## 摘要

主窗口新增「收缩为长条」模式：标题栏按钮触发后，主窗隐藏、屏幕顶边出现一条 32px 水平长条循环滚动当日待办；点击长条展开下拉面板快速完成 TODO；面板内「展开主窗」按钮恢复完整窗口。

## 动机

用户日常高频使用待办应用，但完整主窗占据大量桌面空间。收缩长条让用户在不切换焦点的情况下"余光扫到"今日任务，并通过最少操作（一次点击 + 勾选）完成 TODO。

## 架构

### 窗口拓扑

```
AppWindowController
├── main        现有主窗（1200×750）
├── quickAdd    现有快速添加浮窗（560×120）
└── strip       新增：收缩长条（workArea.width × 32/380）
```

### Strip 窗口属性

| 项 | 值 |
|---|---|
| 宽 | 主窗所在显示器 workArea.width |
| 高（收起） | 32px |
| 高（展开） | 380px |
| 位置 | workArea.x, workArea.y（贴屏顶） |
| frame | false |
| alwaysOnTop | true |
| resizable | false |
| movable | false |
| skipTaskbar | true |
| closable | false |
| minimizable | false |
| maximizable | false |
| transparent | false |
| backgroundColor | 创建时从 settingsDao 读取 theme 并映射为 hex（亮 #fbfaf7 / 暗 #10141b），主题变更不热更新 strip 背景 |

### 生命周期

1. **创建**：首次 `collapseToStrip()` 时 lazy 创建（同 QuickAdd 模式），加载 `?win=strip`
2. **显示**：`main.hide()` → `strip.show()` → `strip.focus()`
3. **收起↔展开**：`toggleStrip()` resize 高度 32↔380 + send `EventStripState`
4. **恢复主窗**：`strip.hide()` → `showMain()`
5. **销毁**：`app.quit()` 时随主进程退出；`on('closed')` 置 null 防悬挂引用

### 多显示器

通过 `screen.getDisplayMatching(main.getBounds())` 确定主窗所在屏，strip 贴该屏 workArea 顶部。

## IPC 通道

集中管理于 `src/shared/ipc.ts`：

| 通道常量 | 方向 | 载荷 | 用途 |
|---|---|---|---|
| `Ipc.CollapseStrip` = `'win:collapse-strip'` | renderer → main | 无 | 标题栏「收缩」 |
| `Ipc.StripToggle` = `'win:strip-toggle'` | renderer → main | 无 | 长条点击切态 |
| `Ipc.ExpandMain` = `'win:expand-main'` | renderer → main | 无 | 「展开主窗」 |
| `Ipc.EventStripState` = `'strip:state'` | main → strip renderer | `{ expanded: boolean }` | 通知渲染层当前态 |

### WindowOps 接口扩展

```ts
interface WindowOps {
  // 现有...
  collapseToStrip(): void;
  toggleStrip(): void;
  expandFromStrip(): void;
}
```

### Preload 新增

```ts
window.api.win.collapseStrip()
window.api.win.stripToggle()
window.api.win.expandMain()
window.api.win.onStripState(cb: (state: { expanded: boolean }) => void): () => void
```

## 渲染层

### 路由

`App.tsx` 新增分支：

```tsx
const win = new URLSearchParams(window.location.search).get('win');
if (win === 'quickadd') return <QuickAddView />;
if (win === 'strip') return <StripView />;
return <MainShell />;
```

### StripView 组件

两态：collapsed（32px）/ expanded（380px），由 `EventStripState` 驱动。

#### 收起态（32px）

```
[◀ 展开主窗]  ·  任务A · 任务B · 任务C · ...  ·  | 已逾期 2 · 今日 5 |
```

- 左侧：图标按钮（lucide Maximize2），点击 → `win:expand-main`
- 中间：今日 active 标题用 ` · ` 拼接，CSS marquee 水平无缝循环（内容渲染两遍），hover 暂停
- 右侧：`已逾期 N · 今日 M` 计数（font-mono text-[11px]）
- 整条非按钮区域可点击 → `win:strip-toggle`
- 无任务时：中间静态显示「暂无安排」，不启动滚动

#### 展开态（380px）

```
[收起态 32px 长条（点击收起）]
──────────────────────────────
已逾期
  ☐ 整理季度报销单    10-21 09:00  逾期
  ☐ 回复供应商询价    10-26        逾期  重复
今日
  ☐ 给阳台植物换土
  ☐ 提交安全扫描结果  17:00        重复
──────────────────────────────
[展开主窗]
```

- 顶部 32px 与收起态相同（点击 → `win:strip-toggle` 收起）
- 下方 348px：今日列表（复用 useTodos hook + 简化版 TaskRow）
  - 每行 = 勾选框 + 优先级点 + 标题 + 时刻/逾期标注
  - 勾选 → `window.api.todos.complete` + `markCompleted`（动效一致）
  - 逾期排前，琥珀色时刻
- 底部固定：「展开主窗」文字按钮 → `win:expand-main`
- blur 事件（BrowserWindow 级别 `strip.on('blur')`）→ 主进程 resize 为 32px + send EventStripState({ expanded: false })

### Marquee 实现

```css
@keyframes marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
```

内容渲染两份，容器 `overflow: hidden; white-space: nowrap; display: flex;`，动画时长 = `内容宽度 / 速度`（约 40px/s）。`prefers-reduced-motion: reduce` 下 `animation: none`，退化为静态显示前 N 条。

## 边界情况

| 场景 | 处理 |
|---|---|
| strip 显示时收到提醒通知 | 通知照常弹出；点击通知 → expandFromStrip + showMain + focusTodo |
| strip 显示时全局热键 QuickAdd | 正常弹出 QuickAdd 窗（独立于 strip），不冲突 |
| 主窗最小化时点「收缩」 | 先 restore 再 hide，strip 正常显示 |
| strip 被系统销毁 | `on('closed')` 置 null，下次 collapse 重新创建 |
| 展开态 blur | 自动收起为 32px（strip 保持可见） |
| 主窗关闭（隐藏到托盘）| strip 若显示则一并隐藏 |
| 今日无任务 | 长条显示「暂无安排」，不滚动 |
| 数据变更（其他窗完成/新增）| EventDataChanged → strip 内 useDataVersion 自动刷新 |

## 测试策略

| 层 | 内容 |
|---|---|
| 单元测试 | StripView 两态切换逻辑（mock IPC）；marquee 文案拼接；空态判断 |
| 集成测试 | collapseToStrip → strip 存在 + main 隐藏；toggleStrip → 高度变化 + EventStripState；expandFromStrip → strip 隐藏 + main 显示 |
| 手动验证 | 多屏、通知唤起、热键并行、无任务空态、blur 自动收起、reduced-motion |

## 约束

- 不改动现有 IPC 通道行为（纯新增）
- 不改动数据层（DAO/Service/Scheduler）
- StripView 仅展示今日 + 逾期，不提供新建/编辑/删除（YAGNI）
- 快速添加（全局热键）独立于 strip，不整合
