import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { OccurrenceHistory } from '@shared/history';
import type { OccurrenceStatus } from '@shared/types';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

const dateLabel = (date: string): string => {
  const d = new Date(`${date}T00:00:00`);
  return `${date.slice(5)} 周${WEEK[d.getDay()]}`;
};

const timeLabel = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const STATE_TEXT: Record<OccurrenceStatus, string> = {
  done: '完成',
  skipped: '跳过',
  active: '未完成',
};

const STATE_CLASS: Record<OccurrenceStatus, string> = {
  done: 'border-primary/40 text-primary',
  skipped: 'border-border text-muted-foreground',
  active: 'border-overdue/40 text-overdue',
};

/** 重复任务的逐期完成记录（最近若干期 + 完成率） */
export function OccurrenceHistoryDialog({ open, onOpenChange, todoId, title }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  todoId: number;
  title: string;
}) {
  const [h, setH] = useState<OccurrenceHistory | null>(null);

  useEffect(() => {
    if (!open) return;
    setH(null);
    void window.api.todos.history(todoId).then(setH);
  }, [open, todoId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate font-display tracking-tight">{title}</DialogTitle>
          <DialogDescription>完成记录</DialogDescription>
        </DialogHeader>

        {!h ? (
          <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 rounded-md border border-border p-3 text-center">
              <Metric label="完成率" value={`${h.rate}%`} />
              <Metric label="已完成" value={`${h.doneCount}/${h.total}`} />
              <Metric label="已跳过" value={String(h.skippedCount)} />
            </div>

            <div className="max-h-72 overflow-y-auto">
              {h.items.length === 0 && (
                <p className="py-8 text-center text-xs text-muted-foreground">暂无可统计的期次</p>
              )}
              {h.items.map(i => (
                <div
                  key={i.date}
                  className="flex items-center justify-between border-b border-border/60 px-1 py-1.5 text-sm last:border-0"
                >
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {dateLabel(i.date)}
                  </span>
                  <span className="flex items-center gap-2">
                    {i.state === 'done' && i.doneAt != null && (
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {timeLabel(i.doneAt)}
                      </span>
                    )}
                    <span
                      className={cn(
                        'rounded-sm border px-1 font-mono text-[10px]',
                        STATE_CLASS[i.state],
                      )}
                    >
                      {STATE_TEXT[i.state]}
                    </span>
                  </span>
                </div>
              ))}
            </div>

            {h.total > h.items.length && (
              <p className="text-center font-mono text-[10px] text-muted-foreground">
                仅显示最近 {h.items.length} 期（共 {h.total} 期）
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-display text-lg font-semibold tabular-nums">{value}</p>
      <p className="font-mono text-[10px] tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}
