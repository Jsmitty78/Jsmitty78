import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve } from 'node:path';
import type { SourceStore } from './store.js';
import type { ExplanationFile, SourceDocument, SourcePackageFile } from './types.js';

export const DEMO_DIR = fileURLToPath(new URL('../../../../demo-sources/', import.meta.url));

/** Reads an import package from disk: metadata JSON, original text file and optional notes. */
export function readSourcePackage(path: string, projectId?: string) {
  const dir = join(path, '..');
  const pkg = JSON.parse(readFileSync(path, 'utf8')) as SourcePackageFile;
  const document = { ...pkg.document, scope: { ...pkg.document.scope } };
  const demoPath = relative(DEMO_DIR, resolve(path));
  if (!demoPath.startsWith('..') && !document.demonstration) throw new Error('Bundled demonstration sources must remain marked demonstration.');
  if (document.type === 'project_document') {
    if (!projectId) return null;
    // The demonstration specification is attached to whichever project loads it.
    if (document.scope.projectId === '__PROJECT__') { document.scope.projectId = projectId; document.id = `${document.id}-${projectId}`.slice(0, 120); }
  }
  const content = readFileSync(join(dir, pkg.file), 'utf8');
  const notes = pkg.explanations ? JSON.parse(readFileSync(join(dir, pkg.explanations), 'utf8')) as ExplanationFile : undefined;
  return { input: { ...document, content, filename: pkg.file }, notes };
}

/** Loads the clearly labelled demonstration documents. Idempotent. */
export function loadDemoSources(store: SourceStore, projectId?: string): SourceDocument[] {
  const out: SourceDocument[] = [];
  for (const f of readdirSync(DEMO_DIR).filter(f => f.endsWith('.source.json')).sort()) {
    const pkg = readSourcePackage(join(DEMO_DIR, f), projectId);
    if (!pkg) continue;
    if (!pkg.input.demonstration) throw new Error(`${f} must be marked demonstration: true`);
    out.push(store.import(pkg.input, pkg.notes));
  }
  return out;
}
