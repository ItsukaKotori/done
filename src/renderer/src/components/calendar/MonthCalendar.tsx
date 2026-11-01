import { cn } from '@/lib/utils';
import { PRIORITY_COLOR } from '@/lib/priority';
import { addDays } from '@shared/recurrence';
import type { OccurrenceItem } from '@shared/types';

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/** 6×7 网格日期串（本地日历，周日起排） */
export function buildGrid(y: number, m: number): string[] {
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const startIdx = new Date(first + 'T00:00:00').getDay();
  const gridStart = addDays(first, -startIdx);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

/** 规格 §5.2：每格色点 + 最多 3 条缩写 + "+n"；点选日期 */
export default function MonthCalendar({ days, y, m, selected, onSelect }: {
  days: OccurrenceItem[];
  y: number;
  m: number;
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  const grid = buildGrid(y, m);
  const byDate = new Map<string, OccurrenceItem[]>();
  for (const d of days) {
    byDate.set(d.date, [...(byDate.get(d.date) ?? []), d]);
  }
  const todayIso = new Date();
  const today = `${todayIso.getFullYear()}-${String(todayIso.getMonth() + 1).padStart(2, '0')}-${String(todayIso.getDate()).padStart(2, '0')}`;

  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-7 border-b border-border text-center">
        {WEEK_LABELS.map(w => (
          <div key={w} className="py-1.5 font-mono text-[11px] text-muted-foreground select-none">周{w}</div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {grid.map(date => {
          const inMonth = date.slice(5, 7) === String(m).padStart(2, '0');
          const list = byDate.get(date) ?? [];
          const visible = list.filter(i => i.state !== 'skipped');
          const shown = visible.filter(i => i.state === 'active').slice(0, 3);
          const extra = visible.filter(i => i.state === 'active').length - shown.length;
          return (
            <button
              key={date}
              onClick={() => onSelect(date)}
              className={cn(
                'flex min-h-0 flex-col items-start gap-0.5 overflow-hidden border-e border-b border-border p-1 text-left hover:bg-muted/60',
                !inMonth && 'text-muted-foreground/60',
                selected === date && 'bg-accent/50 ring-1 ring-inset ring-primary/60',
              )}
              title={list.map(i => i.title).join('\n')}
            >
              {/* 今日：墨蓝圆圈高亮；其余日期纯数字即可 */}
              {date === today ? (
                <span className="flex size-6 items-center justify-center rounded-full bg-primary font-mono text-sm font-medium tabular-nums text-primary-foreground">
                  {Number(date.slice(8, 10))}
                </span>
              ) : (
                <span className="font-mono text-sm font-medium tabular-nums">
                  {Number(date.slice(8, 10))}
                </span>
              )}
              {visible.length > 0 && (
                <div className="flex gap-0.5">
                  {visible.slice(0, 5).map(i => (
                    <span
                      key={`${i.todoId}`}
                      className={cn('h-1.5 w-1.5 rounded-full',
                        i.state === 'done' ? 'bg-muted-foreground/40' : PRIORITY_COLOR[i.priority])}
                    />
                  ))}
                </div>
              )}
              {shown.map(i => (
                <span
                  key={i.todoId}
                  className="w-full truncate text-[11px] leading-tight"
                >
                  {i.timeOfDay ? (
                    <span className={cn('font-mono tabular-nums', i.overdue ? 'text-overdue' : 'text-due')}>
                      {i.timeOfDay}
                    </span>
                  ) : null}{i.timeOfDay ? ` ${i.title}` : i.title}
                </span>
              ))}
              {extra > 0 && (
                <span className="font-mono text-[11px] text-muted-foreground">+{extra}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
