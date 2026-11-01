import { useEffect, useRef, useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { todayStr } from '@shared/recurrence';
import type { TodoDraft } from '@shared/types';

const draftOf = (title: string): TodoDraft => ({
  title, notes: null, priority: 1,
  dueDate: todayStr(Date.now()), timeOfDay: null,
  repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
  monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  startDate: null, completedAt: null,
});

/** 规格 §5.6：回车=今日普通待办；Ctrl+Enter=主窗完整编辑预填；空输入=直接关闭不产生任务 */
export default function QuickAddView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      window.api.onQuickAddFocusInput(() => {
        if (inputRef.current) {
          inputRef.current.value = '';
          inputRef.current.focus();
        }
      }),
    [],
  );

  const close = () => window.api.win.closeQuickAdd();

  const submit = async (openEditor: boolean) => {
    const title = inputRef.current?.value.trim();
    if (!title || busy) {
      close();
      return;
    }
    setBusy(true);
    try {
      if (openEditor) await window.api.win.openEditor(title);
      else await window.api.todos.create(draftOf(title));
      close();
    } catch (e) {
      // 保存失败：本窗自提示并重新聚焦（主窗兜底看不到此窗口的 rejection，终审重要-5）
      inputRef.current?.focus();
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* 签名语言的浓缩版：等宽日期眉标 + 墨蓝光标 */}
      <p className="shrink-0 px-6 pt-4 font-mono text-[11px] tracking-[0.18em] text-muted-foreground select-none">
        {todayStr(Date.now())} · 快速添加
      </p>
      <input
        ref={inputRef}
        autoFocus
        className="min-h-0 flex-1 bg-transparent px-6 font-display text-2xl caret-primary outline-none placeholder:text-muted-foreground/50"
        placeholder={busy ? '保存中…' : '输入任务标题…'}
        disabled={busy}
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
      <div className="shrink-0 px-6 pb-3 font-mono text-[11px] text-muted-foreground/80 select-none">
        Enter 添加到今日 · Ctrl+Enter 详细编辑 · Esc 关闭
      </div>
      <Toaster position="top-center" richColors />
    </div>
  );
}
