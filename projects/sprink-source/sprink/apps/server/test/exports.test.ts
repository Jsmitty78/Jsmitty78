import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { createApp } from '../src/api.js';
import { FieldService } from '../src/service.js';
import { exportFixture } from './fixtures/export-package.js';
import { WorkPackageExports } from '../src/exports/service.js';
import { canonical, validateSnapshot } from '../src/exports/snapshot.js';
import { exportRoutes } from '../src/exports/routes.js';
import type { ExportSnapshot } from '../src/exports/types.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function setup(adapt = false) {
  const directory = await mkdtemp(join(tmpdir(), 'field-export-')); dirs.push(directory);
  let current: ExportSnapshot | null = exportFixture(adapt);
  const service = new WorkPackageExports({ directory, loadCurrent: async () => current });
  return { directory, service, get current() { return current!; }, set: (s: ExportSnapshot | null) => { current = s; } };
}

describe('revision-bound exports', () => {
  it.each([false, true])('renders and persists both scenario bundles (adapt=%s)', async adapt => {
    const t = await setup(adapt);
    const before = canonical(t.current);
    const manifest = await t.service.create(t.current.binding.packageId, t.current.binding);
    expect(canonical(t.current)).toBe(before);
    expect(manifest.draft).toBe(true);
    expect(manifest.files).toHaveLength(3);
    const pdf = await t.service.download('fixture-package', manifest.exportId, 'work-package.pdf');
    expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const csv = (await t.service.download('fixture-package', manifest.exportId, 'cut-list.csv')).bytes.toString();
    expect(csv).toContain('"1140","mm","known"');
    expect(csv.match(/"140","mm","known"/g)?.length ?? 0).toBe(adapt ? 2 : 0);
    expect(t.current.cuts.reduce((sum, row) => sum + row.length!, 0)).toBe(adapt ? 1420 : 1140);
    const restarted = new WorkPackageExports({ directory: t.directory, loadCurrent: async () => t.current });
    expect((await restarted.download('fixture-package', manifest.exportId, 'bom.csv')).bytes.length).toBeGreaterThan(100);
  });
  it('keeps readable source values and provenance in every artifact manifest and CSV', async () => {
    const t = await setup();
    t.current.inputFacts = [{ id: 'source-P27', field: 'sourceLabel', value: 'P27', unit: null, subjectIds: ['P0'], confirmation: 'confirmed', provenance: 'confirmed_evidence', context: 'detailing', unknownReason: null, source: { description: 'FS-01 source label', assetId: 'official-drawing', page: 1 } },
      { id: 'test-obstacle', field: 'duct.width', value: 200, unit: 'mm', subjectIds: [], confirmation: 'proposed', provenance: 'synthetic_assumption', context: 'observed', unknownReason: null, source: { description: 'Fictional software test only', assetId: null, page: null } }];
    t.current.selectedPlan.context = [{ id: 'h1', sourceLabel: 'H1', kind: 'head', positions: [[0, 0, 0]] }];
    const manifest = await t.service.create(t.current.binding.packageId, t.current.binding);
    expect(manifest.inputFacts).toEqual(t.current.inputFacts);
    expect(manifest.protectedContext?.[0].sourceLabel).toBe('H1');
    expect(manifest.drawingReference).toBe(t.current.drawingReference);
    for (const filename of ['bom.csv', 'cut-list.csv']) {
      const text = (await t.service.download(t.current.binding.packageId, manifest.exportId, filename)).bytes.toString();
      expect(text).toContain('P27');
      expect(text).toContain('synthetic_assumption');
      expect(text).toContain('Fictional software test only');
    }
    t.current.inputFacts[1].provenance = 'user_entered';
    await expect(t.service.download(t.current.binding.packageId, manifest.exportId, 'manifest.json')).rejects.toMatchObject({ status: 409 });
  });
  it.each(['inputRevision', 'configVersion', 'modelVersion', 'selectionId', 'catalogVersion', 'engineVersion', 'rulesVersion', 'evidenceVersion', 'outputVersion'] as const)('rejects stale %s, including the manifest', async key => {
    const t = await setup();
    const manifest = await t.service.create('fixture-package', t.current.binding);
    if (key === 'inputRevision') t.current.binding.inputRevision++;
    else t.current.binding[key] += '-new';
    if (key === 'selectionId') t.current.selectedPlan.id = t.current.binding.selectionId;
    t.current.derivedBinding = { ...t.current.binding };
    for (const filename of ['work-package.pdf', 'bom.csv', 'cut-list.csv', 'manifest.json']) {
      await expect(t.service.download('fixture-package', manifest.exportId, filename)).rejects.toMatchObject({ status: 409 });
    }
  });
  it('detects edits even if a producer accidentally forgot to bump its version', async () => {
    const t = await setup(); const manifest = await t.service.create('fixture-package', t.current.binding);
    t.current.cuts[0].length = 1000;
    await expect(t.service.download('fixture-package', manifest.exportId, 'bom.csv')).rejects.toMatchObject({ status: 409 });
  });
  it('rejects stale output and stale requested binding before creating files', async () => {
    const t = await setup();
    await expect(t.service.create('fixture-package', { ...t.current.binding, inputRevision: 1 })).rejects.toMatchObject({ status: 409 });
    t.current.derivedBinding.evidenceVersion = 'old';
    await expect(t.service.create('fixture-package', t.current.binding)).rejects.toMatchObject({ status: 409 });
  });
  it('rejects a late render after a concurrent edit', async () => {
    const t = await setup(); let calls = 0;
    const service = new WorkPackageExports({ directory: t.directory, loadCurrent: async () => {
      if (++calls === 2) t.current.scope = 'Changed while rendering'; return t.current;
    } });
    await expect(service.create('fixture-package', t.current.binding)).rejects.toMatchObject({ status: 409 });
  });
  it('preserves unknown cuts and missing verification, never turning them into zero', async () => {
    const t = await setup();
    Object.assign(t.current.cuts[0], { length: null, status: 'unresolved', unresolvedReason: 'Endpoint makeup is missing.' });
    t.current.findings.push({ id: 'CHECK1', status: 'unknown', description: 'Missing rule source.', subjectIds: ['P0'], sourceIds: [] });
    const manifest = await t.service.create('fixture-package', t.current.binding);
    const csv = (await t.service.download('fixture-package', manifest.exportId, 'cut-list.csv')).bytes.toString();
    expect(csv).toContain('"","mm","unresolved"');
    expect(csv).toContain('Endpoint makeup is missing.');
    expect(manifest.unresolvedCount).toBe(3);
  });
  it('rejects inaccessible/cross-package files, traversal and corrupted bytes', async () => {
    const t = await setup(); const manifest = await t.service.create('fixture-package', t.current.binding);
    await expect(t.service.download('other', manifest.exportId, 'bom.csv')).rejects.toMatchObject({ status: 404 });
    await expect(t.service.download('../escape', manifest.exportId, 'bom.csv')).rejects.toMatchObject({ status: 400 });
    await expect(t.service.download('fixture-package', manifest.exportId, '../manifest.json')).rejects.toMatchObject({ status: 404 });
    await writeFile(join(t.directory, 'fixture-package', manifest.exportId, 'bom.csv'), 'corrupted');
    await expect(t.service.download('fixture-package', manifest.exportId, 'bom.csv')).rejects.toMatchObject({ status: 409 });
    t.set(null);
    await expect(t.service.download('fixture-package', manifest.exportId, 'manifest.json')).rejects.toMatchObject({ status: 404 });
  });
  it('validates cross-references and explicit unknowns', () => {
    const s = exportFixture(); s.cuts[0].sourceIds = ['missing-source'];
    expect(() => validateSnapshot(s)).toThrow('cross-reference');
    s.cuts[0].sourceIds = ['SYN-END']; s.cuts[0].status = 'unresolved';
    expect(() => validateSnapshot(s)).toThrow('null and a reason');
    s.cuts[0].status = 'known'; s.selectedPlan.segments[0].from[0] = NaN;
    expect(() => validateSnapshot(s)).toThrow('finite 3D');
  });
});

describe('CSV and HTTP boundaries', () => {
  it('mounts into the real host without exposing exports outside bearer authentication', async () => {
    const t = await setup();
    const legacy = new FieldService(join(t.directory, 'legacy'));
    try {
      const token = 'test-token-at-least-sixteen';
      const app = createApp(legacy, { token, workPackageExports: t.service });
      const path = '/api/work-packages/fixture-package/exports';
      expect((await app.request(path, { method: 'POST' })).status).toBe(401);
      const response = await app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedBinding: t.current.binding }) });
      expect(response.status).toBe(201);
      expect((await app.request('/api/health', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    } finally { legacy.store.db.close(); }
  });
  it('serves downloads through authenticated host middleware and rejects client-supplied outputs', async () => {
    const t = await setup();
    const app = new Hono();
    app.use('/api/*', async (c, next) => {
      if (c.req.header('Authorization') !== 'Bearer test-token') return c.json({ error: 'Unauthorized' }, 401);
      await next();
    });
    app.route('/api/work-packages', exportRoutes(t.service));
    const path = '/api/work-packages/fixture-package/exports';
    expect((await app.request(path, { method: 'POST' })).status).toBe(401);
    const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
    const response = await app.request(path, { method: 'POST', headers, body: JSON.stringify({ expectedBinding: t.current.binding }) });
    expect(response.status).toBe(201);
    const manifest = await response.json();
    const download = await app.request(`${path}/${manifest.exportId}/bom.csv`, { headers });
    expect(download.status).toBe(200); expect(download.headers.get('cache-control')).toBe('no-store');
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="bom.csv"');
    expect((await app.request(`${path}/${manifest.exportId}/manifest.json`)).status).toBe(401);
    expect((await app.request(path, { method: 'POST', headers, body: JSON.stringify({ expectedBinding: t.current.binding, snapshot: t.current }) })).status).toBe(400);
    expect((await app.request(path, { method: 'POST', headers, body: '{' })).status).toBe(400);
  });
});
