import { sourcePdfPage } from './pdf.js';
import { type SourceSearch } from './semantic.js';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { WorkPackageSnapshot } from '@sprink/core';
import { ask, searchRules, isSharedReference, AskInputError, validateAskRequest, type AskRequest, type AttachmentInput } from './ask.js';
import type { UploadService } from '../uploads/service.js';
import { UploadError } from '../uploads/formats.js';
import { SourceError, type SourceStore } from './store.js';


/** Mount only under the authenticated /api middleware. */
export function sourceRouter(store: SourceStore, loadPackage?: (id: string) => WorkPackageSnapshot, uploads?: UploadService, search?: SourceSearch, dataDir?: string) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof SourceError) return c.json({ error: error.message, code: error.code }, error.status as ContentfulStatusCode);
    if (error instanceof AskInputError) return c.json({ error: error.message, code: 'invalid_question' }, 400);
    if (error instanceof UploadError) return c.json({ error: error.message, code: error.code }, error.status as ContentfulStatusCode);
    if (error instanceof SyntaxError) return c.json({ error: 'Invalid JSON', code: 'invalid_json' }, 400);
    return c.json({ error: 'Source library operation failed', code: 'internal_error' }, 500);
  });

  app.get('/sources', c => c.json({ documents: store.documents().filter(isSharedReference).map(publicDocument) }));
  app.post('/rules/search', async c => {
    const body = await c.req.json();
    return c.json(await searchRules(store, body?.question, search));
  });
  app.get('/sources/:docId/pages/:page', async c => {
    const bytes = await sourcePdfPage(store, dataDir, c.req.param('docId'), c.req.param('page'));
    c.header('X-Sprink-Demonstration', String(store.document(c.req.param('docId'))!.demonstration));
    c.header('Content-Type', 'image/png');
    c.header('Cache-Control', 'private, no-cache');
    return c.body(new Uint8Array(bytes));
  });
  app.get('/sources/:docId', c => {
    const doc = store.document(c.req.param('docId'));
    if (!doc) throw new SourceError(404, 'not_found', 'Document not found.');
    return c.json({ document: publicDocument(doc), sections: store.sections(doc.id).map(s => view(doc.authorization, s)) });
  });
  app.get('/sources/:docId/sections/:key', c => {
    const doc = store.document(c.req.param('docId'));
    const section = store.section(c.req.param('key'));
    if (!doc || !section || section.docId !== doc.id) throw new SourceError(404, 'not_found', 'Passage not found.');
    const all = store.sections(doc.id);
    const top = section.parentKey ? all.find(s => s.key === section.parentKey)! : section;
    // The passage in place: its section, its exceptions and notes, and the neighbouring sections.
    const i = all.findIndex(s => s.key === top.key);
    const around = all.filter((s, j) => s.parentKey === top.key || s.key === top.key || (s.parentKey === null && Math.abs(j - i) <= 3));
    return c.json({ document: publicDocument(doc), target: section.key, sections: around.map(s => ({ ...view(doc.authorization, s), notes: doc.authorization.display === 'full' ? store.notes(s.key).map(n => ({ text: n.text, author: n.author })) : [] })) });
  });
  app.get('/sources/:docId/file', c => {
    const doc = store.document(c.req.param('docId'));
    if (!doc) throw new SourceError(404, 'not_found', 'Document not found.');
    if (doc.authorization.display !== 'full') throw new SourceError(403, 'display_limited', 'This source limits display. Use the original link.');
    c.header('Content-Type', 'text/plain; charset=utf-8');
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    const content = store.content(doc.id);
    if (content === undefined) throw new SourceError(404, 'source_unavailable', 'Source text is not available.');
    c.header('X-Sprink-Demonstration', String(doc.demonstration));
    return c.body(doc.demonstration ? `DEMONSTRATION: invented test data, not an actual code, manufacturer requirement, or jurisdiction amendment.\n\n${content}` : content);
  });
  app.post('/ask', async c => {
    const body = await c.req.json() as AskRequest;
    validateAskRequest(body);
    let snapshot: WorkPackageSnapshot | null = null;
    if (body.packageId) {
      if (!loadPackage) throw new AskInputError('Work packages are not available on this server.');
      try { snapshot = loadPackage(body.packageId); } catch { throw new AskInputError('That work package could not be opened.'); }
    }
    const ids = Array.isArray(body.attachments) ? body.attachments : [];
    if (ids.length > 6) throw new AskInputError('Attach at most 6 photos to one question.');
    const attachments: AttachmentInput[] = [];
    for (const id of ids) {
      if (typeof id !== 'string') throw new AskInputError('Attachments must be upload ids.');
      if (!uploads) throw new AskInputError('Uploads are not available on this server.');
      const { upload, observations } = await uploads.observations(id);
      attachments.push({ upload, observations });
    }
    return c.json(await ask(store, body, snapshot, attachments, search));
  });
  return app;
}

function view(a: import('./types.js').SourceAuthorization, s: import('./types.js').SourceSection) {
  if (a.display !== 'full') s = { ...s, pdfExcerpt: undefined, regions: undefined };
  if (a.display === 'reference_only') return { ...s, text: '', table: null, limited: 'reference_only' };
  if (a.display === 'excerpt' && s.text.length > a.maxQuoteChars!) return { ...s, text: `${s.text.slice(0, a.maxQuoteChars)}…`, table: null, limited: 'excerpt' };
  return { ...s, limited: null };
}

/** Search-only excerpt text is not part of public document metadata. */
function publicDocument(doc: import('./types.js').SourceDocument) {
  if (!doc.pdf) return doc;
  return { ...doc, pdf: { sha256: doc.pdf.sha256, pageCount: doc.pdf.pageCount } };
}
