import { describe, it, expect } from 'vitest';
import { AI_PROVIDERS, resolveEndpoint, buildChatBody, SYSTEM_PROMPT } from '@main/services/ai-providers';

describe('AI_PROVIDERS', () => {
  it('四家预设 + custom', () => {
    const ids = AI_PROVIDERS.map((p) => p.id);
    expect(ids).toEqual(['deepseek', 'qwen', 'glm', 'kimi', 'custom']);
    for (const p of AI_PROVIDERS.filter((x) => x.id !== 'custom')) {
      expect(p.baseUrl).toMatch(/^https:\/\//);
      expect(p.defaultModel.length).toBeGreaterThan(0);
    }
  });

  it('resolveEndpoint 拼接 chat/completions 并去尾斜杠', () => {
    expect(resolveEndpoint('https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('buildChatBody：JSON mode、system 含 today 锚点、user 为原文', () => {
    const body = JSON.parse(buildChatBody('明天下午3点开会', '2026-11-14', 'deepseek-chat'));
    expect(body.model).toBe('deepseek-chat');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('2026-11-14');
    expect(body.messages[1].content).toBe('明天下午3点开会');
  });
});
