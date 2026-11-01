import { useEffect, useState } from 'react';
import { useDataVersion } from './useDataVersion';
import type { OccurrenceItem } from '@shared/types';

export function useTodos(from: string, to: string) {
  const [items, setItems] = useState<OccurrenceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const version = useDataVersion();
  useEffect(() => {
    let alive = true;
    window.api.todos
      .list({ from, to })
      .then((r) => {
        if (alive) {
          setItems(r);
          setError(null);
        }
      })
      .catch((e) => {
        if (alive) setError(String(e?.message ?? e));
      });
    return () => {
      alive = false;
    };
  }, [from, to, version]);
  return { items, error };
}
