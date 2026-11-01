import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import MonthCalendar, { buildGrid } from '@/components/calendar/MonthCalendar';
import DayPanel from '@/components/calendar/DayPanel';
import { useTodos } from '@/hooks/useTodos';
import { todayStr } from '@shared/recurrence';
import type { Todo, TodoDraft } from '@shared/types';

/** 网格首末日期即查询区间（相邻月覆盖，规格 §5.2） */
function monthRange(y: number, m: number): { from: string; to: string } {
  const grid = buildGrid(y, m);
  return { from: grid[0], to: grid[grid.length - 1] };
}

export default function CalendarView({ onEdit, onNewOnDate }: {
  onEdit: (t: Todo) => void;
  onNewOnDate: (date: string) => void;
}) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const { from, to } = useMemo(() => monthRange(cursor.y, cursor.m), [cursor]);
  const { items } = useTodos(from, to);
  const [todoById, setTodoById] = useState<Map<number, Todo>>(new Map());

  useEffect(() => {
    void window.api.todos.listAll('all').then(ts => setTodoById(new Map(ts.map(t => [t.id, t]))));
  }, [items]);

  // 面板保留 skipped（"恢复这一天"可达，审查 W1）；网格层自行隐藏
  const selectedItems = items.filter(i => i.date === selected);

  const prev = () => setCursor(c => (c.m === 1 ? { y: c.y - 1, m: 12 } : { y: c.y, m: c.m - 1 }));
  const next = () => setCursor(c => (c.m === 12 ? { y: c.y + 1, m: 1 } : { y: c.y, m: c.m + 1 }));
  const goToday = () => {
    const d = new Date();
    setCursor({ y: d.getFullYear(), m: d.getMonth() + 1 });
    setSelected(todayStr(Date.now()));
  };

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center gap-2">
        <h1 className="me-auto font-display text-lg font-semibold tracking-tight tabular-nums">
          {cursor.y} 年 {cursor.m} 月
        </h1>
        <Button size="icon-sm" variant="ghost" onClick={prev} aria-label="上个月">
          <ChevronLeft />
        </Button>
        <Button size="sm" variant="outline" onClick={goToday}>今天</Button>
        <Button size="icon-sm" variant="ghost" onClick={next} aria-label="下个月">
          <ChevronRight />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <MonthCalendar
          days={items} y={cursor.y} m={cursor.m} selected={selected}
          onSelect={setSelected}
        />
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <SheetContent className="flex w-[400px] flex-col gap-0 sm:max-w-[400px]">
          <SheetHeader>
            <SheetTitle className="text-start font-display tracking-tight tabular-nums">{selected}</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="min-h-0 flex-1 overflow-hidden">
              <DayPanel
                date={selected}
                items={selectedItems}
                todoById={todoById}
                onEdit={onEdit}
                onNew={async (d: TodoDraft) => { await window.api.todos.create(d); }}
              />
            </div>
          )}
          <Button
            variant="outline"
            className="m-4 mt-0"
            onClick={() => {
              if (selected) {
                const d = selected;
                setSelected(null);
                onNewOnDate(d);
              }
            }}
          >
            带完整选项新建…
          </Button>
        </SheetContent>
      </Sheet>
    </div>
  );
}
