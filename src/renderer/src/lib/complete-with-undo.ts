import { toast } from 'sonner';

/**
 * 完成任务并弹出可撤销 toast（10 秒内可回退）。
 * complete / undo 由调用方提供，以区分一次性任务与重复任务的期次语义。
 */
export function completeWithUndo(opts: {
  title: string;
  complete: () => Promise<unknown>;
  undo: () => Promise<unknown>;
}): void {
  void opts.complete().then(() => {
    toast(`已完成：${opts.title}`, {
      action: { label: '撤销', onClick: () => void opts.undo() },
      duration: 10_000,
    });
  });
}
