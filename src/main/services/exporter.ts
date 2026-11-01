import type { TodoDao, OccurrenceDao, TimerDao, SettingsDao } from '../db/dao';
import { SCHEMA_VERSION } from '../db/schema';
import { EXPORT_FORMAT, EXPORT_VERSION, type ExportPayload } from '@shared/export';

/**
 * 组装导出快照。
 * reminders 是派生队列（调度器可从任务重建），刻意不入导出。
 */
export class Exporter {
  constructor(
    private todos: TodoDao,
    private occ: OccurrenceDao,
    private timers: TimerDao,
    private settings: SettingsDao,
    private appVersion: string,
    private clock: () => number = Date.now,
  ) {}

  build(): ExportPayload {
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: this.clock(),
      appVersion: this.appVersion,
      data: {
        todos: this.todos.listAll('all'),
        occurrenceStates: this.occ.listAll(),
        timers: this.timers.listAll(),
        settings: this.settings.all(),
      },
    };
  }
}
