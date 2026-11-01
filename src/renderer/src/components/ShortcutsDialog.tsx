import { isMac } from '@/lib/platform';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const GLOBAL_KEYS: Array<[string, string]> = isMac
  ? [
      ['Alt+Cmd+A', '快速添加窗口'],
      ['Alt+Cmd+W', '呼出主界面'],
      ['Alt+Cmd+S', '呼出 / 收起长条'],
    ]
  : [
      ['Ctrl+Alt+A', '快速添加窗口'],
      ['Ctrl+Alt+W', '呼出主界面'],
      ['Ctrl+Alt+S', '呼出 / 收起长条'],
    ];

const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: '全局（系统级）',
    items: GLOBAL_KEYS,
  },
  {
    title: '应用内',
    items: [
      [isMac ? 'Cmd+F' : 'Ctrl+F', '在「全部任务」中搜索'],
      ['j / k', '今日视图上 / 下选择任务'],
      ['x', '完成 / 取消完成选中任务'],
      ['Space', '开始 / 暂停选中任务计时'],
      ['Enter', '编辑选中任务'],
      ['Esc', '取消选择 / 清空搜索'],
      ['?', '显示本帮助'],
    ],
  },
];

export function ShortcutsDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display tracking-tight">快捷键</DialogTitle>
          <DialogDescription>全局热键可在「设置 → 快捷键」中重新录制。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {GROUPS.map(g => (
            <section key={g.title}>
              <h3 className="mb-1.5 font-mono text-[11px] tracking-[0.18em] text-muted-foreground">
                {g.title}
              </h3>
              <ul className="space-y-1.5">
                {g.items.map(([keys, desc]) => (
                  <li key={keys} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{desc}</span>
                    <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[11px]">
                      {keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
