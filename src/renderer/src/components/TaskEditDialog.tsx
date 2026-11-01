import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { RepeatField } from './RepeatField';
import { todayStr } from '@shared/recurrence';
import { normalizeTags } from '@shared/tags';
import type { EditorState } from './editor-state';
import type { Todo, TodoDraft, Priority } from '@shared/types';

export type { EditorState };

const WEEK_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

const emptyDraft = (dueDate: string): TodoDraft => ({
  title: '', notes: null, priority: 1, dueDate, timeOfDay: null,
  repeatType: 'none', repeatInterval: null, repeatWeekdays: null,
  monthlyMode: null, monthlyDay: null, monthlyWeekday: null, monthlyWhich: null,
  startDate: null, completedAt: null,
});

const todoToDraft = (t: Todo): TodoDraft => {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = t;
  return rest;
};

/** 规格 §5.5：创建/编辑共用；底部实时预览"下次出现"（防抖 300ms 走主进程展开引擎） */
export default function TaskEditDialog({ state, onClose }: {
  state: EditorState;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TodoDraft>(emptyDraft(todayStr(Date.now())));
  const [dateOpen, setDateOpen] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [tagText, setTagText] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 打开时重置表单（新建带预填 / 编辑带既有任务）
  useEffect(() => {
    if (!state.open) return;
    const base = state.todo
      ? todoToDraft(state.todo)
      : emptyDraft(state.dueDate ?? todayStr(Date.now()));
    setDraft(state.draftTitle ? { ...base, title: state.draftTitle } : base);
    setTagText((base.tags ?? []).join(', '));
    setPreviews([]);
    setConfirmingDelete(false); // 重开时重置删除确认态
  }, [state]);

  useEffect(() => {
    if (!state.open || !draft.dueDate) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void window.api.todos
        .preview({ draft, todoId: state.todo?.id })
        .then(setPreviews)
        .catch(() => setPreviews([]));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [draft, state.open, state.todo?.id]);

  const canSave = draft.title.trim().length > 0 && !!draft.dueDate;

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const payload = { ...draft, title: draft.title.trim(), tags: normalizeTags(tagText.split(/[,，]/)) };
      if (state.todo) {
        await window.api.todos.update(state.todo.id, payload);
        toast.success('任务已更新');
      } else {
        await window.api.todos.create(payload);
        toast.success('任务已创建');
      }
      onClose();
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!state.todo || saving) return;
    setSaving(true);
    try {
      await window.api.todos.remove(state.todo.id);
      toast.success('任务已删除');
      onClose();
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const dateValue = draft.dueDate ? new Date(draft.dueDate + 'T00:00:00') : undefined;
  const previewLine = previews
    .slice(0, 5)
    .map(d => `${WEEK_SHORT[new Date(d + 'T00:00:00').getDay()]} ${d.slice(5)}`)
    .join(' · ');

  return (
    <Dialog open={state.open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display tracking-tight">
            {state.todo ? '编辑任务' : '新建任务'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="任务标题 *"
            value={draft.title}
            onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save(); }}
          />
          <Textarea
            placeholder="备注（可选）"
            rows={2}
            value={draft.notes ?? ''}
            onChange={e => setDraft(d => ({ ...d, notes: e.target.value || null }))}
          />
          <Input
            placeholder="标签（逗号分隔，可选）"
            value={tagText}
            onChange={e => setTagText(e.target.value)}
          />

          <div className="flex gap-3">
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="flex-1 justify-start font-normal">
                  <CalendarIcon className="me-2 h-4 w-4" />
                  <span className="font-mono tabular-nums">
                    {dateValue ? format(dateValue, 'yyyy-MM-dd') : '选择日期 *'}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateValue}
                  autoFocus
                  onSelect={(d) => {
                    if (d) {
                      setDraft(x => ({ ...x, dueDate: format(d, 'yyyy-MM-dd') }));
                      setDateOpen(false);
                    }
                  }}
                />
              </PopoverContent>
            </Popover>
            <Input
              type="time"
              className="w-32 font-mono tabular-nums"
              value={draft.timeOfDay ?? ''}
              onChange={e => setDraft(d => ({ ...d, timeOfDay: e.target.value || null }))}
            />
            <Select
              value={String(draft.priority)}
              onValueChange={v => setDraft(d => ({ ...d, priority: Number(v) as Priority }))}
            >
              <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">低</SelectItem>
                <SelectItem value="1">中</SelectItem>
                <SelectItem value="2">高</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">提醒时刻留空 = 只显示在日历，不发送通知</p>

          <div>
            <p className="mb-2 font-display text-sm font-medium">重复</p>
            <RepeatField value={draft} onChange={v => setDraft(d => ({ ...d, ...v }))} />
          </div>

          {previewLine && (
            <p className="font-mono text-xs text-muted-foreground">下次出现：{previewLine}</p>
          )}

          {confirmingDelete && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              确定删除该任务？关联的重复状态与计时记录会一并删除，无法恢复。
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {state.todo ? (
            <Button
              variant="destructive"
              disabled={saving}
              onClick={() => (confirmingDelete ? void remove() : setConfirmingDelete(true))}
            >
              {confirmingDelete ? '确认删除' : '删除'}
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            {confirmingDelete ? (
              <Button variant="outline" disabled={saving} onClick={() => setConfirmingDelete(false)}>
                取消删除
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={onClose}>取消</Button>
                <Button onClick={() => void save()} disabled={!canSave || saving}>保存</Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
