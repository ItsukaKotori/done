import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { todayStr } from '@shared/recurrence';
import { parsedToDraft, type ParsedTask } from '@shared/parse';
import { AI_PROVIDERS } from '@shared/ai-providers';
import { parseTaskInput } from '@/lib/nlp/rules';

export default function QuickAddView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<ParsedTask | null>(null);
  const [aiBadge, setAiBadge] = useState<string | null>(null);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const failToastedRef = useRef(false);
  const providerLabelRef = useRef('AI');
  const aiEnabledRef = useRef(false);

  // 快添窗每次唤起：清输入、作废在途 AI 响应（重开即新会话，防止旧结果写进已清空的输入框）
  useEffect(
    () =>
      window.api.onQuickAddFocusInput(() => {
        if (aiTimerRef.current) {
          clearTimeout(aiTimerRef.current);
          aiTimerRef.current = null;
        }
        seqRef.current += 1;
        if (inputRef.current) {
          inputRef.current.value = '';
          inputRef.current.focus();
        }
        setParsed(null);
        setAiBadge(null);
      }),
    [],
  );

  // 快添窗每次唤起刷新 provider label（徽章文案，spec §6）与启用开关（spec §1/§6：未启用不发 IPC）
  useEffect(
    () =>
      window.api.onQuickAddFocusInput(() => {
        void window.api.settings.get<string>('ai_provider').then((id) => {
          providerLabelRef.current =
            AI_PROVIDERS.find((p) => p.id === id)?.label ?? 'AI';
        });
        void window.api.settings.get<boolean>('ai_enabled').then((v) => {
          aiEnabledRef.current = v === true;
        });
      }),
    [],
  );

  // 最后一次键入 400ms 后调 AI 增强；序号守卫只让最新一次请求写回
  const scheduleAi = () => {
    const v = inputRef.current?.value ?? '';
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    if (!aiEnabledRef.current) return; // 未启用 AI：不发 IPC、不 toast（spec §1/§6）
    const seq = ++seqRef.current;
    if (!v.trim()) return;
    aiTimerRef.current = setTimeout(() => {
      void window.api.ai
        .parse(v, todayStr(Date.now()))
        .then((t) => {
          if (seqRef.current === seq) {
            setParsed(t);
            setAiBadge(providerLabelRef.current);
          }
        })
        .catch((e) => {
          if (seqRef.current !== seq) return; // 已被更新的输入取代：不写状态、不花会话 toast
          const code = (e as { code?: string } | undefined)?.code;
          // 未启用/未配置属预期状态，静默降级（spec §7：toast 只留给超时/网络/鉴权/非法输出）
          if (code === 'AI_DISABLED' || code === 'AI_NOT_CONFIGURED') return;
          if (!failToastedRef.current) {
            failToastedRef.current = true;
            toast.info('AI 增强暂不可用，已使用本地解析');
          }
        });
    }, 400);
  };

  // 用输入框当前值重置规则解析并重排 AI（onInput 与 compositionend 共用）
  const reparse = () => {
    const v = inputRef.current?.value ?? '';
    setParsed(v.trim() ? parseTaskInput(v, todayStr(Date.now())) : null);
    setAiBadge(null);
    scheduleAi();
  };

  const close = () => window.api.win.closeQuickAdd();

  const currentDraft = (): { title: string; draft: ReturnType<typeof parsedToDraft> } | null => {
    const title = inputRef.current?.value.trim() ?? '';
    if (!title) return null;
    const base = parseTaskInput(title, todayStr(Date.now()));
    // 解析失败兜底（空标题）与现状一致
    const p = parsed ?? base;
    return { title, draft: parsedToDraft({ ...p, title: p.title || title }, Date.now()) };
  };

  const submit = async (openEditor: boolean) => {
    const cur = currentDraft();
    if (!cur || busy) {
      close();
      return;
    }
    setBusy(true);
    try {
      // meta-only 输入会把 parsed.title 清空，编辑器预填需回退到原文（与 currentDraft 的兜底一致）
      if (openEditor)
        await window.api.win.openEditor({ title: cur.title, parsed: parsed ? { ...parsed, title: parsed.title || cur.title } : null });
      else await window.api.todos.create(cur.draft);
      close();
    } catch (e) {
      inputRef.current?.focus();
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const onInput = (e: FormEvent<HTMLInputElement>) => {
    if ((e.nativeEvent as InputEvent).isComposing) return; // IME 组合期间不解析（spec §3.2）
    reparse();
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <p className="shrink-0 px-6 pt-4 font-mono text-[11px] tracking-[0.18em] text-muted-foreground select-none">
        {todayStr(Date.now())} · 快速添加
      </p>
      <input
        ref={inputRef}
        autoFocus
        className="min-h-0 flex-1 bg-transparent px-6 font-display text-2xl caret-primary outline-none placeholder:text-muted-foreground/50"
        placeholder={busy ? '保存中…' : '试试：每周三五下午3点开周会 #工作'}
        disabled={busy}
        onInput={onInput}
        // Chromium：compositionend 后不再补发 input 事件，必须在此用最终文本重解析，
        // 否则 IME 会话前的旧 parsed 一直滞留，Enter 会提交预编辑期的解析结果
        onCompositionEnd={reparse}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit(e.ctrlKey || e.metaKey);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
      />
      <div className="shrink-0 px-6 pb-1 font-mono text-[11px] text-muted-foreground select-none">
        {chipsOf(parsed, aiBadge)}
      </div>
      <div className="shrink-0 px-6 pb-3 font-mono text-[11px] text-muted-foreground/80 select-none">
        Enter 添加 · Ctrl+Enter 详细编辑 · Esc 关闭
      </div>
      <Toaster position="top-center" richColors />
    </div>
  );
}

function chipsOf(p: ParsedTask | null, ai: string | null): string {
  if (!p || (!p.dueDate && !p.timeOfDay && p.repeat.repeatType === 'none' && p.priority === 1 && p.tags.length === 0)) {
    return '支持：日期 · 时刻 · 重复 · 优先级 · #标签';
  }
  const parts: string[] = [];
  if (p.dueDate) parts.push(`📅 ${p.dueDate}`);
  if (p.timeOfDay) parts.push(`🕒 ${p.timeOfDay}`);
  if (p.repeat.repeatType !== 'none') parts.push(`🔁 ${repeatLabel(p.repeat)}`);
  if (p.priority !== 1) parts.push(p.priority === 2 ? '⚡ 高' : '↓ 低');
  for (const t of p.tags) parts.push(`#${t}`);
  return (ai ? `✨ ${ai} · ` : '') + parts.join(' · ');
}

function repeatLabel(r: ParsedTask['repeat']): string {
  const W = ['日', '一', '二', '三', '四', '五', '六'];
  switch (r.repeatType) {
    case 'daily': return '每天';
    case 'weekly': return `每周 ${(r.repeatWeekdays ?? []).map((d) => W[d]).join('/')}`;
    case 'monthly':
      // ?? 兜底：AI 输出 by_weekday 缺 which/weekday 时渲染安全文案而非「第null个」
      return r.monthlyMode === 'by_weekday'
        ? `每月第${r.monthlyWhich === 5 ? '最后一个' : r.monthlyWhich ?? 1}个周${W[r.monthlyWeekday ?? 1]}`
        : `每月${r.monthlyDay ?? 1}号`;
    case 'custom': return `每${r.repeatInterval}天`;
    default: return '';
  }
}
