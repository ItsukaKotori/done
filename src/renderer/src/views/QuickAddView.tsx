import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { todayStr } from '@shared/recurrence';
import { parsedToDraft, type ParsedTask } from '@shared/parse';
import { parseTaskInput } from '@/lib/nlp/rules';

export default function QuickAddView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<ParsedTask | null>(null);
  const [aiBadge, setAiBadge] = useState<string | null>(null); // Task 11 使用

  useEffect(
    () =>
      window.api.onQuickAddFocusInput(() => {
        if (inputRef.current) {
          inputRef.current.value = '';
          inputRef.current.focus();
        }
        setParsed(null);
        setAiBadge(null);
      }),
    [],
  );

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
      if (openEditor) await window.api.win.openEditor(cur.title);
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
    const v = inputRef.current?.value ?? '';
    setParsed(v.trim() ? parseTaskInput(v, todayStr(Date.now())) : null);
    setAiBadge(null);
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
      return r.monthlyMode === 'by_weekday'
        ? `每月第${r.monthlyWhich === 5 ? '最后一个' : r.monthlyWhich}个周${W[r.monthlyWeekday ?? 1]}`
        : `每月${r.monthlyDay}号`;
    case 'custom': return `每${r.repeatInterval}天`;
    default: return '';
  }
}
