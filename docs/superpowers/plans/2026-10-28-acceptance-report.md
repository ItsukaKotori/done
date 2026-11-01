# WhchemTodo 验收报告（Task 16）

- 日期：2026-10-28
- 分支/提交：feat/windows-todo-app
- 安装包：dist/WhchemTodo Setup 0.1.0.exe（NSIS x64，用户级）
- 自动化证据：Vitest 65/65 绿；`npm run typecheck` 无错误；生产构建 CSP meta 注入验证；
  win-unpacked 冒烟（主进程 4 存活、`[shortcut] registered Ctrl+Alt+A` 日志、todo.db 建立于 %APPDATA%\whchem-todo）；
  最终全分支审查通过（修复集 cbf682e 落地：改期锚点守卫、完成/跳过排下一期、生产 CSP、合并通知文案、快添窗错误反馈）

## 规格 §9 手动验收清单

| # | 项目 | 状态 | 备注 |
|---|---|---|---|
| 1 | 安装 → 开机自启 → 重启后仅托盘无窗口 | ⏳ 待走查 | 需重装 + 重启系统 |
| 2 | 自启开关 ↔ 注册表 Run 键一致 | ⏳ | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 查 WhchemTodo |
| 3 | 每日任务到点 Toast、点击唤起定位 | ⏳ | 建"2 分钟后 每天"任务观察 |
| 4 | 每月31号：2 月无、3 月有、预览正确 | ✅(自动化) + ⏳(UI) | 展开引擎测试锁定；UI 预览行走查 |
| 5 | 睡眠唤醒补发"⚠ 已过期"，多条合并 | ⏳ | |
| 6 | 托盘暂停 1 小时 → 静默；结束恢复 | ⏳ | 注意：暂停期内到期的提醒按实现为静默丢弃（终审次要-7 文案项） |
| 7 | 全屏应用中 Ctrl+Alt+A 弹出快添窗、回车建今日 | ⏳ | |
| 8 | 快添窗 Ctrl+Enter → 主窗编辑预填 | ⏳ | |
| 9 | 关主窗 → 托盘仍提醒；托盘退出 → 进程结束、热键失效 | ⏳ | |
| 10 | 二次启动 exe → 唤起已有窗口 | ⏳ | |
| 11 | 关闭系统通知权限 → 设置页警示 + 跳转 | ⏳ | |
| 12 | 删除重复任务 → 日历消失、提醒不再送达 | ⏳ | |

## 已知遗留（终审 Minor 清单，可延后）

- 跨零点/触发后托盘"今日待办 n"计数刷新时机（建议 tick 回调串 refreshTrayCount）
- 日志"按天轮转 7 天"未实现（当前 maxSize 5MB 截断）
- Notification 未显式传 icon（Windows 回退应用用户模型 ID 图标）
- 快添窗保存失败时主进程无 console 痕迹（仅渲染层 toast）
- snooze 连点两次产生两行（10 分钟后合并通知，语义可接受）
- showMain 在窗口从未创建销毁后 send 早于挂载的极端丢事件
