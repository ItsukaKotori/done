import { describe, it, expect } from 'vitest';
import { ok, fail, unwrap, IpcError, type R } from '@shared/ipc';

describe('IPC envelope（规格 §6 结构化错误）', () => {
  it('ok 返回 data', () => {
    expect(unwrap(ok(42))).toBe(42);
    expect(unwrap(ok(null))).toBe(null);
  });

  it('fail 抛 IpcError 携带 code 与 message', () => {
    expect(() => unwrap(fail('DB_ERROR', 'disk full'))).toThrowError(/disk full/);
    try {
      unwrap(fail('HOTKEY_CONFLICT', '占用'));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(IpcError);
      expect((e as IpcError).code).toBe('HOTKEY_CONFLICT');
      expect((e as IpcError).message).toBe('占用');
    }
  });

  it('ok/fail 形状可判别（ok 布尔收窄）', () => {
    const env: R<string> = ok('x');
    if (env.ok) expect(env.data).toBe('x');
    else expect.unreachable();
    const bad: R<string> = fail('E', 'm');
    if (!bad.ok) expect(bad.code).toBe('E');
  });
});
