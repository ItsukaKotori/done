export const SCHEMA_VERSION = 4;

export const MIGRATIONS: Record<number, string[]> = {
  1: [
    `CREATE TABLE todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      notes TEXT,
      priority INTEGER NOT NULL DEFAULT 1,
      due_date TEXT,
      time_of_day TEXT,
      repeat_type TEXT NOT NULL DEFAULT 'none',
      repeat_interval INTEGER,
      repeat_weekdays TEXT,
      monthly_mode TEXT,
      monthly_day INTEGER,
      monthly_weekday INTEGER,
      monthly_which INTEGER,
      start_date TEXT,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL)`,
    `CREATE INDEX idx_todos_due ON todos(due_date)`,
    `CREATE TABLE occurrence_states (
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      occurrence_date TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (todo_id, occurrence_date))`,
    `CREATE TABLE reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      occurrence_date TEXT NOT NULL,
      fire_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      snoozed_until INTEGER,
      created_at INTEGER NOT NULL)`,
    `CREATE INDEX idx_reminders_due ON reminders(status, fire_at)`,
    `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  ],
  2: [
    `CREATE TABLE task_timers (
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      occurrence_date TEXT NOT NULL,
      accumulated_ms INTEGER NOT NULL DEFAULT 0,
      running_since INTEGER,
      total_ms INTEGER,
      PRIMARY KEY (todo_id, occurrence_date))`,
    `CREATE INDEX idx_task_timers_running ON task_timers(running_since)`,
  ],
  3: [
    `ALTER TABLE todos ADD COLUMN tags TEXT`,
  ],
  4: [
    `ALTER TABLE occurrence_states ADD COLUMN completed_at INTEGER`,
  ],
};
