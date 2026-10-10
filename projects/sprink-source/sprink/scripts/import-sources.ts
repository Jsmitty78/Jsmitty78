/**
 * Import source packages into the app's SQLite database without the browser.
 *
 *   pnpm sources:import path/to/doc.source.json [more.source.json ...] [--project <projectId>]
 *   pnpm sources:import --demo --project <projectId>
 *
 * A package is a metadata JSON (see demo-sources/*.source.json) pointing to the original text
 * file and, optionally, a separate explanation-notes file. The authorization block is required.
 */
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../apps/server/src/store.js';
import { SourceStore } from '../apps/server/src/sources/store.js';
import { loadDemoSources, readSourcePackage } from '../apps/server/src/sources/demo.js';

const args = process.argv.slice(2);
const projectAt = args.indexOf('--project');
const projectId = projectAt >= 0 ? args[projectAt + 1] : undefined;
const files = args.filter((a, i) => !a.startsWith('--') && (projectAt < 0 || i !== projectAt + 1));
if (process.env.SPRINK_DATA_DIR !== undefined && (!process.env.SPRINK_DATA_DIR.trim() || !isAbsolute(process.env.SPRINK_DATA_DIR))) throw new Error('SPRINK_DATA_DIR must be an absolute path to persistent storage.');
const dataDir = resolve(process.env.SPRINK_DATA_DIR ?? fileURLToPath(new URL('../.data/', import.meta.url)));
// The same database file the server uses (Store opens .data/field.sqlite).
const store = new SourceStore(new Store(dataDir).db);

if (args.includes('--demo')) {
  for (const d of loadDemoSources(store, projectId)) console.log(`demo  ${d.id}  ${d.sectionCount} sections${d.flags.length ? `  flags: ${d.flags.join(', ')}` : ''}`);
}
for (const f of files) {
  const pkg = readSourcePackage(resolve(f), projectId);
  if (!pkg) { console.error(`${f}: project documents need --project <projectId>`); process.exitCode = 1; continue; }
  const d = store.import(pkg.input, pkg.notes);
  console.log(`ok    ${d.id}  ${d.sectionCount} sections${d.flags.length ? `  flags: ${d.flags.join(', ')}` : ''}`);
}
if (!files.length && !args.includes('--demo')) console.log('Usage: pnpm sources:import <file.source.json ...> [--project id] | --demo [--project id]');
