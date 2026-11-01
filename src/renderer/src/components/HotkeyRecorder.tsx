import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

/**
 * 录制一个全局快捷键：点击进入录制，按键写入并保存，Esc 取消。
 * 保存失败（被占用/非法）时主进程抛 IpcError，这里红 toast 提示并保持录制结束。
 */
export function HotkeyRecorder({ value, onSave }: {
  value: string;
  onSave: (accelerator: string) => Promise<void>;
}) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === 'Escape') {
        setRecording(false);
        return;
      }
      const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.metaKey && 'Super'].filter(Boolean) as string[];
      const main = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (!mods.length && !e.key.startsWith('F')) return; // 至少一个修饰键或功能键
      const acc = [...mods, main].join('+');
      try {
        await onSave(acc);
        toast.success(`快捷键已更新为 ${acc}`);
        setRecording(false);
      } catch (err) {
        toast.error(String((err as Error)?.message ?? err)); // 冲突回退，规格 §6
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, onSave]);

  return (
    <Button
      variant={recording ? 'destructive' : 'outline'}
      onClick={() => setRecording(r => !r)}
    >
      {recording ? '按下新快捷键…（Esc 取消）' : value}
    </Button>
  );
}
