// src/shared/ai-providers.ts — 纯数据+纯函数，主进程与渲染层共用（禁止引入 electron）
export interface AiProviderPreset {
  id: 'deepseek' | 'qwen' | 'glm' | 'kimi' | 'custom';
  label: string;
  baseUrl: string;
  defaultModel: string;
}

export const AI_PROVIDERS: AiProviderPreset[] = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  { id: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-turbo' },
  { id: 'glm', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash' },
  { id: 'kimi', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k' },
  { id: 'custom', label: '自定义', baseUrl: '', defaultModel: '' },
];

export const resolveEndpoint = (baseUrl: string): string =>
  baseUrl.replace(/\/+$/, '') + '/chat/completions';

export const SYSTEM_PROMPT = (today: string) => `你是待办事项快速添加的解析器。把用户的一句输入解析为 JSON，字段：
{ "title": string, "dueDate": "YYYY-MM-DD"|null, "timeOfDay": "HH:mm"|null,
  "priority": 0|1|2, "tags": string[],
  "repeat": { "repeatType": "none"|"daily"|"weekly"|"monthly"|"custom",
              "repeatInterval": number|null, "repeatWeekdays": number[]|null,
              "monthlyMode": "by_date"|"by_weekday"|null,
              "monthlyDay": number|null, "monthlyWeekday": number|null, "monthlyWhich": number|null } }

规则：
- today = ${today}。相对日期据此换算为绝对日期；星期几早于 today 则取下一个。
- repeatWeekdays 数字含义：0=周日,1=周一…6=周六。
- priority：明确"紧急/高优先"为 2，"不急/低优先"为 0，否则 1。
- 无法确定的字段一律 null 或缺省；title 必须保留原意（剥离日期/时刻/标签词后自然成句）。
- 只输出 JSON，不要解释。

示例一：
输入："明天下午3点交报告 紧急 #工作"（today = 2026-11-14）
输出：{"title":"交报告","dueDate":"2026-11-15","timeOfDay":"15:00","priority":2,"tags":["工作"],"repeat":{"repeatType":"none","repeatInterval":null,"repeatWeekdays":null,"monthlyMode":null,"monthlyDay":null,"monthlyWeekday":null,"monthlyWhich":null}}

示例二：
输入："记得每天遛狗"（today = 2026-11-14）
输出：{"title":"遛狗","dueDate":"2026-11-14","timeOfDay":null,"priority":1,"tags":[],"repeat":{"repeatType":"daily","repeatInterval":null,"repeatWeekdays":null,"monthlyMode":null,"monthlyDay":null,"monthlyWeekday":null,"monthlyWhich":null}}

示例三：
输入："每周三五下午3点开周会"（today = 2026-11-14）
输出：{"title":"开周会","dueDate":null,"timeOfDay":"15:00","priority":1,"tags":[],"repeat":{"repeatType":"weekly","repeatInterval":null,"repeatWeekdays":[3,5],"monthlyMode":null,"monthlyDay":null,"monthlyWeekday":null,"monthlyWhich":null}}

注意：示例中的绝对日期仅适用于示例的 today = 2026-11-14；实际输出必须按上方规则中的真实 today（${today}）换算，不要照抄示例日期。`;

export function buildChatBody(input: string, today: string, model: string): string {
  return JSON.stringify({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT(today) },
      { role: 'user', content: input },
    ],
    temperature: 0,
    max_tokens: 512,
    response_format: { type: 'json_object' },
  });
}
