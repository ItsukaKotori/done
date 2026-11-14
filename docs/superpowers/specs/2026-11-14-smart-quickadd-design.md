# 智能快添（规则先行 + AI 增强）设计规格

- 日期：2026-11-14
- 状态：已与用户逐节确认
- 前置：演进路线图子项目 #1（产品定位：认真做产品）
- 关联：`2026-10-27-windows-todo-app-design.md`（原快添规格 §5.6 的升级）

## 1. 概述

升级快速添加窗（全局热键唤起的 560×`QUICK_H` 浮窗）为「智能快添」：

- **规则先行**：本地规则解析器零延迟解析输入（日期/时刻/重复/优先级/标签），实时显示解析 chips 预览，Enter 即建——不配 AI 也完整可用。
- **AI 增强**：用户配置国内大模型（DeepSeek / Qwen / GLM / Kimi / 自定义 OpenAI 兼容端点）后，停止输入 ~400ms 时后台调用，返回后整体替换预览并标注 `✨ AI` 徽章。解析模糊表述（"记得每天遛狗"、"下下周三交报告"）。

### 1.1 方案决策记录

| 方案 | 结论 |
|---|---|
| A：AI 优先（每次输入都调模型） | 否——建任务第一高频动作不能依赖网络往返 |
| **B：规则先行 + AI 增强** | **采纳**——零延迟基线 + 理解力上限；无 key 用户不受影响 |
| C：AI 显式触发 | 否——签名功能存在感弱 |

### 1.2 Provider 决策记录

国内模型优先（用户网络直连 `api.anthropic.com` 不可达，实测 GitHub 直连亦失败）。适配层留接口，未来 Anthropic 选项用官方 SDK 独立实现，**不做** OpenAI 兼容套壳。API Key BYOK（用户自备），v1 无托管服务。

## 2. 解析结果模型

```ts
// src/shared/parse.ts
import type { Priority, RecurrenceSpec } from './types';

export interface ParsedTask {
  title: string;
  dueDate: string | null;    // YYYY-MM-DD；相对日期已按 today 锚点解析为绝对日期
  timeOfDay: string | null;  // HH:mm
  priority: Priority;        // 缺省 1
  tags: string[];            // 已归一化
  repeat: RecurrenceSpec;    // 缺省 { repeatType: 'none', 其余 null }
  source: 'rules' | 'ai';
}
```

约定：

- **过去日期翻滚**：解析出的星期/日期若早于 today，取下一次发生日（`每周五` 在周六输入 = 下周五）。
- 重复任务的 `startDate = dueDate`（首个发生日）；无日期的重复任务（"每天喝水"）`startDate = today`。
- `ParsedTask → TodoDraft` 映射是纯函数（`src/shared/parse.ts`），`completedAt: null`、`notes: null`。

## 3. 规则解析器（M1）

`src/renderer/src/lib/nlp/rules.ts` — 纯函数 `parseTaskInput(input: string, today: string): ParsedTask`（`source: 'rules'`）。无副作用、无 IO，全量单测。

### 3.1 模式表

| 类别 | 模式（中文为主，数字/英文格式兼容） |
|---|---|
| 日期 | 今天/今日、明天/次日、后天、大后天、周X/星期X/礼拜X、下周X/下星期X、本月X号(日)、下月X号(日)、X月X号(日)、X月X日、YYYY-MM-DD、M/D |
| 时刻 | 早上/上午/中午/下午/傍晚/晚上X点(半/X点X分)、X点、X点半、X点X分、HH:mm、HH时mm分 |
| 重复 | 每天/每日、每周(六七八…可多个)、工作日(周一~周五)、每月X号(日)、每月第N个周X(5=最后一个)、每N天(N≥2) |
| 优先级 | 高优先级/重要/紧急/加急 → 2；低优先级/不急/有空再说 → 0 |
| 标签 | `#标签`（`#` 后非空白串，复用 `src/shared/tags.ts` 归一化） |

- 每周多日：`每周三五` → `repeatWeekdays = [3, 5]`（**0=周日…6=周六**，与 `types.ts` 现有约定一致）。
- 歧义消解：`周X` 同时匹配日期与重复时，有`每`字前缀 → 重复，否则 → 日期。
- 无年份日期（`X月X号`、`M/D`）：今年内取未来日期，今年已过则取明年。
- 剩余文本 trim 后即标题；全空则标题为空串（上层据此判定"未解析出结构"）。
- 中文数字日期（"十五号"）v1 不做，YAGNI。

### 3.2 输入法边界

仅解析**已提交文本**：IME 组合期间（`isComposing`）不解析，`compositionend` 后更新。现有 QuickAddView 已有该判断。

## 4. AI 解析层（M2）

### 4.1 IPC 契约

- `Ipc.AiParse = 'ai:parse'`，payload `{ input: string; today: string }`，返回 `R<ParsedTask>`（遵循现有 envelope）。
- 主进程 handler 在 `src/main/ipc.ts` 注册；服务实现 `src/main/services/ai-parser.ts`。

### 4.2 Provider 适配器

```ts
interface AiProvider {
  id: 'deepseek' | 'qwen' | 'glm' | 'kimi' | 'custom';
  label: string;
  baseUrl: string;        // custom 由用户填写
  defaultModel: string;   // custom 由用户填写
}
```

| 预设 | baseUrl | 默认模型 |
|---|---|---|
| deepseek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-turbo` |
| glm | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |

- 统一走 OpenAI 兼容 `POST {baseUrl}/chat/completions`，`response_format: { type: 'json_object' }`（四家均支持 JSON mode），主进程 Node `fetch` 实现，无新增 SDK 依赖。
- 模型名可在设置页覆盖预设默认值。
- 超时 3s `AbortController` abort。

### 4.3 Prompt

- system 固定：任务描述 + 输出 JSON schema（字段、格式、枚举、缺省语义）+ 3~5 个 few-shot（覆盖：纯标题 / 日期+时刻 / 复杂重复 / 优先级+标签 / 模糊表述）。
- user：原始输入文本 + `today` 锚点。
- 要求：无法确定的字段返回 null/缺省；**标题必须保留原意**（剥离已结构化的日期/时刻/标签词后自然重组）。

### 4.4 容错与缓存

- 输出校验：字段白名单 + 类型检查 + `YYYY-MM-DD`/`HH:mm` 正则 + 枚举 clamp；非法 → 整体丢弃。
- 失败（超时/网络/401/非法 JSON）→ 静默降级，UI 保留规则结果；每次应用会话首次失败 toast 提示一次。
- LRU 缓存：key = `provider + model + input`，60s TTL，容量 20。

## 5. Key 存储与安全

| settings 键 | 内容 |
|---|---|
| `ai_enabled` | bool |
| `ai_provider` | 预设 id 或 `custom` |
| `ai_model` | 覆盖预设默认模型的模型名（可选） |
| `ai_base_url` | 仅 custom |
| `ai_key_enc` | `safeStorage.encryptString(key)` 的 base64 |

- 主进程解密，明文 key 不落盘、不回传渲染进程（设置页只显示尾 4 位）。
- `safeStorage.isEncryptionAvailable()` 为 false（如 Linux 无 keyring）→ 拒绝保存并提示。
- "测试连接"按钮：发送最小请求（max_tokens 8），显示成功/失败原因（401 → "Key 无效"）。
- 隐私说明固定文案在设置区块内："启用后，快添输入文本将发送至所选模型服务商。"

## 6. 快添窗 UI

- 窗高 `QUICK_H` 120 → 160（`windows.ts` 常量，居中定位逻辑自动适配）。
- 新增 chips 行（输入框与底部提示之间）：`📅 11-21 周五 · 🕒 15:00 · 🔁 每周三五 · ⚡ 高 · #工作`；纯标题时该行显示占位文案"回车添加到今日"（与现状一致）。
- AI 返回替换 chips 时 150ms 淡入 + `✨ AI` 徽章（含 provider label）；等待期间 chips 保持规则结果，Enter 用**当前显示**的结果，永不等待网络。
- 交互键位不变：Enter=建任务、Ctrl+Enter=完整编辑预填（预填 `ParsedTask` 全字段）、Esc=关窗；点击单个 chip = 打开编辑器并聚焦对应字段（v1 可先只做 Ctrl+Enter，chip 点击列 M2 可选）。
- placeholder 提示升级为示例："试试：每周三五下午3点开周会 #工作"。

## 7. 错误处理

| 场景 | 行为 |
|---|---|
| AI 超时/网络失败/非法输出 | 静默保留规则结果；会话首败 toast 一次 |
| Key 无效 | 测试连接处红字提示；快添流程不受影响 |
| 规则解析零命中 | 与现状完全一致（纯标题建今日任务） |
| 保存时创建失败 | 现有 QuickAddView 错误 toast + 重新聚焦逻辑不变 |

## 8. 测试策略

- `tests/unit/nlp-rules.test.ts`：≥40 用例——各类模式独立、混合输入、歧义（周X 日期 vs 重复）、过去日期翻滚、IME 边界外的空/全空白输入、标签归一化。
- `tests/unit/parse-draft.test.ts`：`ParsedTask → TodoDraft` 映射。
- `tests/integration/ai-parser.test.ts`：mock fetch——正常/超时 abort/非法 JSON/401/缓存命中。
- provider 预设表与请求形状（URL、header、body 关键字段）单测。
- 现有全部测试保持绿色。

## 9. 分期交付

- **M1（可独立发布）**：`parse.ts` + `rules.ts` + QuickAdd chips 预览 + 窗高调整 + 单测。纯本地，零网络依赖，不碰设置页。
- **M2**：ai-parser 服务 + IPC + provider 预设 + 设置页区块 + AI 增强交互 + 缓存/容错 + 集成测试。

## 10. YAGNI 边界（明确不做）

- 不做多语言解析（v1 中文优先，数字/ISO 格式兼容即可）
- 不做中文数字日期（"十五号"）、不做农历
- 不做托管 AI 服务/账号体系（BYOK）
- 不做 AI 任务拆解、智能排期（架构留口，功能后续立项）
- 不做 chips 单字段行内编辑（v1 用 Ctrl+Enter 进完整编辑器）
- 不做解析结果的历史学习/个性化
