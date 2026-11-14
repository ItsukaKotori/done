import { describe, it, expect } from 'vitest';
import { encryptKey, decryptKey, keyHintOf, type SafeStorageLike } from '@main/services/ai-key-store';
import { IpcError } from '@shared/ipc';

const fakeSafe = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s: string) => Buffer.from(`enc:${s}`),
  decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
});

describe('ai-key-store', () => {
  it('加密→解密往返', () => {
    const safe = fakeSafe();
    const enc = encryptKey('sk-abc123', safe);
    expect(enc).not.toContain('sk-abc123');
    expect(decryptKey(enc, safe)).toBe('sk-abc123');
  });

  it('safeStorage 不可用 → AI_NO_KEYRING', () => {
    expect(() => encryptKey('x', fakeSafe(false))).toThrow(IpcError);
    try {
      encryptKey('x', fakeSafe(false));
    } catch (e) {
      expect((e as IpcError).code).toBe('AI_NO_KEYRING');
    }
  });

  it('keyHint 只留尾 4 位', () => {
    expect(keyHintOf('sk-abcdefghijkl')).toBe('…ijkl');
    expect(keyHintOf('ab')).toBe('…ab');
    expect(keyHintOf('')).toBe('');
  });
});
