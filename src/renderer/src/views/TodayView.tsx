import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useTodos } from '@/hooks/useTodos';
import { TaskItem } from '@/components/TaskItem';
import { DaySpine, type SpineTick } from '@/components/DaySpine';
import { markCompleted, occurrenceKey } from '@/lib/just-completed';
import { completeWithUndo } from '@/lib/complete-with-undo';
import { moveIndex } from '@/lib/keyboard-nav';
import { cn } from '@/lib/utils';
import { todayStr } from '@shared/recurrence';
import type { OccurrenceItem, Todo, TodoDraft } from '@shared/types';

const quickDraft = (title: string): TodoDraft => ({
  title, notes: null, priority: 1, dueDate: todayStr(Date.now()), timeOfDay: null,
  repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
  monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  startDate: null, completedAt: null,
});

const WEEK_FULL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export default function TodayView({ onEdit, onNew, focusTodoId }: {
  onEdit: (t: Todo) => void;
  onNew: () => void;
  focusTodoId?: number;
}) {
  const today = todayStr(Date.now());
  const { items } = useTodos('2020-01-01', today); // 含逾期一直到今天
  const [todoById, setTodoById] = useState<Map<number, Todo>>(new Map());
  const [quick, setQuick] = useState('');
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  useEffect(() => {
    void window.api.todos.listAll('all').then(ts => setTodoById(new Map(ts.map(t => [t.id, t]))));
  }, [items]);

  const { overdue, active, done } = useMemo(() => {
    const byTodo = new Map<number, OccurrenceItem>(); // 逾期按 todo 取最近一天，防历史刷屏
    const act: OccurrenceItem[] = [];
    const dn: OccurrenceItem[] = [];
    for (const it of items) {
      if (it.state === 'active' && it.date < today) {
        const cur = byTodo.get(it.todoId);
        if (!cur || it.date > cur.date) byTodo.set(it.todoId, it);
      } else if (it.date === today) {
        // skipped 仍渲染（opacity 区分），保证"恢复这一天"可达（审查发现）
        if (it.state === 'active' || it.state === 'skipped') act.push(it);
        else if (it.state === 'done') dn.push(it);
      }
    }
    return {
      overdue: [...byTodo.values()].sort((a, b) => b.date.localeCompare(a.date)),
      active: act,
      done: dn,
    };
  }, [items, today]);

  // 脊线刻度：今日有提醒时刻的期次，按真实钟点落位
  const ticks = useMemo<SpineTick[]>(
    () => [...active, ...done]
      .filter((i): i is OccurrenceItem & { timeOfDay: string } => !!i.timeOfDay)
      .map((i): SpineTick => {
        const tone: SpineTick['tone'] =
          i.state === 'done' ? 'done' : i.state === 'skipped' ? 'skipped' : i.overdue ? 'late' : 'future';
        return { time: i.timeOfDay, tone };
      }),
    [active, done],
  );

  const edit = (i: OccurrenceItem) => {
    const t = todoById.get(i.todoId);
    if (t) onEdit(t);
  };
  const toggle = async (i: OccurrenceItem) => {
    if (i.state === 'done') {
      await window.api.todos.setStatus(i.todoId, i.date, 'active');
      return;
    }
    markCompleted(occurrenceKey(i.todoId, i.date)); // 动效标记须在刷新前落位
    completeWithUndo({
      title: i.title,
      complete: () => window.api.todos.complete(i.todoId, i.repeatType === 'none' ? undefined : i.date),
      undo: () => window.api.todos.setStatus(i.todoId, i.date, 'active'),
    });
  };
  const submitQuick = async () => {
    const title = quick.trim();
    if (!title) return;
    await window.api.todos.create(quickDraft(title));
    setQuick('');
    toast.success('已添加到今日');
  };

  const now = new Date();
  const empty = overdue.length + active.length + done.length === 0;

  // 键盘选择顺序：逾期 → 今日 → 已完成
  const flat = useMemo(() => [...overdue, ...active, ...done], [overdue, active, done]);

  // 滚动到当前选中行
  useEffect(() => {
    if (!focusedKey) return;
    document.querySelector(`[data-row-key="${focusedKey}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focusedKey]);

  // 列表键盘流：j/k 选择、x 完成、Space 计时、Enter 编辑、Esc 取消
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return; // 弹窗内不拦截
      if (!flat.length) return;

      const idx = focusedKey ? flat.findIndex(i => occurrenceKey(i.todoId, i.date) === focusedKey) : -1;

      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const next = moveIndex(flat.length, idx, e.key === 'j' ? 'down' : 'up');
        if (next >= 0) setFocusedKey(occurrenceKey(flat[next].todoId, flat[next].date));
        return;
      }
      if (e.key === 'Escape') {
        setFocusedKey(null);
        return;
      }
      if (idx < 0) return;
      const cur = flat[idx];
      if (e.key === 'x') {
        e.preventDefault();
        void toggle(cur);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        edit(cur);
      } else if (e.key === ' ') {
        e.preventDefault();
        const dateArg = cur.repeatType === 'none' ? undefined : cur.date;
        if (cur.timer?.runningSince != null) void window.api.todos.pauseTimer(cur.todoId, dateArg);
        else void window.api.todos.startTimer(cur.todoId, dateArg);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat, focusedKey, toggle, edit]);

  const section = (title: string, list: OccurrenceItem[], showDate = false) =>
    list.length > 0 && (
      <section className="mb-5">
        <h2 className="mb-1.5 font-mono text-[11px] tracking-[0.18em] text-muted-foreground select-none">
          {title}
        </h2>
        {list.map(i => {
          const k = occurrenceKey(i.todoId, i.date);
          return (
            <div
              key={k}
              data-row-key={k}
              className={cn(
                'rounded-md',
                i.todoId === focusTodoId && 'bg-accent/60 ring-1 ring-primary/50',
                focusedKey === k && 'bg-accent/40 ring-1 ring-primary/40',
              )}
            >
              <TaskItem
                item={i}
                timeLabel={showDate ? i.date.slice(5) : undefined}
                onToggle={() => void toggle(i)}
                onSkip={() => void window.api.todos.setStatus(i.todoId, i.date, 'skipped')}
                onUnskip={() => void window.api.todos.setStatus(i.todoId, i.date, 'active')}
                onSnooze={() => void window.api.todos
                  .snooze(i.todoId, i.date, 10)
                  .then(() => toast('10 分钟后再提醒'))}
                onEdit={() => edit(i)}
              />
            </div>
          );
        })}
      </section>
    );

  return (
    <div className="p-6">
      {/* 今日头条：日期本身即主角 */}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground select-none">
            {WEEK_FULL[now.getDay()]} · {today.slice(0, 4)}
          </p>
          <h1 className="mt-1 font-display text-5xl leading-none font-semibold tracking-tight whitespace-nowrap tabular-nums">
            {today.slice(5)}
          </h1>
        </div>
        <Button variant="outline" onClick={onNew}>新建任务</Button>
      </div>
      {overdue.length > 0 && (
        <div className="mt-2 font-mono text-xs text-overdue">
          已逾期 {overdue.length} 条
        </div>
      )}
      <Input
        className="mt-4"
        placeholder="快速添加：输入标题，回车存入今日"
        value={quick}
        onChange={e => setQuick(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submitQuick(); }}
      />

      {empty ? (
        <p className="py-20 text-center text-sm text-muted-foreground">
          今天没有安排 · 在上方输入框回车即可记下一条
        </p>
      ) : (
        <div className="mt-6 flex items-stretch gap-2">
          <DaySpine ticks={ticks} className="min-h-[180px] self-stretch" />
          <div className="min-w-0 flex-1">
            {section('已逾期', overdue, true)}
            {section('今日', active)}
            {section('今日已完成', done)}
          </div>
        </div>
      )}
    </div>
  );
}

