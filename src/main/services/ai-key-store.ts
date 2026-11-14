// src/main/services/ai-key-store.ts
import { IpcError } from '@shared/ipc';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export function encryptKey(plain: string, safe: SafeStorageLike): string {
  if (!safe.isEncryptionAvailable()) {
    throw new IpcError('AI_NO_KEYRING', '系统安全存储不可用，无法保存 API Key');
  }
  return safe.encryptString(plain).toString('base64');
}

export function decryptKey(enc: string, safe: SafeStorageLike): string {
  return safe.decryptString(Buffer.from(enc, 'base64'));
}

export function keyHintOf(plain: string): string {
  if (!plain) return '';
  return `…${plain.slice(-4)}`;
}
