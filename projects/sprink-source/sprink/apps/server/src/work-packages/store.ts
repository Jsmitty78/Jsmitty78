import type Database from 'better-sqlite3';
import type { PackageAsset, WorkPackageSnapshot } from '@sprink/core';
import { PackageError } from './validation.js';

/** One snapshot and immutable, package-owned assets in the existing SQLite database. */
export class WorkPackageStore {
  constructor(readonly db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS work_packages (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS work_packages_project ON work_packages(project_id);
      CREATE TABLE IF NOT EXISTS work_package_assets (
        id TEXT PRIMARY KEY, package_id TEXT NOT NULL REFERENCES work_packages(id),
        project_id TEXT NOT NULL, metadata TEXT NOT NULL, bytes BLOB NOT NULL
      );
    `);
    db.transaction(() => {
      for (const snapshot of this.list()) {
        if (snapshot.run?.status !== 'running') continue;
        snapshot.run.status = 'interrupted';
        snapshot.run.stopReason = 'server_restarted';
        snapshot.run.updatedAt = new Date().toISOString();
        this.save(snapshot);
      }
    })();
  }
  get(id: string): WorkPackageSnapshot {
    const row = this.db.prepare('SELECT data FROM work_packages WHERE id=?').get(id) as { data: string } | undefined;
    if (!row) throw new PackageError(404, 'package_not_found');
    return JSON.parse(row.data);
  }
  list(projectId?: string): WorkPackageSnapshot[] {
    const rows = (projectId === undefined
      ? this.db.prepare('SELECT data FROM work_packages ORDER BY rowid DESC').all()
      : this.db.prepare('SELECT data FROM work_packages WHERE project_id=? ORDER BY rowid DESC').all(projectId)) as { data: string }[];
    return rows.map(row => JSON.parse(row.data));
  }
  insert(snapshot: WorkPackageSnapshot) {
    this.db.prepare('INSERT INTO work_packages(id,project_id,data) VALUES(?,?,?)').run(snapshot.id, snapshot.projectId, JSON.stringify(snapshot));
  }
  save(snapshot: WorkPackageSnapshot) {
    this.db.prepare('UPDATE work_packages SET data=? WHERE id=? AND project_id=?').run(JSON.stringify(snapshot), snapshot.id, snapshot.projectId);
  }
  putAsset(asset: PackageAsset, bytes: Buffer) {
    this.db.prepare('INSERT INTO work_package_assets(id,package_id,project_id,metadata,bytes) VALUES(?,?,?,?,?)')
      .run(asset.id, asset.packageId, asset.projectId, JSON.stringify(asset), bytes);
  }
  asset(packageId: string, projectId: string, assetId: string): { metadata: PackageAsset; bytes: Buffer } {
    const row = this.db.prepare('SELECT metadata,bytes FROM work_package_assets WHERE id=? AND package_id=? AND project_id=?')
      .get(assetId, packageId, projectId) as { metadata: string; bytes: Buffer } | undefined;
    if (!row) throw new PackageError(404, 'asset_not_found');
    return { metadata: JSON.parse(row.metadata), bytes: row.bytes };
  }
}
