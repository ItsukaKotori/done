import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDataVersion } from '@/hooks/useDataVersion';
import { formatDuration } from '@/lib/duration';
import { cn } from '@/lib/utils';
import type { StatsSummary } from '@shared/stats';

export default function StatsView() {
  const [s, setS] = useState<StatsSummary | null>(null);
  const version = useDataVersion();

  useEffect(() => {
    void window.api.stats.summary().then(setS);
  }, [version]);

  if (!s) return <div className="p-6 text-sm text-muted-foreground">加载中…</div>;

  const max = Math.max(1, ...s.daily.map(d => d.done));

  return (
    <div className="space-y-5 overflow-y-auto p-6">
      <h1 className="font-display text-xl font-semibold tracking-tight">统计</h1>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="今日完成" value={String(s.todayDone)} />
        <StatCard label="本周完成" value={String(s.weekDone)} />
        <StatCard label="累计专注" value={formatDuration(s.totalFocusMs)} />
      </div>

      {s.overdueActive > 0 && (
        <p className="rounded-md border border-overdue/40 bg-overdue/10 px-3 py-2 text-xs text-overdue">
          当前有 {s.overdueActive} 条逾期未完成
        </p>
      )}

      <Card>
        <CardHeader><CardTitle>近 14 天完成数</CardTitle></CardHeader>
        <CardContent>
          <div className="flex h-32 items-end gap-1 border-b border-border pb-0.5">
            {s.daily.map(d => {
              const pct = (d.done / max) * 100;
              return (
                <div
                  key={d.date}
                  className="flex h-full flex-1 items-end"
                  title={`${d.date} · ${d.done} 条`}
                >
                  <div
                    className={cn('w-full rounded-sm', d.done > 0 ? 'bg-primary/70' : 'bg-transparent')}
                    style={{ height: `${pct}%`, minHeight: d.done > 0 ? 2 : 0 }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>{s.daily[0]?.date.slice(5)}</span>
            <span>{s.daily[s.daily.length - 1]?.date.slice(5)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="font-display text-2xl font-semibold tabular-nums">{value}</p>
        <p className="mt-0.5 font-mono text-[11px] tracking-wider text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
