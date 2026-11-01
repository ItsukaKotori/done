import { useEffect, useMemo, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { matchesQuery } from '@/lib/search';
import { completeWithUndo } from '@/lib/complete-with-undo';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VirtualList } from '@/components/VirtualList';
import { OccurrenceHistoryDialog } from '@/components/OccurrenceHistoryDialog';
import { useDataVersion } from '@/hooks/useDataVersion';
import type { Priority, Todo } from '@shared/types';

const REPEAT_SUMMARY: Record<string, string> =
  { none: '', daily: '每天', weekly: '每周', monthly: '每月', custom: '按间隔' };
const PRIORITY_LABEL: Record<Priority, string> = { 0: '低', 1: '中', 2: '高' };

export default function AllTasksView({ onEdit, onNew }: {
  onEdit: (t: Todo) => void; onNew: () => void;
}) {
  const [status, setStatus] = useState<'all' | 'open' | 'done'>('open');
  const [priority, setPriority] = useState<'all' | string>('all');
  const [tag, setTag] = useState<'all' | string>('all');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [historyTodo, setHistoryTodo] = useState<Todo | null>(null);
  const [nextDates, setNextDates] = useState<Map<number, string>>(new Map());
  const version = useDataVersion(); // 主进程 broadcastChanged 后自动刷新

  // Ctrl+F 聚焦搜索，Esc 清空
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    void window.api.todos.listAll(status).then(setTodos);
  }, [status, version]);

  // 下次发生日：对 open 任务一次性并发计算并缓存（<500 条可接受，规格 §5.3）；代次守卫防旧批覆盖新批
  useEffect(() => {
    let gen = false;
    const open = todos.filter(t => !t.completedAt);
    void Promise.all(
      open.map(async t => [t.id, (await window.api.todos.preview({ draft: t, todoId: t.id }))[0]] as const),
    ).then((pairs) => {
      if (gen) return;
      setNextDates(new Map(pairs.filter(([, d]) => !!d) as Array<[number, string]>));
    });
    return () => { gen = true; };
  }, [todos]);

  // 排序日：优先 nextDate，逾期/无 nextDate 的一次性回退到期日（审查 #4：逾期不沉底）
  const sortDate = (t: Todo): string =>
    nextDates.get(t.id) ?? t.dueDate ?? (t.completedAt ? '' : '9999-99-99');

  // 现有标签集合（供筛选下拉）
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of todos) for (const g of (t.tags ?? [])) set.add(g);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [todos]);

  const rows = useMemo(() => {
    const list = todos
      .filter(t => priority === 'all' || t.priority === Number(priority))
      .filter(t => tag === 'all' || (t.tags ?? []).includes(tag))
      .filter(t => matchesQuery(t, query));
    return [...list].sort((a, b) =>
      (a.completedAt ? 1 : 0) - (b.completedAt ? 1 : 0)
      || (a.completedAt ? 0 : sortDate(a).localeCompare(sortDate(b)))
      || b.id - a.id);
  }, [todos, priority, tag, query, nextDates]);

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="me-auto font-display text-xl font-semibold tracking-tight">全部任务</h1>
        <Button variant="outline" onClick={onNew}>新建任务</Button>
      </div>
      <div className="mb-3 flex items-center gap-3">
        <Tabs value={status} onValueChange={v => setStatus(v as typeof status)}>
          <TabsList>
            <TabsTrigger value="open">进行中</TabsTrigger>
            <TabsTrigger value="done">已完成</TabsTrigger>
            <TabsTrigger value="all">全部</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有优先级</SelectItem>
            <SelectItem value="0">低</SelectItem>
            <SelectItem value="1">中</SelectItem>
            <SelectItem value="2">高</SelectItem>
          </SelectContent>
        </Select>
        {allTags.length > 0 && (
          <Select value={tag} onValueChange={setTag}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有标签</SelectItem>
              {allTags.map(g => (
                <SelectItem key={g} value={g}>{g}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input
          ref={searchRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setQuery('');
              e.currentTarget.blur();
            }
          }}
          placeholder="搜索标题或备注… (Ctrl+F)"
          className="ms-auto w-64"
          aria-label="搜索任务"
        />
      </div>
      {rows.length === 0 && (
        <p className="py-16 text-center text-sm text-muted-foreground">
          没有符合条件的任务 · 换个筛选条件，或新建一条
        </p>
      )}
      <VirtualList
        items={rows}
        rowHeight={44}
        keyOf={t => t.id}
        className="min-h-0 flex-1"
        renderRow={t => {
          // 重复任务按"期"完成属今日/日历视图职责；任务级列表不整体完成（审查 W：避免连点扣多期且无反馈）
          const isRepeat = t.repeatType !== 'none';
          const checkDisabled = isRepeat && !t.completedAt;
          return (
            <div
              className="flex h-11 cursor-default items-center gap-3 rounded-md px-2 hover:bg-muted"
              onDoubleClick={() => onEdit(t)}
            >
              <Checkbox
                checked={!!t.completedAt}
                disabled={checkDisabled}
                aria-label={t.title}
                title={checkDisabled ? '重复任务请在今日/日历视图按期完成' : undefined}
                onCheckedChange={() => {
                  if (t.completedAt) {
                    void window.api.todos.update(t.id, { completedAt: null });
                    return;
                  }
                  completeWithUndo({
                    title: t.title,
                    complete: () => window.api.todos.complete(t.id),
                    undo: () => window.api.todos.update(t.id, { completedAt: null }),
                  });
                }}
              />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-sm',
                  t.completedAt && 'text-muted-foreground line-through decoration-muted-foreground/50',
                )}
              >
                {t.title}
              </span>
              {(t.tags ?? []).slice(0, 2).map(g => (
                <span
                  key={g}
                  className="shrink-0 rounded-sm border border-border px-1 font-mono text-[10px] text-muted-foreground"
                >
                  {g}
                </span>
              ))}
              <Badge variant={t.priority === 2 ? 'destructive' : t.priority === 0 ? 'secondary' : 'outline'}>
                {PRIORITY_LABEL[t.priority]}
              </Badge>
              {t.repeatType !== 'none' && (
                <button
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="查看完成记录"
                  title="完成记录"
                  onClick={() => setHistoryTodo(t)}
                >
                  <History className="size-3" />
                </button>
              )}
              {t.repeatType !== 'none' && <Badge variant="outline">{REPEAT_SUMMARY[t.repeatType]}</Badge>}
              <span className="w-24 shrink-0 text-end font-mono text-xs tabular-nums text-muted-foreground">
                {t.completedAt ? '已完成' : (nextDates.get(t.id) ?? t.dueDate) ?? '—'}
              </span>
            </div>
          );
        }}
      />
      {historyTodo && (
        <OccurrenceHistoryDialog
          open={!!historyTodo}
          onOpenChange={(o) => { if (!o) setHistoryTodo(null); }}
          todoId={historyTodo.id}
          title={historyTodo.title}
        />
      )}
    </div>
  );
}
