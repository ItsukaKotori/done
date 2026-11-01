import { useEffect, useState } from 'react';
import { formatDuration } from '@/lib/duration';

/** 计时中每秒自 tick；仅该组件重渲染，全站最多一个在跑 */
export function Elapsed({ accumulatedMs, runningSince }: {
  accumulatedMs: number;
  runningSince: number | null;
}) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (runningSince == null) return;
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [runningSince]);

  const ms = accumulatedMs + (runningSince != null ? Date.now() - runningSince : 0);
  return <span className="font-mono tabular-nums">{formatDuration(ms)}</span>;
}
