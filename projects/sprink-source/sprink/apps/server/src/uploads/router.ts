import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { SourceError } from '../sources/store.js';
import { LIMITS, UploadError } from './formats.js';
import type { UploadPurpose, UploadService } from './service.js';

const PURPOSES: UploadPurpose[] = ['reference', 'site_photo'];
const PROJECT = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,80}$/;

/** Mount only under the authenticated /api middleware. Every file is served through here, never from a public path. */
export function uploadRouter(uploads: UploadService) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof UploadError || error instanceof SourceError) return c.json({ error: error.message, code: error.code }, error.status as ContentfulStatusCode);
    if (error instanceof SyntaxError) return c.json({ error: 'Invalid JSON', code: 'invalid_json' }, 400);
    console.error(`uploads: ${error?.name ?? 'Error'}`);
    return c.json({ error: 'The upload operation failed. Retry.', code: 'internal_error' }, 500);
  });

  app.use('/uploads/:id/*', async (c, next) => {
    if (c.req.method === 'GET') {
      const demonstration = uploads.assertPublicDisplay(c.req.param('id'));
      if (demonstration !== null) c.header('X-Sprink-Demonstration', String(demonstration));
    }
    await next();
    if (c.req.method === 'GET' && c.res.ok) uploads.assertPublicDisplay(c.req.param('id'));
  });
  app.post('/uploads', bodyLimit({ maxSize: LIMITS.maxBytes + 1024 * 1024, onError: c => c.json({ error: `The file is larger than ${LIMITS.maxBytes / 1048576} MB.`, code: 'file_too_large' }, 413) }), async c => {
    const t0 = performance.now();
    const form = await c.req.parseBody().catch(() => { throw new UploadError(400, 'invalid_upload', 'Send the file as multipart form data with a "file" field.'); });
    const file = form.file;
    if (!(file instanceof File)) throw new UploadError(400, 'missing_file', 'No file was attached.');
    const purpose = String(form.purpose ?? '') as UploadPurpose;
    if (!PURPOSES.includes(purpose)) throw new UploadError(400, 'missing_purpose', 'Say whether this is a reference document for the library or a site photo for this question.');
    if (purpose === 'reference') throw new UploadError(403, 'managed_library', 'Reference sources are maintained by the library administrator.');
    const projectId = typeof form.projectId === 'string' && PROJECT.test(form.projectId) ? form.projectId : null;
    const packageId = typeof form.packageId === 'string' && PROJECT.test(form.packageId) ? form.packageId : null;
    const bytes = Buffer.from(await file.arrayBuffer());
    const record = await uploads.create(bytes, { filename: file.name, purpose, projectId, packageId, uploadMs: Math.round(performance.now() - t0) });
    return c.json(record, 202);
  });
  app.get('/uploads', c => {
    const purpose = c.req.query('purpose') as UploadPurpose | undefined;
    return c.json({ uploads: uploads.list({ purpose: purpose && PURPOSES.includes(purpose) ? purpose : undefined, projectId: c.req.query('projectId') || undefined }) });
  });
  app.get('/uploads/:id', c => c.json(uploads.get(c.req.param('id'))));
  app.delete('/uploads/:id', async c => { if (uploads.get(c.req.param('id')).purpose === 'reference') throw new UploadError(403, 'managed_library', 'Reference sources are maintained by the library administrator.'); await uploads.remove(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/uploads/:id/retry', async c => {
    if (uploads.get(c.req.param('id')).purpose === 'reference') throw new UploadError(403, 'managed_library', 'Reference sources are maintained by the library administrator.');
    return c.json(await uploads.retry(c.req.param('id')), 202);
  });
  app.get('/uploads/:id/review', async c => c.json(await uploads.review(c.req.param('id'))));
  app.get('/uploads/:id/observations', async c => {
    const { upload, observations } = await uploads.observations(c.req.param('id'));
    return c.json({ upload, observations });
  });
  app.get('/uploads/:id/preview', async c => image(c, await uploads.preview(c.req.param('id')), 'image/jpeg'));
  app.get('/uploads/:id/pages/:n', async c => image(c, await uploads.pageImage(c.req.param('id'), Number(c.req.param('n'))), 'image/png'));
  app.get('/uploads/:id/original', async c => {
    const { record, bytes } = await uploads.original(c.req.param('id'));
    c.header('Content-Type', record.mime);
    c.header('Content-Disposition', `inline; filename="${record.filename.replace(/"/g, '')}"`);
    c.header('Content-Security-Policy', "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; sandbox");
    c.header('Cache-Control', 'private, no-store');
    return c.body(new Uint8Array(bytes));
  });
  return app;
}

function image(c: import('hono').Context, bytes: Buffer, type: string) {
  c.header('Content-Type', type);
  c.header('Cache-Control', 'private, max-age=300');
  return c.body(new Uint8Array(bytes));
}
