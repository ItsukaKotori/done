/** 平台差异集中处：仅本文件判断 process.platform，其余模块消费 IS_MAC/PLATFORM */
export const IS_MAC = process.platform === 'darwin';

export interface PlatformDefaults {
  quickAddHotkey: string;
  showMainHotkey: string;
  toggleStripHotkey: string;
  /** 托盘图标文件名，位于打包根 resources/ 下 */
  trayIconName: string;
  /** true = 模板图（文件名 Template 后缀，Electron 自动标记，系统按明暗反色） */
  trayIconTemplate: boolean;
  /** Windows 专属：首次关窗隐藏时的 displayBalloon 提示 */
  showTrayBubble: boolean;
}

const WIN: PlatformDefaults = {
  quickAddHotkey: 'Ctrl+Alt+A',
  showMainHotkey: 'Ctrl+Alt+W',
  toggleStripHotkey: 'Ctrl+Alt+S',
  trayIconName: 'icon.png',
  trayIconTemplate: false,
  showTrayBubble: true,
};

const MAC: PlatformDefaults = {
  quickAddHotkey: 'Alt+Cmd+A',
  showMainHotkey: 'Alt+Cmd+W',
  toggleStripHotkey: 'Alt+Cmd+S',
  trayIconName: 'trayTemplate.png',
  trayIconTemplate: true,
  showTrayBubble: false,
};

export function defaultsFor(platform: NodeJS.Platform): PlatformDefaults {
  return platform === 'darwin' ? MAC : WIN;
}

export const PLATFORM: PlatformDefaults = defaultsFor(process.platform);
