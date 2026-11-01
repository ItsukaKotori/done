import { cn } from '@/lib/utils';

export type NavKey = 'today' | 'calendar' | 'all' | 'stats' | 'settings';

const ITEMS: Array<[NavKey, string]> = [
  ['today', '今日'],
  ['calendar', '日历'],
  ['all', '全部任务'],
  ['stats', '统计'],
  ['settings', '设置'],
];

/** 去卡片化导航：层级靠 1px 分隔与墨色深浅，选中项只用一条墨蓝指示条 */
export function Sidebar({ active, onChange }: { active: NavKey; onChange: (k: NavKey) => void }) {
  return (
    <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-e border-border px-2 py-3">
      {ITEMS.map(([k, label]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          aria-current={active === k ? 'page' : undefined}
          className={cn(
            'relative rounded-md px-3 py-2 text-start text-sm text-muted-foreground transition-colors',
            'hover:bg-muted/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
            active === k && 'bg-accent/50 font-medium text-foreground',
          )}
        >
          {active === k && (
            <span className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-primary" />
          )}
          {label}
        </button>
      ))}
    </nav>
  );
}
