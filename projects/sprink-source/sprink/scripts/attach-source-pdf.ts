import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Store } from '../apps/server/src/store.js';
import { SourceStore } from '../apps/server/src/sources/store.js';
import { attachSourcePdf } from '../apps/server/src/sources/pdf.js';
const [docId, filename] = process.argv.slice(2);
if (!docId || !filename || !process.env.SPRINK_DATA_DIR) throw new Error('Usage: SPRINK_DATA_DIR=/absolute/data pnpm exec tsx scripts/attach-source-pdf.ts document-id original.pdf');
const dataDir = resolve(process.env.SPRINK_DATA_DIR);
const db = new Store(dataDir);
try {
  const doc = await attachSourcePdf(new SourceStore(db.db), dataDir, docId, await readFile(resolve(filename)));
  console.log(`${doc.id}: ${doc.pdf!.pageCount} original pages ready (${doc.pdf!.sha256})`);
} finally { db.close(); }
