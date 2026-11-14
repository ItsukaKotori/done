// src/main/services/ai-parser.ts
import { IpcError } from '@shared/ipc';
import { emptyRepeat, type ParsedTask } from '@shared/parse';
import type { MonthlyMode, Priority, RepeatType } from '@shared/types';
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

  // 提供了 dueDate 但格式非法 → 整体视为非法输出（返回 null，上层保留规则结果）
  if (o.dueDate !== undefined && o.dueDate !== null && !(typeof o.dueDate === 'string' && RE_DATE.test(o.dueDate))) return null;
  const dueDate = typeof o.dueDate === 'string' && RE_DATE.test(o.dueDate) ? o.dueDate : null;
  // 时刻字段宽松：格式非法时降级为 null（日期任务语义完整）；日期字段严格：present-but-非法 整体拒绝
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
    monthlyMode: ((): MonthlyMode | null => {
      const m = r.monthlyMode;
      return m === 'by_date' || m === 'by_weekday' ? m : null;
    })(),
    monthlyDay: repeatType === 'monthly' && asInt(r.monthlyDay) !== null ? asInt(r.monthlyDay) : null,
    monthlyWeekday: asInt(r.monthlyWeekday) !== null ? asInt(r.monthlyWeekday) : null,
    monthlyWhich: asInt(r.monthlyWhich) !== null ? asInt(r.monthlyWhich) : null,
  };

  return { title, dueDate, timeOfDay, priority, tags, repeat, source: 'ai' };
}

const safeJsonParse = (s: string): unknown => {
  try { return JSON.parse(s); } catch { return undefined; }
};

/** 中止统一按 name 判定：DOMException 与注入 fetch 抛出的普通 Error('AbortError') 均覆盖 */
const isAbortError = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';

/** exchange 结果：content 仅在 2xx 且需要读 body 时非 null（错误响应不读 body，由调用方按状态码分类） */
interface ExchangeResult { status: number; ok: boolean; content: string | null }

export class AiParser {
  private cache = new Map<string, { at: number; task: ParsedTask }>();

  constructor(private fetchImpl: FetchLike = fetch) {}

  async parse(input: string, today: string, cfg: AiConfig): Promise<ParsedTask> {
    const ck = `${cfg.model}:${input}`;
    const hit = this.cache.get(ck);
    if (hit && Date.now() - hit.at < CACHE_TTL) {
      // LRU：命中即 delete+set 刷新位置，热条目不会被逐出
      this.cache.delete(ck);
      this.cache.set(ck, { at: hit.at, task: hit.task });
      return hit.task;
    }

    let r: ExchangeResult;
    try {
      r = await this.exchange(input, today, cfg, false);
    } catch (e) {
      throw this.wrapNetworkError(e);
    }
    if (r.status === 401 || r.status === 403) throw new IpcError('AI_AUTH', 'API Key 无效或无权限');
    if (!r.ok) throw new IpcError('AI_HTTP', `模型服务返回 HTTP ${r.status}`);

    const task = validateParsed(safeJsonParse(r.content ?? ''), today);
    if (!task) throw new IpcError('AI_BAD_OUTPUT', '模型返回内容不符合约定结构');

    // LRU：覆盖写同样 delete+set，刷新插入位置
    this.cache.delete(ck);
    this.cache.set(ck, { at: Date.now(), task });
    if (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return task;
  }

  async testConnection(cfg: AiConfig): Promise<void> {
    let r: ExchangeResult;
    try {
      r = await this.exchange('测试连接', '2026-01-01', cfg, true);
    } catch (e) {
      throw this.wrapNetworkError(e);
    }
    if (r.status === 401 || r.status === 403) throw new IpcError('AI_AUTH', 'API Key 无效或无权限');
    if (!r.ok) throw new IpcError('AI_HTTP', `模型服务返回 HTTP ${r.status}`);
  }

  /** 发起请求并在同一 3s 超时窗口内完成响应体读取（计时覆盖到 body，而非仅 headers） */
  private async exchange(input: string, today: string, cfg: AiConfig, minimal: boolean): Promise<ExchangeResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const body = minimal
        ? JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8, response_format: { type: 'json_object' } })
        : buildChatBody(input, today, cfg.model);
      const res = await this.fetchImpl(resolveEndpoint(cfg.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body,
        signal: ctrl.signal,
      });
      // 非 2xx / ping 分支：不读 body（错误响应体格式不可预期），由调用方按状态码分类
      if (minimal || !res.ok) return { status: res.status, ok: res.ok, content: null };
      let content = '';
      try {
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        content = data.choices?.[0]?.message?.content ?? '';
      } catch (e) {
        if (isAbortError(e)) throw e; // body 读取触发超时 → 调用方归为 AI_TIMEOUT
        throw new IpcError('AI_BAD_OUTPUT', '模型返回格式无法解析');
      }
      return { status: res.status, ok: res.ok, content };
    } finally {
      clearTimeout(timer);
    }
  }

  private wrapNetworkError(e: unknown): Error {
    if (e instanceof IpcError) return e;
    if (isAbortError(e)) return new IpcError('AI_TIMEOUT', '模型服务响应超时');
    return new IpcError('AI_NETWORK', '无法连接模型服务');
  }
}
