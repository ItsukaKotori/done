import Database from 'better-sqlite3';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS, SCHEMA_VERSION } from './schema';

export type Db = Database.Database;

export interface DbHandle {
  db: Db;
  recovered: boolean;
}

/** 规格 §6：损坏库改名保留 .corrupt.<ts> 并新建空库 */
export function openDb(dataDir: string): DbHandle {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'todo.db');
  let recovered = false;
  if (existsSync(file) && !integrityOk(file)) {
    renameSync(file, `${file}.corrupt.${Date.now()}`);
    recovered = true;
  }
  const db = new Database(file);
  migrate(db);
  return { db, recovered };
}

function integrityOk(file: string): boolean {
  let d: Database.Database | null = null;
  try {
    d = new Database(file, { readonly: true });
    return (d.pragma('integrity_check', { simple: true }) as string) === 'ok';
  } catch {
    return false;
  } finally {
    // 抛错路径也必须关句柄，否则 Windows 下后续 rename 被文件锁阻塞（EBUSY）
    try {
      d?.close();
    } catch {
      /* ignore */
    }
  }
}

export function migrate(db: Db): void {
  const ver = db.pragma('user_version', { simple: true }) as number;
  db.transaction(() => {
    for (let v = ver + 1; v <= SCHEMA_VERSION; v++) {
      for (const sql of MIGRATIONS[v]) db.exec(sql);
    }
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
  db.pragma('foreign_keys = ON'); // 级联删除 occurrence_states / reminders
}
