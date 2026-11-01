import type { CSSProperties } from 'react';
import { ChevronDown, Minus, Square, X } from 'lucide-react';
import { isMac } from '@/lib/platform';

// Chromium 私有的窗口拖拽区域声明
const dragRegion = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDragRegion = { WebkitAppRegion: 'no-drag' } as CSSProperties;

/** 无边框主窗的标题栏：拖拽区 + win 自绘三键；mac 上窗口控制归系统红绿灯（规格 §5） */
export function Titlebar() {
  return (
    <div
      style={dragRegion}
      className="flex h-9 shrink-0 items-center justify-end border-b border-border"
    >
      {/* 仪器铭牌：全站唯一的品牌露出；mac 左移让位红绿灯（ps-20 ≈ 红绿灯区宽） */}
      <span className={`me-auto flex items-center gap-2 select-none ${isMac ? 'ps-20' : 'ps-3'}`}>
        <span className="size-1.5 rounded-full bg-primary" />
        <span className="font-mono text-[11px] tracking-[0.2em] text-muted-foreground">
          WHCHEMTODO
        </span>
      </span>
      <button
        style={noDragRegion}
        className="flex h-9 w-11 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="收缩为长条"
        onClick={() => void window.api.win.collapseStrip()}
      >
        <ChevronDown className="size-3.5" />
      </button>
      {/* win：自绘三键（关窗=隐藏到托盘）；mac：红绿灯归系统，红=关窗应用留后台 */}
      {!isMac && (
        <>
          <button
            style={noDragRegion}
            className="flex h-9 w-11 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="最小化"
            onClick={() => void window.api.win.minimize()}
          >
            <Minus className="size-3.5" />
          </button>
          <button
            style={noDragRegion}
            className="flex h-9 w-11 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="最大化或还原"
            onClick={() => void window.api.win.maximizeToggle()}
          >
            <Square className="size-3" />
          </button>
          <button
            style={noDragRegion}
            className="flex h-9 w-11 items-center justify-center text-muted-foreground hover:bg-overdue hover:text-white"
            aria-label="隐藏到托盘"
            onClick={() => void window.api.win.hideToTray()}
          >
            <X className="size-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
