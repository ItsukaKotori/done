import type { CSSProperties, MouseEvent } from 'react';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Elapsed } from '@/components/Elapsed';
import { formatDuration } from '@/lib/duration';
import { cn } from '@/lib/utils';
import type { OccurrenceItem } from '@shared/types';

/** 计时控件：idle=开始 / running=暂停 / paused=继续 / done=用时；重复任务带发生日 */
export function TaskTimer({ item }: { item: OccurrenceItem }) {
  const timer = item.timer ?? null;
  const done = item.state === 'done';
  const running = timer?.runningSince != null;
  const dateArg = item.repeatType === 'none' ? undefined : item.date;

  if (done) {
    return timer?.totalMs != null ? (
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        用时 {formatDuration(timer.totalMs)}
      </span>
    ) : null;
  }

  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    if (running) void window.api.todos.pauseTimer(item.todoId, dateArg);
    else void window.api.todos.startTimer(item.todoId, dateArg);
  };

  return (
    <span
      className="flex shrink-0 items-center gap-0.5"
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties} // 在长条拖拽区内仍可点击
      onPointerDown={(e) => e.stopPropagation()} // 阻止外层 DropdownMenuTrigger 在 pointerdown 时打开菜单
    >
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={toggle}
        aria-label={running ? '暂停计时' : '开始计时'}
        title={running ? '暂停计时' : '开始计时'}
      >
        {running ? <Pause /> : <Play />}
      </Button>
      {timer && (timer.accumulatedMs > 0 || running) && (
        <span className={cn('font-mono text-[11px]', running ? 'text-primary' : 'text-muted-foreground')}>
          <Elapsed accumulatedMs={timer.accumulatedMs} runningSince={timer.runningSince} />
        </span>
      )}
    </span>
  );
}
