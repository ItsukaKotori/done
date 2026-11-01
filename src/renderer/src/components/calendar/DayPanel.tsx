import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { TaskItem } from '@/components/TaskItem';
import { markCompleted, occurrenceKey } from '@/lib/just-completed';
import { completeWithUndo } from '@/lib/complete-with-undo';
import type { OccurrenceItem, Todo, TodoDraft } from '@shared/types';

/** 规格 §5.2：当日 Sheet —— 列表 + 内联添加（日期预填所选日） */
export default function DayPanel({ date, items, todoById, onEdit, onNew }: {
  date: string;
  items: OccurrenceItem[];
  todoById: Map<number, Todo>;
  onEdit: (t: Todo) => void;
  onNew: (draft: TodoDraft) => Promise<void>;
}) {
  const [quick, setQuick] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const title = quick.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await onNew({
        title, notes: null, priority: 1, dueDate: date, timeOfDay: null,
        repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
        monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
        startDate: null, completedAt: null,
      });
      setQuick('');
      toast.success(`已添加到 ${date}`);
    } finally {
      setBusy(false);
    }
  };

  const edit = (i: OccurrenceItem) => {
    const t = todoById.get(i.todoId);
    if (t) onEdit(t);
  };

  const toggle = (i: OccurrenceItem) => {
    if (i.state === 'done') {
      void window.api.todos.setStatus(i.todoId, i.date, 'active');
      return;
    }
    markCompleted(occurrenceKey(i.todoId, i.date)); // 动效标记须在刷新前落位
    completeWithUndo({
      title: i.title,
      complete: () => window.api.todos.complete(i.todoId, i.repeatType === 'none' ? undefined : i.date),
      undo: () => window.api.todos.setStatus(i.todoId, i.date, 'active'),
    });
  };

  return (
    <div className="flex h-full flex-col gap-2 p-1">
      <div className="flex gap-2">
        <Input
          placeholder="添加任务到此日"
          value={quick}
          onChange={e => setQuick(e.target.value)}
          onKeyDown={e => {
            // IME 候选确认的回车不提交（审查 W2）
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit();
          }}
        />
        <Button onClick={() => void submit()} disabled={busy}>添加</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 && (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">这一天是空的 · 在上方输入即可添加</p>
        )}
        {items.map(i => (
          <TaskItem
            key={`${i.todoId}-${i.date}`}
            item={i}
            onToggle={() => toggle(i)}
            onSkip={() => void window.api.todos.setStatus(i.todoId, i.date, 'skipped')}
            onUnskip={() => void window.api.todos.setStatus(i.todoId, i.date, 'active')}
            onSnooze={() => void window.api.todos.snooze(i.todoId, i.date, 10)}
            onEdit={() => edit(i)}
          />
        ))}
      </div>
    </div>
  );
}
