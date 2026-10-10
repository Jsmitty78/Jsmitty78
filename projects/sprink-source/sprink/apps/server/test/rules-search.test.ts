import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FieldService } from '../src/service.js';
import { createApp } from '../src/api.js';
import { SourceStore } from '../src/sources/store.js';
import { UploadService } from '../src/uploads/service.js';
import type { SourceDocumentInput } from '../src/sources/types.js';
import type { Passage } from '../src/sources/semantic.js';

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach(f => f()));
const auth = { Authorization: 'Bearer shared-rules-test-token', 'Content-Type': 'application/json' };
function setup(select: (question: string, passages: Passage[]) => Promise<string[]>) {
  const dir = mkdtempSync(join(tmpdir(), 'shared-rules-'));
  const field = new FieldService(dir);
  const sources = new SourceStore(field.store.db);
  const uploads = new UploadService(field.store.db, dir, sources);
  const app = createApp(field, { token: 'shared-rules-test-token', sources, uploads, sourceSearch: { select } });
  cleanup.push(() => { field.store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { app, sources };
}
const manual = (over: Partial<SourceDocumentInput> = {}): SourceDocumentInput => ({
  id: 'shared-manual', title: 'Fixture manufacturer manual', publisher: 'Test', type: 'manufacturer', edition: 'Rev A',
  scope: { productIds: ['fixture-product'] }, demonstration: false, filename: 'fixture.md',
  authorization: { basis: 'Test fixture only', storeAndIndex: true, useWithAi: true, display: 'excerpt', maxQuoteChars: 80 },
  content: '<!-- page: 25 -->\n## 2.1 Joining\nDeburr the fixture pipe before joining.\n', ...over,
});
const post = (body: unknown) => ({ method: 'POST', headers: auth, body: JSON.stringify(body) });

describe('operator-maintained shared rule search', () => {
  it('searches without a project and excludes demo and project documents before retrieval', async () => {
    let seen: Passage[] = [];
    const { app, sources } = setup(async (_, passages) => { seen = passages; return passages.map(p => p.section.key); });
    sources.import(manual());
    sources.import(manual({ id: 'demo', demonstration: true, content: '## 2.1 Joining\nDEMONSTRATION: invented joining fixture.' }));
    sources.import(manual({ id: 'private', scope: { productIds: ['fixture-product'], projectId: 'private' } }));
    sources.import(manual({ id: 'project', type: 'project_document', scope: { projectId: 'private' } }));
    const response = await app.request('/api/rules/search', post({ question: 'Joining instructions', packageId: 'nonexistent' }));
    expect(response.status).toBe(200);
    const answer = await response.json();
    expect(seen.map(p => p.doc.id)).toEqual(['shared-manual']);
    expect(answer).toMatchObject({ status: 'answered', followUps: [], exceptions: [], context: { projectId: null, facts: [] } });
    expect(answer.timings.compositionMs).toBe(0);
    expect(answer).not.toHaveProperty('readingGuide');
    expect(answer.sources[0]).toMatchObject({ docId: 'shared-manual', edition: 'Rev A', pageStart: 25 });
    const citation = await app.request(answer.sources[0].link, { headers: auth });
    expect(citation.status).toBe(200);
    expect((await citation.json()).sections[0].text).toContain('Deburr');
    const library = await (await app.request('/api/sources', { headers: auth })).json();
    expect(library.documents.map((d: { id: string }) => d.id)).toEqual(['shared-manual']);
  });
  it('returns no source when the requested rule is absent; rejects invalid questions', async () => {
    const { app, sources } = setup(async () => []);
    sources.import(manual());
    const result = await (await app.request('/api/rules/search', post({ question: 'An absent code clause' }))).json();
    expect(result).toMatchObject({ status: 'no_source', sources: [], explanation: [] });
    for (const question of ['', 123, 'a'.repeat(1001)]) expect((await app.request('/api/rules/search', post({ question }))).status).toBe(400);
    expect((await app.request('/api/rules/search', { method: 'POST', body: '{}' })).status).toBe(401);
  });
  it('does not add a different jurisdiction amendment through expansion', async () => {
    const { app, sources } = setup(async (_, passages) => passages.filter(p => p.doc.id === 'code').map(p => p.section.key));
    sources.import(manual({ id: 'code', type: 'published_code', scope: { standard: 'nfpa13' }, edition: '2025' }));
    sources.import(manual({ id: 'amendment', type: 'local_amendment', scope: { jurisdiction: 'elsewhere', standard: 'nfpa13', amendsEdition: '2019' }, content: '## 2.1 Joining\n[amends: 2.1]\nDifferent jurisdiction.' }));
    const result = await (await app.request('/api/rules/search', post({ question: 'Joining' }))).json();
    expect(result.sources.map((s: { docId: string }) => s.docId)).toEqual(['code']);
  });
  it('removes public source registration and prevents reference uploads', async () => {
    const { app, sources } = setup(async () => []);
    for (const path of ['/api/sources', '/api/sources/demo', '/api/uploads/old/index']) {
      expect((await app.request(path, post({ document: manual() }))).status).toBe(404);
    }
    expect((await app.request('/api/uploads/old/review', { ...post({}), method: 'PUT' })).status).toBe(404);
    const form = new FormData(); form.set('purpose', 'reference'); form.set('file', new File(['reference'], 'manual.txt'));
    const blocked = await app.request('/api/uploads', { method: 'POST', headers: { Authorization: auth.Authorization }, body: form });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).code).toBe('managed_library');
    expect(sources.documents()).toEqual([]);
  });
});
