import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Maximize2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { TaskTimer } from '@/components/TaskTimer';
import { useTodos } from '@/hooks/useTodos';
import { markCompleted, occurrenceKey } from '@/lib/just-completed';
import { completeWithUndo } from '@/lib/complete-with-undo';
import { PRIORITY_COLOR } from '@/lib/priority';
import { cn } from '@/lib/utils';
import { todayStr } from '@shared/recurrence';
import type { StripState } from '@shared/ipc';
import type { OccurrenceItem } from '@shared/types';

// 无边框窗拖拽区：整条可拖；交互元素必须 no-drag 才能点击
const dragRegion = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDragRegion = { WebkitAppRegion: 'no-drag' } as CSSProperties;

/**
 * 收缩长条视图：
 * - collapsed (32px)：今日待办逐条上下轮换 + 计数
 * - expanded (380px)：快速完成列表
 */
export default function StripView() {
  const [expanded, setExpanded] = useState(false);
  const today = todayStr(Date.now());
  const { items } = useTodos('2020-01-01', today);

  useEffect(() => {
    return window.api.onStripState((state: StripState) => setExpanded(state.expanded));
  }, []);

  const { overdueCount, activeEntries, overdueItems, todayItems } = useMemo(() => {
    const ovList: OccurrenceItem[] = [];
    const tdList: OccurrenceItem[] = [];
    for (const it of items) {
      if (it.state !== 'active') continue;
      if (it.date < today) ovList.push(it);
      else tdList.push(it);
    }
    // 逾期按 todo 去重取最近
    const byTodo = new Map<number, OccurrenceItem>();
    for (const it of ovList) {
      const cur = byTodo.get(it.todoId);
      if (!cur || it.date > cur.date) byTodo.set(it.todoId, it);
    }
    const dedupedOv = [...byTodo.values()].sort((a, b) => b.date.localeCompare(a.date));
    return {
      overdueCount: dedupedOv.length,
      activeEntries: tdList,
      overdueItems: dedupedOv,
      todayItems: tdList,
    };
  }, [items, today]);

  // 有任务在计时 → 停止轮播，并停在正在计时那条上
  const runningItem = [...overdueItems, ...todayItems]
    .find(i => i.timer?.runningSince != null) ?? null;
  const paused = runningItem != null;
  const focusIdx = runningItem
    ? todayItems.findIndex(i => i.todoId === runningItem.todoId && i.date === runningItem.date)
    : -1;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground select-none">
      {/* 32px 长条：整条可拖，交互元素单独 no-drag */}
      <div
        style={dragRegion}
        className="flex h-8 shrink-0 items-center gap-2 px-2"
      >
        <button
          style={noDragRegion}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="展开主窗"
          onClick={() => void window.api.win.expandMain()}
        >
          <Maximize2 className="size-3" />
        </button>
        {/* 今日待办逐条上下轮换（计时中暂停并锁定到当前任务） */}
        <Rotator items={activeEntries} paused={paused} focusIndex={focusIdx >= 0 ? focusIdx : null} />
        {/* 计数 */}
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {overdueCount > 0 && <span className="text-overdue">逾期{overdueCount} </span>}
          今日{activeEntries.length}
        </span>
        {/* 展开/收起切换（拖动区会吞点击，故单独放按钮） */}
        <button
          style={noDragRegion}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={expanded ? '收起' : '展开列表'}
          title={expanded ? '收起列表' : '展开列表'}
          onClick={() => void window.api.win.stripToggle()}
        >
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>
      {/* 展开面板（no-drag 保证可点击/滚动） */}
      {expanded && (
        <div style={noDragRegion} className="flex flex-1 flex-col overflow-hidden border-t border-border">
          <div className="flex-1 overflow-y-auto p-2">
            {overdueItems.length > 0 && (
              <section className="mb-3">
                <h3 className="mb-1 font-mono text-[11px] tracking-wider text-muted-foreground">已逾期</h3>
                {overdueItems.map(i => <StripRow key={`${i.todoId}-${i.date}`} item={i} />)}
              </section>
            )}
            <section>
              <h3 className="mb-1 font-mono text-[11px] tracking-wider text-muted-foreground">今日</h3>
              {todayItems.map(i => <StripRow key={`${i.todoId}-${i.date}`} item={i} />)}
            </section>
            {overdueItems.length === 0 && todayItems.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">全部完成 🎉</p>
            )}
          </div>
          <div className="shrink-0 border-t border-border p-2 text-center">
            <button
              className="text-xs text-primary hover:underline"
              onClick={() => void window.api.win.expandMain()}
            >
              展开主窗
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 垂直轮播：一行一条，每 3.5s 上滑切换。
 * 末尾复制首项 + 滑动结束后无动画归位，形成无缝循环。
 */
const LINE_H = '1.5rem'; // h-6 = 24px（容下 icon-xs 按钮）

function Rotator({ items, paused = false, focusIndex = null }: {
  items: OccurrenceItem[];
  paused?: boolean;          // 计时中：停止自动轮播
  focusIndex?: number | null; // 锁定到指定项（正在计时的任务）
}) {
  const n = items.length;
  const [pos, setPos] = useState(0);
  const [snap, setSnap] = useState(false);

  // 条数变化（完成/新增）时归位；若正在计时则仍锁在计时项
  useEffect(() => {
    setSnap(false);
    setPos(paused && focusIndex != null ? focusIndex : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在条数变化时归位，暂停切换不重置
  }, [n]);

  useEffect(() => {
    if (n <= 1 || paused) return;
    const id = setInterval(() => setPos(p => p + 1), 3500);
    return () => clearInterval(id);
  }, [n, paused]);

  // 计时开始：滑到正在计时的那条并停住
  useEffect(() => {
    if (focusIndex == null) return;
    setPos(focusIndex);
  }, [focusIndex]);

  const onEnd = () => {
    if (paused) return; // 锁定态不归位
    if (pos >= n) {
      setSnap(true);
      setPos(0);
    }
  };

  useEffect(() => {
    if (!snap) return;
    const r = requestAnimationFrame(() => setSnap(false));
    return () => cancelAnimationFrame(r);
  }, [snap]);

  if (n === 0) {
    return <span className="min-w-0 flex-1 truncate text-xs leading-6 text-muted-foreground">暂无安排</span>;
  }

  const loop = n === 1 ? items : [...items, items[0]];
  return (
    <div className="h-6 min-w-0 flex-1 overflow-hidden">
      <div
        className={cn(!snap && 'transition-transform duration-500 ease-out')}
        style={{ transform: `translateY(calc(-${pos} * ${LINE_H}))` }}
        onTransitionEnd={n > 1 ? onEnd : undefined}
      >
        {loop.map((t, i) => (
          <div key={i} className="flex h-6 items-center gap-2 text-xs leading-6">
            <span className={cn('size-1.5 shrink-0 rounded-full', PRIORITY_COLOR[t.priority])} />
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            <TaskTimer item={t} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 长条展开态单行：勾选完成 + 优先级色点 + 标题 + 时刻 */
function StripRow({ item }: { item: OccurrenceItem }) {
  const done = item.state === 'done';
  const toggle = () => {
    if (done) return;
    markCompleted(occurrenceKey(item.todoId, item.date));
    completeWithUndo({
      title: item.title,
      complete: () => window.api.todos.complete(item.todoId, item.repeatType === 'none' ? undefined : item.date),
      undo: () => window.api.todos.setStatus(item.todoId, item.date, 'active'),
    });
  };
  return (
    <div className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/60">
      <Checkbox checked={done} onCheckedChange={toggle} aria-label={item.title} />
      <span className="flex w-2 shrink-0 items-center justify-center">
        {!done && <span className={cn('size-2 rounded-full', PRIORITY_COLOR[item.priority])} />}
      </span>
      <span className={cn('min-w-0 flex-1 truncate', done && 'text-muted-foreground line-through')}>
        {item.title}
      </span>
      {item.timeOfDay && (
        <span className={cn('shrink-0 font-mono text-[11px] tabular-nums',
          item.overdue ? 'text-overdue' : 'text-due')}>
          {item.timeOfDay}
        </span>
      )}
      <TaskTimer item={item} />
    </div>
  );
}
