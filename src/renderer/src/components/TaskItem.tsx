import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { consumeCompleted, occurrenceKey } from '@/lib/just-completed';
import { PRIORITY_COLOR } from '@/lib/priority';
import { TaskTimer } from '@/components/TaskTimer';
import { OccurrenceHistoryDialog } from '@/components/OccurrenceHistoryDialog';
import type { OccurrenceItem } from '@shared/types';

/** 「指示剂」时间状态色：只落在时刻文字上，逾期另有文字兼作色盲冗余 */
const TIME_TONE = {
  overdue: 'text-overdue',
  due: 'text-due',
  quiet: 'text-muted-foreground',
};

/** 规格 §5.1：条目 = 勾选完成 + 优先级色点 + 标题 + 时刻/逾期/重复徽标；右键菜单操作 */
export function TaskItem({ item, timeLabel, onToggle, onSkip, onUnskip, onSnooze, onEdit }: {
  item: OccurrenceItem;
  timeLabel?: string;
  onToggle: () => void;
  onSkip: () => void;
  onUnskip: () => void;
  onSnooze: () => void;
  onEdit: () => void;
}) {
  const isRepeat = item.repeatType !== 'none';
  const done = item.state === 'done';
  // 刚完成 → 播放一次下沉动效（数据刷新后条目会被重挂载，故在挂载时消费标记）
  const [settling] = useState(() => done && consumeCompleted(occurrenceKey(item.todoId, item.date)));
  const [historyOpen, setHistoryOpen] = useState(false);
  const overdue = item.overdue && !done;
  const tone = overdue ? TIME_TONE.overdue : done ? TIME_TONE.quiet : TIME_TONE.due;

  return (
    <>
      <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div
          className={cn(
            'flex cursor-default items-center gap-2.5 rounded-md py-1.5 ps-2 pe-2 select-none hover:bg-muted/70',
            item.state === 'skipped' && 'opacity-40',
            settling && 'animate-settle',
          )}
          onDoubleClick={onEdit}
        >
          <Checkbox
            checked={done}
            onCheckedChange={onToggle}
            aria-label={item.title}
            onClick={(e) => e.stopPropagation()}
          />
          {/* 优先级色点固定在 8px 槽内居中：颜色区分低/中/高；已完成行留空 */}
          <span className="flex w-2 shrink-0 items-center justify-center" aria-hidden="true">
            {!done && <span className={cn('size-2 rounded-full', PRIORITY_COLOR[item.priority])} />}
          </span>
          {/* 时刻与状态紧跟标题，不推到宽窗最右缘 */}
          <span
            className={cn(
              'max-w-[46ch] min-w-0 truncate text-sm',
              done && 'text-muted-foreground line-through decoration-muted-foreground/50',
            )}
          >
            {item.title}
          </span>
          {timeLabel && (
            <span className={cn('shrink-0 font-mono text-xs tabular-nums', tone)}>{timeLabel}</span>
          )}
          {item.timeOfDay && (
            <span className={cn('shrink-0 font-mono text-xs tabular-nums', tone)}>
              {item.timeOfDay}
            </span>
          )}
          {overdue && (
            <span className="shrink-0 font-mono text-[11px] text-overdue">逾期</span>
          )}
          {isRepeat && (
            <span className="shrink-0 rounded-sm border border-border px-1 font-mono text-[10px] text-muted-foreground">
              重复
            </span>
          )}
          <TaskTimer item={item} />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={onToggle}>{done ? '取消完成' : '完成'}</DropdownMenuItem>
        {isRepeat && item.state === 'active' && (
          <DropdownMenuItem onSelect={onSkip}>跳过这一天</DropdownMenuItem>
        )}
        {isRepeat && item.state === 'skipped' && (
          <DropdownMenuItem onSelect={onUnskip}>恢复这一天</DropdownMenuItem>
        )}
        {item.timeOfDay && !done && (
          <DropdownMenuItem onSelect={onSnooze}>稍后再提醒（10 分钟）</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {isRepeat && (
          <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>完成记录…</DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onEdit}>编辑任务…</DropdownMenuItem>
      </DropdownMenuContent>
      </DropdownMenu>

      {isRepeat && (
        <OccurrenceHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          todoId={item.todoId}
          title={item.title}
        />
      )}
    </>
  );
}
