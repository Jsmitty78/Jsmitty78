import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openPdf } from '../uploads/pdf.js';
import { SourceError, type SourceStore } from './store.js';

/** Operator-only preparation. Publish metadata only after all original pages are ready. */
export async function attachSourcePdf(store: SourceStore, dataDir: string, docId: string, bytes: Buffer) {
  const doc = store.document(docId);
  if (!doc) throw new SourceError(404, 'not_found', 'Document not found.');
  if (doc.authorization.display !== 'full') throw new SourceError(403, 'display_limited', 'Full-page display must be authorized before attaching a PDF.');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const pdf = await openPdf(bytes, 500);
  try {
    if (store.sections(docId).some(s => (s.pageEnd ?? s.pageStart ?? 0) > pdf.pageCount)) throw new SourceError(422, 'page_mismatch', 'Indexed page numbers exceed the original PDF.');
    const dir = join(dataDir, 'source-pdfs', sha256);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, 'original.pdf'), bytes, { mode: 0o600 });
    for (let n = 1; n <= pdf.pageCount; n++) {
      const page = await pdf.page(n);
      await writeFile(join(dir, `${n}.png`), (await page.render()).image, { mode: 0o600 });
    }
    const updated = { ...doc, pdf: { sha256, pageCount: pdf.pageCount } };
    store.db.prepare('UPDATE source_documents SET data=? WHERE id=?').run(JSON.stringify(updated), docId);
    return updated;
  } finally { await pdf.close(); }
}

export async function sourcePdfPage(store: SourceStore, dataDir: string | undefined, docId: string, page: string) {
  const doc = store.document(docId);
  if (!doc || !dataDir || !doc.pdf || !/^[a-f0-9]{64}$/.test(doc.pdf.sha256)) throw new SourceError(404, 'source_unavailable', 'Original PDF is not available.');
  if (doc.authorization.display !== 'full') throw new SourceError(403, 'display_limited', 'This source limits display. Use the original link.');
  if (!/^[1-9]\d*$/.test(page) || Number(page) > doc.pdf.pageCount) throw new SourceError(404, 'not_found', 'Page not found.');
  let bytes: Buffer;
  try { bytes = await readFile(join(dataDir, 'source-pdfs', doc.pdf.sha256, `${page}.png`)); }
  catch { throw new SourceError(404, 'source_unavailable', 'Page image is not available. Ask the library operator to restore it.'); }
  if (JSON.stringify(store.document(docId)) !== JSON.stringify(doc)) throw new SourceError(503, 'source_unavailable', 'The source changed while opening its page. Please try again.');
  return bytes;
}
