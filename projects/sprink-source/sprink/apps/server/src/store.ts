import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AppError, type TaskSnapshot } from './models.js';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

// Read old tasks without exposing the removed runtime's transient state.
// Existing session/job records stay in the database; they are never resumed.
function parseTask(data: string): TaskSnapshot {
  const task = JSON.parse(data);
  delete task.run;
  return task;
}

export class Store {
  readonly db: Database.Database;
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new Database(join(dir, 'field.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (task_id TEXT NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(task_id,id));
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets (task_id TEXT NOT NULL, id TEXT NOT NULL, path TEXT NOT NULL, mime TEXT NOT NULL, PRIMARY KEY(task_id,id));

    `);
    // Derived SVGs were previously duplicated in snapshots and idempotency results.
    // Strip only those fields; preserve historical revisions, evidence and operation hashes.
    if (Number(this.db.pragma('user_version', { simple: true })) < 2) {
      this.db.transaction(() => {
        this.db.exec(`
          UPDATE tasks SET data=json_remove(data, '$.plan.svg', '$.artifact.plan.svg')
            WHERE json_type(data, '$.plan.svg') IS NOT NULL OR json_type(data, '$.artifact.plan.svg') IS NOT NULL;
          UPDATE operations SET result=json_remove(result, '$.plan.svg', '$.artifact.plan.svg')
            WHERE json_type(result, '$.plan.svg') IS NOT NULL OR json_type(result, '$.artifact.plan.svg') IS NOT NULL;
          PRAGMA user_version = 2;
        `);
      })();
    }
  }
  listSummaries(): Pick<TaskSnapshot,'id'|'title'|'state'|'revision'|'updatedAt'>[] {
    return this.db.prepare(`SELECT id, json_extract(data,'$.title') AS title,
      json_extract(data,'$.state') AS state, json_extract(data,'$.revision') AS revision,
      json_extract(data,'$.updatedAt') AS updatedAt FROM tasks ORDER BY rowid DESC`).all() as Pick<TaskSnapshot,'id'|'title'|'state'|'revision'|'updatedAt'>[];
  }
  get(id: string): TaskSnapshot {
    const row = this.db.prepare('SELECT data FROM tasks WHERE id = ?').get(id) as {data:string} | undefined;
    if (!row) throw new AppError(404, '仕事が見つかりません');
    return parseTask(row.data);
  }
  list(): TaskSnapshot[] {
    return (this.db.prepare('SELECT data FROM tasks ORDER BY rowid DESC').all() as {data:string}[]).map(r => parseTask(r.data));
  }
  save(task: TaskSnapshot) {
    this.db.prepare('INSERT INTO tasks(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(task.id, JSON.stringify(task));
  }
  event(taskId: string, type: string, data: unknown) {
    this.db.prepare('INSERT INTO events(task_id,type,data,created_at) VALUES(?,?,?,?)').run(taskId,type,JSON.stringify(data),new Date().toISOString());
  }
  events(taskId: string, after: number) {
    return (this.db.prepare('SELECT * FROM events WHERE task_id=? AND id>? ORDER BY id LIMIT 100').all(taskId,after) as {id:number;type:string;data:string;created_at:string}[]).map(e=>({...e,data:JSON.parse(e.data)}));
  }
  operation<T>(taskId: string, id: string, input: unknown, execute: () => T): T {
    return this.db.transaction(() => {
      const hash=digest(input);
      const prior=this.db.prepare('SELECT hash,result FROM operations WHERE task_id=? AND id=?').get(taskId,id) as {hash:string;result:string}|undefined;
      if (prior) {
        if(prior.hash!==hash) throw new AppError(409,'同じ操作IDに異なる内容が送られました');
        return JSON.parse(prior.result) as T;
      }
      const result=execute();
      this.db.prepare('INSERT INTO operations(task_id,id,hash,result) VALUES(?,?,?,?)').run(taskId,id,hash,JSON.stringify(result));
      return result;
    })();
  }
  close() { this.db.close(); }
}
