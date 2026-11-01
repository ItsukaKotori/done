import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export interface SpineTick {
  /** HH:mm */
  time: string;
  /** future=未到（琥珀）/ late=已过未完成（信号红）/ done=已完成（熄灭）/ skipped=跳过（更淡） */
  tone: 'future' | 'late' | 'done' | 'skipped';
}

const HOUR_LABELS = [6, 12, 18];
/** 未到/已过用满尺寸状态色点；已完成/已跳过降为小号墨点（与轨道拉开，不靠描边） */
const TONE: Record<SpineTick['tone'], string> = {
  future: 'size-1.5 bg-due',
  late: 'size-1.5 bg-overdue animate-overdue-pulse',
  done: 'size-1 bg-muted-foreground',
  skipped: 'size-1 bg-muted-foreground/45',
};

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** 每 30 秒对齐真实时间；分钟级足够，且避免逐秒重排列表 */
function useNowMinutes(): number {
  const read = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  };
  const [min, setMin] = useState(read);
  useEffect(() => {
    const id = setInterval(() => setMin(read()), 30_000);
    return () => clearInterval(id);
  }, []);
  return min;
}

/**
 * 签名元素：今日视图的「时间轴脊线」。
 * 全天 0–24h 等比映射到脊线高度，now 线随真实时间缓慢下行；
 * 定时任务按各自时刻落在脊线上，颜色即状态（未到/已过/熄灭）。
 * 装饰性组件：全部信息在任务行内已有等价表达，故对读屏隐藏。
 */
export function DaySpine({ ticks, className }: { ticks: SpineTick[]; className?: string }) {
  const now = useNowMinutes();
  const pct = (m: number) => `${(Math.min(1440, Math.max(0, m)) / 1440) * 100}%`;
  const hh = String(Math.floor(now / 60)).padStart(2, '0');
  const mm = String(Math.floor(now % 60)).padStart(2, '0');

  return (
    <div aria-hidden="true" className={cn('relative w-14 shrink-0 select-none', className)}>
      {/* 轨道：全天 */}
      <div className="absolute inset-y-0 start-10 w-px bg-spine" />
      {/* 已过时间：墨蓝填充，缓慢下行（过渡时长等于采样间隔，形成连续漂移） */}
      <div
        className="absolute top-0 start-10 w-px bg-spine-fill transition-[height] duration-[30s] ease-linear"
        style={{ height: pct(now) }}
      />
      {/* 整点刻度：与 now 标签相距不足 50 分钟时隐去，避免两个 10px 标签相撞 */}
      {HOUR_LABELS.filter(h => Math.abs(now - h * 60) >= 50).map(h => (
        <div key={h} className="absolute start-0 flex items-center -translate-y-1/2" style={{ top: pct(h * 60) }}>
          <span className="w-8 text-end font-mono text-[10px] tabular-nums text-muted-foreground/60">
            {h}:00
          </span>
          <span className="h-px w-3 bg-spine" />
        </div>
      ))}
      {/* 定时任务刻度 */}
      {ticks.map((t, idx) => (
        <span
          key={`${t.time}-${idx}`}
          className={cn(
            'absolute start-[calc(2.5rem+0.5px)] -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity',
            TONE[t.tone],
          )}
          style={{ top: pct(toMinutes(t.time)) }}
        />
      ))}
      {/* now 线：全站唯一强调当前位置的元素 */}
      <div
        className="absolute start-0 flex items-center -translate-y-1/2 transition-[top] duration-[30s] ease-linear"
        style={{ top: pct(now) }}
      >
        <span className="w-8 bg-background text-end font-mono text-[10px] font-medium tabular-nums text-primary">
          {hh}:{mm}
        </span>
        <span className="h-px w-3 bg-primary" />
      </div>
    </div>
  );
}
