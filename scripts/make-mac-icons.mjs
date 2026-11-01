// scripts/make-mac-icons.mjs
// 必须在 Electron 主进程中运行：npx electron scripts/make-mac-icons.mjs
// 产出：build/icon-1024.png（母版）、build/icon.icns、resources/trayTemplate{,@2x}.png
import { app, BrowserWindow, screen } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'build');
const iconsetDir = join(buildDir, 'icon.iconset');
const resourcesDir = join(root, 'resources');

// 与现有 256px 图同构：深蓝渐变圆角方块 + 白色对勾 + 橙色光点（viewBox 固定 1024，按尺寸参数化）
function iconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#26344f"/><stop offset="1" stop-color="#0c1322"/>
  </linearGradient></defs>
  <rect width="1024" height="1024" rx="224" fill="url(#bg)"/>
  <path d="M 288 540 L 456 700 L 760 330" fill="none" stroke="#ffffff"
        stroke-width="96" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="762" cy="330" r="34" fill="#f5a623" opacity="0.95"/>
</svg>`;
}

// 菜单栏模板图：仅对勾轮廓，纯黑 + alpha（系统按外观自动反色）
function templateSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <path d="M 14 34 L 26 46 L 50 18" fill="none" stroke="#000000"
        stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

// 本会话环境中首个窗口之后新建的 BrowserWindow 渲染进程无法启动（loadURL 报 ERR_FAILED(-2)），
// show:false 隐藏窗口同样复现；故复用唯一一个屏外可见窗口，setSize 切换尺寸逐张渲染（实测稳定）。
// 注意 macOS 会把超过屏幕可视高度的可见窗口钳制到可视区（1024pt 视口被钳成 ~809pt 导致截图缺高），
// 而 SVG 是矢量的，用 ≤512pt 的视口渲染再放大，几何完全一致、无精度损失。
const MAX_CSS = 512;
let sharedWin = null;

// cssSize：浏览器视口边长（实际渲染尺寸）；outPx：输出 PNG 边长（Retina 下 capturePage 返回 2x 设备像素，
// 统一 resize 到精确像素，iconutil 要求 iconset 内图片尺寸与文件名严格一致）
async function renderPng(svg, cssSize, outPx) {
  if (!sharedWin) {
    sharedWin = new BrowserWindow({
      show: true, x: -32000, y: 0, frame: false, transparent: true, hasShadow: false, width: cssSize, height: cssSize,
      webPreferences: { backgroundThrottling: false },
    });
  } else {
    sharedWin.setSize(cssSize, cssSize);
    await new Promise((r) => setTimeout(r, 80)); // 等 resize 生效
  }
  // transparent 窗口 + 透明页面底色：capturePage 才会保留 alpha（圆角外透明、模板图透明底必需）
  const html = `<html><body style="margin:0;overflow:hidden;background:transparent"><div style="width:${cssSize}px;height:${cssSize}px">${svg}</div></body></html>`;
  await sharedWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 120)); // 等一帧渲染
  const img = await sharedWin.webContents.capturePage({ x: 0, y: 0, width: cssSize, height: cssSize });
  if (img.isEmpty()) throw new Error(`capturePage 返回空图（cssSize=${cssSize}, outPx=${outPx}）`);
  return img.resize({ width: outPx, height: outPx });
}

async function main() {
  await app.whenReady();
  // 视口上限取「512」与屏幕可视高度中较小者，避免窗口被钳制后截图缺高
  const maxCss = Math.min(MAX_CSS, screen.getPrimaryDisplay().workAreaSize.height);
  mkdirSync(buildDir, { recursive: true });
  mkdirSync(resourcesDir, { recursive: true });

  // 母版 1024：512pt 视口渲染，Retina 下 capturePage 直接得到 1024 设备像素
  const master = await renderPng(iconSvg(maxCss), maxCss, 1024);
  writeFileSync(join(buildDir, 'icon-1024.png'), master.toPNG());

  // iconset（同尺寸去重渲染）
  mkdirSync(iconsetDir, { recursive: true });
  const cache = new Map();
  const imgFor = async (px) => {
    if (!cache.has(px)) cache.set(px, await renderPng(iconSvg(Math.min(px, maxCss)), Math.min(px, maxCss), px));
    return cache.get(px);
  };
  const iconset = [
    ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
  ];
  for (const [name, px] of iconset) {
    writeFileSync(join(iconsetDir, name), (await imgFor(px)).toPNG());
  }
  const r = spawnSync('iconutil', ['-c', 'icns', iconsetDir, '-o', join(buildDir, 'icon.icns')], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('iconutil 生成 icns 失败');

  // 模板托盘图标：2 倍尺寸渲染再缩小，边缘更平滑
  for (const [name, px] of [['trayTemplate.png', 16], ['trayTemplate@2x.png', 32]]) {
    const big = await renderPng(templateSvg(px * 2), px * 2, px);
    writeFileSync(join(resourcesDir, name), big.toPNG());
  }

  console.log('build/icon.icns、resources/trayTemplate{,@2x}.png 生成完成');
  if (sharedWin) sharedWin.destroy();
  app.quit();
}

main().catch((err) => {
  console.error('[make-mac-icons] failed:', err);
  app.exit(1);
});
