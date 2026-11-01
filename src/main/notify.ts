import { Notification } from 'electron';
import type { NotifyItem } from './services/scheduler';

export const isNotifySupported = () => Notification.isSupported();

/** 规格 §6：多条过期合并为一条汇总通知，避免轰炸；点击唤起主窗定位；withSound=false 静默 */
export function dispatchNotify(
  items: NotifyItem[],
  onClick: (item: NotifyItem) => void,
  withSound = true,
): void {
  if (!items.length || !isNotifySupported()) return; // 权限关闭：fired 已标记，设置页另出警示
  const build = (title: string, body: string, clickItem: NotifyItem) => {
    const n = new Notification({ title, body, silent: !withSound });
    n.on('click', () => onClick(clickItem));
    n.on('failed', (_e, err) => console.warn('[notify] failed:', err));
    n.show();
  };
  if (items.length === 1) {
    const it = items[0];
    build(
      `${it.overdue ? '⚠ 已过期 · ' : ''}${it.title}`,
      it.timeOfDay ? `提醒时间 ${it.timeOfDay}` : '定时提醒',
      it,
    );
  } else {
    // 汇总标题按实际 overdue 计数，准点齐发的多条不误标"已过期"（终审重要-4）
    const first = items[0]
    const late = items.filter(i => i.overdue).length
    build(
      late ? `⚠ ${late} 条任务已过期` : `${items.length} 条提醒`,
      items.map(i => i.title).join('、').slice(0, 120),
      first,
    )
  }
}
