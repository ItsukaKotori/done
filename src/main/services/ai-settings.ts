// src/main/services/ai-settings.ts
import type { SettingsDao } from '../db/dao';
import { IpcError } from '@shared/ipc';
import type { AiConfig } from './ai-parser';
import { AI_PROVIDERS } from './ai-providers';
import { decryptKey, type SafeStorageLike } from './ai-key-store';

/** parse 与 testConnection 共用的配置装配：enabled → preset/baseUrl/model/key 缺一不可 */
export function loadAiConfig(settingsDao: SettingsDao, safe: SafeStorageLike): AiConfig {
  const enabled = settingsDao.get<boolean>('ai_enabled') ?? false;
  if (!enabled) throw new IpcError('AI_DISABLED', '智能快添未启用');
  const id = settingsDao.get<string>('ai_provider') ?? '';
  const preset = AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];
  const baseUrl = (preset.id === 'custom' ? settingsDao.get<string>('ai_base_url') : preset.baseUrl) ?? '';
  const model = settingsDao.get<string>('ai_model') || preset.defaultModel;
  const enc = settingsDao.get<string>('ai_key_enc');
  if (!baseUrl || !model || !enc) throw new IpcError('AI_NOT_CONFIGURED', '请先在设置中完成模型配置');
  const apiKey = decryptKey(enc, safe);
  // 密文存在但解密为空（如清空后残留）同样视为未配置（Task 9 评审裁定）
  if (apiKey.trim() === '') throw new IpcError('AI_NOT_CONFIGURED', '请先在设置中完成模型配置');
  return { baseUrl, model, apiKey };
}
