import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { csvFiles } from './csv.js';
import { renderPdf, type PdfOptions } from './pdf.js';
import { assertSameBinding, sha256, snapshotHash, unresolved, validateSnapshot } from './snapshot.js';
import { ExportError, type ExportBinding, type ExportFileName, type ExportManifest, type ExportSnapshot } from './types.js';

const names: ExportFileName[] = ['work-package.pdf', 'bom.csv', 'cut-list.csv', 'manifest.json'];
export interface ExportServiceOptions {
  directory: string;
  /** Must load authoritative, caller-accessible saved outputs. Null means missing/inaccessible. */
  loadCurrent: (packageId: string) => Promise<ExportSnapshot | null>;
  pdf?: PdfOptions;
}
const safeId = (id: string) => {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new ExportError(400, 'Invalid package/export ID.');
  return id;
};
/** Immutable on-disk bundles; no speculative adapter to the legacy single-head task model. */
export class WorkPackageExports {
  constructor(private options: ExportServiceOptions) {}
  private async current(id: string): Promise<ExportSnapshot> {
    safeId(id);
    const value = await this.options.loadCurrent(id);
    if (!value || value.binding.packageId !== id) throw new ExportError(404, 'Work package not found.');
    const snapshot = structuredClone(value);
    validateSnapshot(snapshot);
    return snapshot;
  }
  async create(packageId: string, expected: ExportBinding): Promise<ExportManifest> {
    const snapshot = await this.current(packageId);
    assertSameBinding(snapshot.binding, expected);
    const hash = snapshotHash(snapshot);
    const csv = csvFiles(snapshot);
    const pdf = await renderPdf(snapshot, this.options.pdf);
    const files = [
      { name: 'work-package.pdf' as const, bytes: pdf, contentType: 'application/pdf' },
      { name: 'bom.csv' as const, bytes: csv.bom, contentType: 'text/csv; charset=utf-8' },
      { name: 'cut-list.csv' as const, bytes: csv.cuts, contentType: 'text/csv; charset=utf-8' },
    ];
    const exportId = randomUUID();
    const manifest: ExportManifest = { schemaVersion: 1, exportId, createdAt: new Date().toISOString(), binding: snapshot.binding,
      snapshotHash: hash, drawingReference: snapshot.drawingReference, inputFacts: snapshot.inputFacts ?? [], protectedContext: snapshot.selectedPlan.context ?? [], draft: true, unresolvedCount: unresolved(snapshot).length, unresolvedItems: unresolved(snapshot),
      files: files.map(f => ({ name: f.name, sha256: sha256(f.bytes), bytes: f.bytes.length, contentType: f.contentType })) };
    const parent = join(this.options.directory, safeId(packageId));
    const temporary = join(parent, '.' + exportId + '.tmp'), target = join(parent, exportId);
    await mkdir(temporary, { recursive: true, mode: 0o700 });
    try {
      for (const file of files) await writeFile(join(temporary, file.name), file.bytes, { flag: 'wx', mode: 0o600 });
      await writeFile(join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
      if (snapshotHash(await this.current(packageId)) !== hash) throw new ExportError(409, 'Inputs changed while exporting. Regenerate from current data.');
      await rename(temporary, target);
    } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
    return manifest;
  }
  async download(packageId: string, exportId: string, filename: string): Promise<{ bytes: Buffer; contentType: string; filename: ExportFileName }> {
    safeId(packageId); safeId(exportId);
    if (!names.includes(filename as ExportFileName)) throw new ExportError(404, 'Export file not found.');
    // Read/authorize current package before touching any artifact, including its manifest.
    const current = await this.current(packageId);
    const directory = join(this.options.directory, packageId, exportId);
    let manifest: ExportManifest, bytes: Buffer;
    try {
      manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
      bytes = await readFile(join(directory, filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ExportError(404, 'Export file not found.');
      throw error;
    }
    assertSameBinding(manifest.binding, current.binding);
    if (manifest.exportId !== exportId || manifest.snapshotHash !== snapshotHash(current)) throw new ExportError(409, 'This export is no longer current. Regenerate it.');
    const file = manifest.files.find(f => f.name === filename);
    if (filename !== 'manifest.json' && (!file || file.sha256 !== sha256(bytes) || file.bytes !== bytes.length)) throw new ExportError(409, 'Export integrity check failed. Regenerate it.');
    if (snapshotHash(await this.current(packageId)) !== manifest.snapshotHash) throw new ExportError(409, 'Work package changed during download.');
    return { bytes, filename: filename as ExportFileName, contentType: file?.contentType ?? 'application/json; charset=utf-8' };
  }
}
