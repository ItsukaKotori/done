import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** 规格 §5.3：固定行高虚拟滚动（自研简单版）；自身即滚动容器 */
export function VirtualList<T>({
  items, rowHeight = 44, renderRow, keyOf, className,
}: {
  items: T[];
  rowHeight?: number;
  renderRow: (item: T, index: number) => ReactNode;
  keyOf?: (item: T, index: number) => string | number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = items.length * rowHeight;
  // 下/上界双向钳制：items 收缩时 start 越界会空一帧（审查 #3）
  const start = Math.min(
    Math.max(0, Math.floor(scrollTop / rowHeight) - 2),
    Math.max(0, items.length - 1),
  );
  const end = Math.min(items.length, start + Math.ceil(viewport / rowHeight) + 4);

  return (
    <div
      ref={ref}
      className={cn('overflow-y-auto', className)}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
    >
      <div style={{ height: total, position: 'relative' }}>
        {items.slice(start, end).map((item, i) => (
          <div
            key={keyOf ? keyOf(item, start + i) : start + i}
            style={{
              position: 'absolute', top: (start + i) * rowHeight,
              left: 0, right: 0, height: rowHeight,
            }}
          >
            {renderRow(item, start + i)}
          </div>
        ))}
      </div>
    </div>
  );
}
