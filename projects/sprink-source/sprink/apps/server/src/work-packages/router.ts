import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type Database from 'better-sqlite3';
import type { Store } from '../store.js';
import { WorkPackageStore } from './store.js';
import { WorkPackageService } from './service.js';
import { PackageError } from './validation.js';
import { SiteWorkService, reviewFingerprint } from './site-work.js';

const defaults = new WeakMap<Database.Database, WorkPackageService>();
export function defaultWorkPackages(store: Store) {
  let service = defaults.get(store.db);
  if (!service) {
    service = new WorkPackageService(new WorkPackageStore(store.db), process.env.SPRINK_CONFIG_VERSION);
    defaults.set(store.db, service);
  }
  return service;
}

/** Mount only under the existing authenticated /api middleware. */
export function workPackageRouter(service: WorkPackageService, loadDetails?: (id: string) => unknown) {
  const app = new Hono();
  const site = new SiteWorkService(service);
  app.post('/:id/site-evidence', async c => c.json(await site.evidence(c.req.param('id'), await c.req.json())));
  app.post('/:id/reading-request', async c => c.json(site.request(c.req.param('id'), await c.req.json())));
  app.post('/:id/reading-confirmation', async c => c.json(site.confirm(c.req.param('id'), await c.req.json())));
  app.post('/:id/measurements', async c => c.json(site.measure(c.req.param('id'), await c.req.json())));
  app.post('/:id/designer-reviews', async c => c.json(site.review(c.req.param('id'), await c.req.json())));
  app.get('/:id/site-work', c => {
    const s = service.get(c.req.param('id'));
    return c.json({ work: s.siteWork ?? null, fingerprint: reviewFingerprint(s) });
  });
  app.onError((error, c) => {
    if (error instanceof PackageError) return c.json({ error: error.message, code: error.code }, error.status as ContentfulStatusCode);
    if (error instanceof SyntaxError) return c.json({ error: 'Invalid JSON', code: 'invalid_json' }, 400);
    return c.json({ error: 'Work-package operation failed', code: 'internal_error' }, 500);
  });
  app.get('/', c => c.json(service.list(c.req.query('projectId'))));
  app.post('/', async c => c.json(service.create(await c.req.json()), 201));
  app.get('/:id', c => c.json(service.get(c.req.param('id'))));
  app.post('/:id/site-change', async c => c.json(service.copyForSiteChange(c.req.param('id'), await c.req.json()), 201));
  app.patch('/:id', async c => c.json(service.edit(c.req.param('id'), await c.req.json())));
  app.post('/:id/assets', async c => {
    const body = await c.req.parseBody(), file = body.file;
    if (!(file instanceof File)) throw new PackageError(400, 'file_required');
    return c.json(await service.upload(c.req.param('id'), Buffer.from(await file.arrayBuffer()), file.type, file.name), 201);
  });
  app.get('/:id/assets/:assetId', c => {
    const asset = service.sourceAsset(c.req.param('id'), c.req.param('assetId'));
    c.header('Content-Type', asset.metadata.mimeType);
    c.header('Content-Disposition', `${asset.metadata.mimeType.startsWith('image/') ? 'inline' : 'attachment'}; filename="${asset.metadata.filename}"`);
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    return c.body(new Uint8Array(asset.bytes));
  });
  if (loadDetails) app.get('/:id/detail', c => c.json(loadDetails(c.req.param('id'))));
  app.get('/:id/candidates', c => {
    const s = service.get(c.req.param('id'));
    return c.json({ candidates: s.outputs.candidates, current: s.freshness.candidates, selectedPlan: s.selectedPlan });
  });
  app.post('/:id/selection', async c => c.json(service.select(c.req.param('id'), await c.req.json())));
  app.get('/:id/outputs', c => {
    const s = service.get(c.req.param('id'));
    return c.json({ results: s.outputs.results, freshness: s.freshness.results });
  });
  app.get('/:id/requests', c => {
    const s = service.get(c.req.param('id'));
    return c.json({ requests: s.outputs.requests, answers: s.answers, freshness: s.freshness.requests });
  });
  app.post('/:id/answers', async c => c.json(service.answer(c.req.param('id'), await c.req.json())));
  app.post('/:id/runs', async c => {
    const result = service.start(c.req.param('id'), await c.req.json());
    return c.json(result, result.reused ? 200 : 202);
  });
  app.get('/:id/runs/latest', c => c.json({ run: service.get(c.req.param('id')).run }));
  app.post('/:id/runs/:runId/cancel', c => c.json({ run: service.cancel(c.req.param('id'), c.req.param('runId')) }));
  app.get('/:id/artifacts', c => {
    const s = service.get(c.req.param('id'));
    return c.json({ artifacts: s.outputs.artifacts, freshness: s.freshness.artifacts });
  });
  app.get('/:id/artifacts/:artifactId/download', c => {
    const asset = service.artifact(c.req.param('id'), c.req.param('artifactId'));
    c.header('Content-Type', asset.metadata.mimeType);
    c.header('Content-Disposition', `attachment; filename="${asset.metadata.filename}"`);
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    return c.body(new Uint8Array(asset.bytes));
  });
  return app;
}
