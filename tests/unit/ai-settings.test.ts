import { describe, it, expect } from 'vitest';
import { loadAiConfig } from '@main/services/ai-settings';
import { encryptKey, type SafeStorageLike } from '@main/services/ai-key-store';
import { IpcError } from '@shared/ipc';
import type { SettingsDao } from '@main/db/dao';

const fakeSafe = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s: string) => Buffer.from(`enc:${s}`),
  decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
});

/** 内联假 settingsDao：仅实现 get，映射表缺省返回 null */
const fakeDao = (map: Record<string, unknown>): SettingsDao =>
  ({
    get: <T,>(key: string): T | null => (key in map ? (map[key] as T) : null),
  }) as unknown as SettingsDao;

const configured = (key: string): Record<string, unknown> => ({
  ai_enabled: true,
  ai_provider: 'deepseek',
  ai_key_enc: encryptKey(key, fakeSafe()),
});

describe('loadAiConfig', () => {
  it('happy path：解密 key 并装配 baseUrl/model', () => {
    const cfg = loadAiConfig(fakeDao(configured('sk-abc123')), fakeSafe());
    expect(cfg).toEqual({
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-abc123',
    });
  });

  it('密文存在但解密为空 key → AI_NOT_CONFIGURED', () => {
    expect(() => loadAiConfig(fakeDao(configured('   ')), fakeSafe())).toThrow(IpcError);
    try {
      loadAiConfig(fakeDao(configured('   ')), fakeSafe());
    } catch (e) {
      expect((e as IpcError).code).toBe('AI_NOT_CONFIGURED');
    }
  });

  it('ai_enabled=false → AI_DISABLED', () => {
    expect(() => loadAiConfig(fakeDao({ ai_enabled: false }), fakeSafe())).toThrow(IpcError);
    try {
      loadAiConfig(fakeDao({ ai_enabled: false }), fakeSafe());
    } catch (e) {
      expect((e as IpcError).code).toBe('AI_DISABLED');
    }
  });
});
