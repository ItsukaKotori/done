import { globalShortcut } from 'electron';
import log from 'electron-log/main';
import { PLATFORM } from './platform';

export const DEFAULT_HOTKEY = PLATFORM.quickAddHotkey;
export const DEFAULT_SHOW_MAIN_HOTKEY = PLATFORM.showMainHotkey;
export const DEFAULT_TOGGLE_STRIP_HOTKEY = PLATFORM.toggleStripHotkey;

/** 一个全局热键槽位：注册/更换，失败回滚到上一注册 */
class ShortcutSlot {
  private current: string | null = null;
  private cb: (() => void) | null = null;

  register(acc: string, cb: () => void): boolean {
    if (acc === this.current && cb === this.cb) return true;
    const prev = this.current;
    const prevCb = this.cb;
    if (prev) globalShortcut.unregister(prev);
    let registered = false;
    try {
      registered = globalShortcut.register(acc, cb);
    } catch (e) {
      log.warn('[shortcut] invalid accelerator', acc, e);
    }
    if (!registered) {
      // 回滚：恢复原注册（规格 §6：回退默认，不崩溃）
      if (prev && prevCb) globalShortcut.register(prev, prevCb);
      return false;
    }
    this.current = acc;
    this.cb = cb;
    log.info('[shortcut] registered', acc);
    return true;
  }

  reset(): void {
    this.current = null;
    this.cb = null;
  }
}

const quickAddSlot = new ShortcutSlot();
const showMainSlot = new ShortcutSlot();
const toggleStripSlot = new ShortcutSlot();

/** 注册/更换全局快添热键。返回 false = 注册失败（被占用/非法），原注册保持不动。 */
export function registerQuickAddShortcut(acc: string, cb: () => void): boolean {
  return quickAddSlot.register(acc, cb);
}

/** 呼出主界面热键 */
export function registerShowMainShortcut(acc: string, cb: () => void): boolean {
  return showMainSlot.register(acc, cb);
}

/** 呼出/收起长条热键 */
export function registerToggleStripShortcut(acc: string, cb: () => void): boolean {
  return toggleStripSlot.register(acc, cb);
}

export function unregisterAllShortcuts(): void {
  globalShortcut.unregisterAll();
  quickAddSlot.reset();
  showMainSlot.reset();
  toggleStripSlot.reset();
}
