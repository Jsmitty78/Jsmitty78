import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FieldService } from '../src/service.js';
import { SourceStore } from '../src/sources/store.js';
import { UploadService, type ReferenceMetadata } from '../src/uploads/service.js';
import { createApp } from '../src/api.js';
import { accessToken, serverConfig } from '../src/config.js';

const clean: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const f of clean.splice(0)) await f(); });
function directory() { const dir = mkdtempSync(join(tmpdir(), 'pilot-persistence-')); clean.push(() => rmSync(dir, { recursive: true, force: true })); return dir; }
const meta: ReferenceMetadata = { title: 'DEMONSTRATION stored fixture', publisher: 'Test author', type: 'company_procedure', edition: 'A', scope: {}, demonstration: true, authorization: { basis: 'Owned test fixture', storeAndIndex: true, useWithAi: true, display: 'full' } };
const fixturePath = join(import.meta.dirname, '../../../fixtures/uploads/native-text-manual.pdf');

describe('pilot configuration', () => {
  it('keeps development on localhost and rejects invalid ports or ambiguous storage', () => {
    const dir = directory();
    expect(serverConfig({}, dir)).toMatchObject({ hostname: '127.0.0.1', port: 4310, dataDir: dir });
    for (const PORT of ['', 'abc', '0', '-1', '65536', '4310.5']) expect(() => serverConfig({ PORT }, dir)).toThrow(/PORT/);
    for (const SPRINK_DATA_DIR of ['', './relative']) expect(() => serverConfig({ SPRINK_DATA_DIR }, dir)).toThrow(/absolute/);
    expect(() => serverConfig({ SPRINK_HOST: '' }, dir)).toThrow(/SPRINK_HOST/);
    expect(() => serverConfig({ SPRINK_HOST: '0.0.0.0' }, dir)).toThrow(/SPRINK_TOKEN/);
  });
  it('requires initialized persistent storage and an explicit strong token in production', () => {
    const dir = directory(), env = { NODE_ENV: 'production', SPRINK_HOST: '0.0.0.0', SPRINK_DATA_DIR: dir, SPRINK_TOKEN: 'p'.repeat(40), PORT: '8080' };
    expect(() => serverConfig({ NODE_ENV: 'production' }, dir)).toThrow(/SPRINK_DATA_DIR/);
    expect(() => serverConfig(env, dir)).toThrow(/initialized/);
    const field = new FieldService(dir); field.store.close();
    expect(serverConfig(env, '/unrelated/checkout')).toMatchObject({ dataDir: dir, hostname: '0.0.0.0', port: 8080 });
    expect(() => serverConfig({ ...env, SPRINK_TOKEN: '' }, dir)).toThrow(/SPRINK_TOKEN/);
    expect(() => serverConfig({ ...env, SPRINK_DATA_DIR: join(dir, 'unmounted') }, dir)).toThrow(/initialized/);
  });
  it('persists generated tokens, supports explicit rotation, and refuses a corrupt token', () => {
    const dir = directory(), first = accessToken(dir);
    expect(first).toHaveLength(64); expect(accessToken(dir)).toBe(first);
    expect(statSync(join(dir, 'access-token')).mode & 0o777).toBe(0o600);
    expect(accessToken(dir, 'configured-token-for-rotation')).toBe('configured-token-for-rotation');
    expect(accessToken(dir)).toBe(first);
    writeFileSync(join(dir, 'access-token'), '');
    expect(() => accessToken(dir)).toThrow(/invalid/);
  });
});

it('reopens SQLite, indexed sources, tokens and original source assets from the same data directory', async () => {
  const dir = directory(), token = accessToken(dir);
  const field = new FieldService(dir), sources = new SourceStore(field.store.db);
  const doc = sources.import({ ...meta, id: 'persistent-fixture', filename: 'fixture.md', content: '<!-- page: 1 -->\n## 1.1 Test\nFixture storage check.' });
  const assetDir = join(dir, 'source-pdfs', 'a'.repeat(64)); mkdirSync(assetDir, { recursive: true });
  const bytes = Buffer.from('persisted-test-asset'); writeFileSync(join(assetDir, '1.png'), bytes);
  sources.db.prepare('UPDATE source_documents SET data=? WHERE id=?').run(JSON.stringify({ ...doc, pdf: { sha256: 'a'.repeat(64), pageCount: 1 } }), doc.id);
  field.store.close();
  const reopened = new FieldService(dir), restored = new SourceStore(reopened.store.db);
  // Close before directory cleanup, including on assertion failures.
  clean.unshift(() => reopened.store.close());
  expect(restored.content(doc.id)).toContain('Fixture storage check.');
  expect(restored.sections(doc.id)).toHaveLength(1); expect(accessToken(dir)).toBe(token);
  const app = createApp(reopened, { token: accessToken(dir), sources: restored });
  const response = await app.request(`/api/sources/${doc.id}/pages/1`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  expect((await app.request(`/api/sources/${doc.id}`, { headers: { Authorization: 'Bearer an-outdated-token' } })).status).toBe(401);
});

it('keeps the previous source on failed re-indexing and blocks every legacy display bypass', async () => {
  const dir = directory(), field = new FieldService(dir), sources = new SourceStore(field.store.db), uploads = new UploadService(field.store.db, dir, sources);
  clean.unshift(async () => { await uploads.ocr.close(); field.store.close(); });
  const created = await uploads.create(readFileSync(fixturePath), { filename: 'fixture.pdf', purpose: 'reference' });
  await uploads.settle(created.id);
  const review = await uploads.review(created.id);
  uploads.saveCorrection(created.id, { acknowledged: review.items.map(i => i.id) });
  const token = 'upload-display-test-token', headers = { Authorization: `Bearer ${token}` };
  const app = createApp(field, { token, sources, uploads });
  // Unreviewed/operator-only content does not acquire browser display rights by default.
  expect((await app.request(`/api/uploads/${created.id}/review`, { headers })).status).toBe(403);
  const indexed = await uploads.index(created.id, meta), original = sources.document(indexed.docId!)!;
  await expect(uploads.index(created.id, { ...meta, authorization: { ...meta.authorization, storeAndIndex: false } })).rejects.toMatchObject({ code: 'not_authorized_to_store' });
  expect(sources.document(original.id)).toEqual(original);
  await expect(uploads.index(created.id, { ...meta, demonstration: false })).rejects.toMatchObject({ code: 'demonstration_required' });
  expect(sources.document(original.id)?.demonstration).toBe(true);
  await uploads.index(created.id, meta);
  const file = await app.request(`/api/uploads/${created.id}/original`, { headers });
  expect(file.status).toBe(200); expect(file.headers.get('X-Sprink-Demonstration')).toBe('true');
  for (const display of ['excerpt', 'reference_only'] as const) {
    await uploads.index(created.id, { ...meta, authorization: { ...meta.authorization, display, maxQuoteChars: 20 } });
    for (const suffix of ['original', 'preview', 'pages/1', 'review', 'observations']) {
      const response = await app.request(`/api/uploads/${created.id}/${suffix}`, { headers });
      expect(response.status, suffix).toBe(403); expect((await response.json()).code).toBe('display_limited');
    }
  }
});
