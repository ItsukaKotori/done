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

  it('res.json() 抛错 → AI_BAD_OUTPUT', async () => {
    const f = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('stream broken')) }) as unknown as Response);
    const ai = new AiParser(f as unknown as typeof fetch);
    await expect(ai.parse('x', TODAY, CFG)).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT' });
  });

  it('超时 3s abort → AI_TIMEOUT', async () => {
    const f = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    const ai = new AiParser(f as unknown as typeof fetch);
    await expect(ai.parse('x', TODAY, CFG)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  }, 10_000);

  it('响应体停滞超过 3s → AI_TIMEOUT（计时覆盖 body 读取）', async () => {
    let captured: RequestInit | undefined;
    const f = vi.fn((_url: string, init?: RequestInit) => {
      captured = init;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => new Promise<unknown>((_res, rej) => {
          captured?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        }),
      }) as unknown as Response;
    });
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

  it('缓存命中刷新 LRU 顺序（被刷新的条目不被逐出）', async () => {
    const f = vi.fn((_url: string, init?: RequestInit) => Promise.resolve({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: okAiJson } }] }),
    }) as unknown as Response);
    const ai = new AiParser(f as unknown as typeof fetch);
    // 填满 20 条
    for (let i = 0; i < 20; i++) await ai.parse(`任务${i}`, TODAY, CFG);
    // 命中第 0 条（刷新其 LRU 位置），此时 fetch 总调用数 = 20
    await ai.parse('任务0', TODAY, CFG);
    // 再压入 1 条新输入 → 触发逐出；被刷新的 任务0 必须仍命中缓存
    await ai.parse('任务20', TODAY, CFG);
    const before = (f as ReturnType<typeof vi.fn>).mock.calls.length;
    await ai.parse('任务0', TODAY, CFG);
    expect((f as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
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
