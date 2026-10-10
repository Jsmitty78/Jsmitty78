import { Hono } from 'hono';
import type { WorkPackageExports } from './service.js';
import { ExportError } from './types.js';

/** Mount inside the existing authenticated /api boundary. No snapshot payload accepted. */
export function exportRoutes(service: WorkPackageExports) {
  const app = new Hono();
  app.post('/:id/exports', async c => {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || !body.expectedBinding || Object.keys(body).some(k => k !== 'expectedBinding')) {
      throw new ExportError(400, 'Expected only {expectedBinding}; export data must come from saved server outputs.');
    }
    return c.json(await service.create(c.req.param('id'), body.expectedBinding), 201);
  });
  app.get('/:id/exports/:exportId/:filename', async c => {
    const file = await service.download(c.req.param('id'), c.req.param('exportId'), c.req.param('filename'));
    c.header('Content-Type', file.contentType);
    c.header('Content-Disposition', `attachment; filename="${file.filename}"`);
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(new Uint8Array(file.bytes));
  });
  app.onError((error, c) => {
    if (error instanceof ExportError) return c.json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return c.json({ error: 'Invalid JSON.' }, 400);
    return c.json({ error: 'Export failed. Saved package inputs are unchanged.' }, 500);
  });
  return app;
}
