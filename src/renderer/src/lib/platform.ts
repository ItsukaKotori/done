/** 渲染层平台判断：sandbox 下 process 不可靠，用 UA（Electron UA 含 "Macintosh"） */
export function isMacUserAgent(ua: string): boolean {
  return /\bMacintosh\b/.test(ua);
}

export const isMac = isMacUserAgent(navigator.userAgent);

/** 展示用：mac 上 accelerator 里的 Super 实为 Cmd 键（存储串保持 Super 不动） */
export function displayAcceleratorFor(acc: string, mac: boolean): string {
  return mac ? acc.replace(/\bSuper\b/g, 'Cmd') : acc;
}

export const displayAccelerator = (acc: string): string => displayAcceleratorFor(acc, isMac);
