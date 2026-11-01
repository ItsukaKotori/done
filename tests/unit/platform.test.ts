import { describe, it, expect } from 'vitest';
import { defaultsFor, IS_MAC } from '../../src/main/platform';

describe('defaultsFor', () => {
  it('mac 默认热键为 Alt+Cmd 系', () => {
    const d = defaultsFor('darwin');
    expect(d.quickAddHotkey).toBe('Alt+Cmd+A');
    expect(d.showMainHotkey).toBe('Alt+Cmd+W');
    expect(d.toggleStripHotkey).toBe('Alt+Cmd+S');
  });

  it('win 默认热键为 Ctrl+Alt 系', () => {
    const d = defaultsFor('win32');
    expect(d.quickAddHotkey).toBe('Ctrl+Alt+A');
    expect(d.showMainHotkey).toBe('Ctrl+Alt+W');
    expect(d.toggleStripHotkey).toBe('Ctrl+Alt+S');
  });

  it('托盘：mac 用模板图、无气泡；win 彩色图、有气泡', () => {
    const mac = defaultsFor('darwin');
    expect(mac.trayIconName).toBe('trayTemplate.png');
    expect(mac.trayIconTemplate).toBe(true);
    expect(mac.showTrayBubble).toBe(false);
    const win = defaultsFor('win32');
    expect(win.trayIconName).toBe('icon.png');
    expect(win.trayIconTemplate).toBe(false);
    expect(win.showTrayBubble).toBe(true);
  });

  it('其余平台按 win 处理', () => {
    expect(defaultsFor('linux').quickAddHotkey).toBe('Ctrl+Alt+A');
  });

  it('IS_MAC 与进程平台一致', () => {
    expect(IS_MAC).toBe(process.platform === 'darwin');
  });
});
