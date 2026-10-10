import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../apps/server/src/store.js';
import { SourceStore } from '../apps/server/src/sources/store.js';
import { preparePdfExcerpts } from '../apps/server/src/sources/pdf-excerpts.js';
const [docId, filename] = process.argv.slice(2);
if (!docId || !filename || !process.env.SPRINK_DATA_DIR) throw new Error('Usage: SPRINK_DATA_DIR=/absolute/data pnpm exec tsx scripts/prepare-source-excerpts.ts document-id reviewed-excerpts.json');
const store = new Store(resolve(process.env.SPRINK_DATA_DIR));
try {
  const doc = preparePdfExcerpts(new SourceStore(store.db), docId, JSON.parse(readFileSync(resolve(filename), 'utf8')));
  console.log(`${doc.id}: ${doc.pdf.excerpts.length} reviewed excerpts ready`);
} finally { store.close(); }
