import pngToIco from 'png-to-ico';
import { copyFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';

if (!existsSync('resources/icon.png')) {
  console.error('缺少 resources/icon.png（256x256 PNG）');
  process.exit(1);
}
mkdirSync('build', { recursive: true });
copyFileSync('resources/icon.png', 'build/icon.png'); // 托盘与通知引用的 png
const ico = await pngToIco('resources/icon.png');     // 内部自动缩放多尺寸
writeFileSync('build/icon.ico', ico);
console.log('build/icon.{png,ico} 生成完成');
