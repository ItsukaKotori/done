import { useEffect, useState } from 'react';

/** 主进程 broadcastChanged 时自增；作为所有查询 useEffect 的依赖 */
export function useDataVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => window.api.onDataChanged(() => setV((x) => x + 1)), []);
  return v;
}
