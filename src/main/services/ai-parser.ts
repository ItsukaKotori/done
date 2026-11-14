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
