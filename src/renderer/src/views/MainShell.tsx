import { useEffect, useState } from 'react';
import { Titlebar } from '@/components/Titlebar';
import { Sidebar, type NavKey } from '@/components/Sidebar';
import { applyTheme } from '@/lib/theme';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import TodayView from './TodayView';
import CalendarView from './CalendarView';
import AllTasksView from './AllTasksView';
import StatsView from './StatsView';
import SettingsView from './SettingsView';
import TaskEditDialog, { type EditorState } from '@/components/TaskEditDialog';
import { ShortcutsDialog } from '@/components/ShortcutsDialog';
import type { ThemeMode } from '@/lib/theme';

const isThemeMode = (v: unknown): v is ThemeMode =>
  v === 'light' || v === 'dark' || v === 'system';

export default function MainShell() {
  const [nav, setNav] = useState<NavKey>('today');
  const [editor, setEditor] = useState<EditorState>({ open: false });
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    void window.api.settings
      .get<string>('theme')
      .then((v) => applyTheme(isThemeMode(v) ? v : 'system'));
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onMq = () =>
      void window.api.settings
        .get<string>('theme')
        .then((v) => {
          if ((v ?? 'system') === 'system') applyTheme('system');
        });
    mq.addEventListener('change', onMq);

    const off = window.api.onShowMain((p) => {
      if (p.quickAddDraft) {
        setNav('today');
        setEditor({ open: true, draftTitle: p.quickAddDraft });
      } else if (p.focusTodo) {
        // 通知点击：切今日视图并携带定位信息（重置陈旧编辑态）
        setNav('today');
        setEditor({
          open: false,
          focusTodoId: p.focusTodo.todoId,
          focusDate: p.focusTodo.date,
        });
        toast.info('已定位到提醒任务', { description: p.focusTodo.date });
      }
    });
    return () => {
      mq.removeEventListener('change', onMq);
      off();
    };
  }, []);

  // '?' 打开快捷键帮助（输入态不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      setHelpOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // IPC 错误统一 toast；非 IpcError 的 rejection 只进 console（防噪音刷屏）
  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      const code = (e.reason as { code?: string } | undefined)?.code;
      const name = (e.reason as { name?: string } | undefined)?.name;
      if (code || name === 'IpcError') {
        e.preventDefault();
        toast.error(String(e.reason?.message ?? e.reason));
      } else {
        console.error('[renderer unhandled rejection]', e.reason);
      }
    };
    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <Titlebar />
      <div className="flex min-h-0 flex-1">
        <Sidebar active={nav} onChange={setNav} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          {nav === 'today' && (
            <TodayView
              onEdit={(t) => setEditor({ open: true, todo: t })}
              onNew={() => setEditor({ open: true })}
              focusTodoId={editor.focusTodoId}
            />
          )}
          {nav === 'calendar' && (
            <CalendarView
              onEdit={(t) => setEditor({ open: true, todo: t })}
              onNewOnDate={(d) => setEditor({ open: true, dueDate: d })}
            />
          )}
          {nav === 'all' && (
            <AllTasksView onEdit={(t) => setEditor({ open: true, todo: t })} onNew={() => setEditor({ open: true })} />
          )}
          {nav === 'stats' && <StatsView />}
          {nav === 'settings' && <SettingsView />}
        </main>
      </div>
      <TaskEditDialog state={editor} onClose={() => setEditor({ open: false })} />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <Toaster position="top-center" richColors />
    </div>
  );
}
