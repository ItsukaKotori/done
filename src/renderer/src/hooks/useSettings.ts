import { useEffect, useState } from 'react';

export function useSettings<K>(key: string, initial: K) {
  const [value, setValue] = useState<K>(initial);
  useEffect(() => {
    void window.api.settings.get<K>(key).then((v) => {
      if (v != null) setValue(v);
    });
  }, [key]);
  const set = async (v: K) => {
    setValue(v);
    await window.api.settings.set(key, v);
  };
  return [value, set] as const;
}
