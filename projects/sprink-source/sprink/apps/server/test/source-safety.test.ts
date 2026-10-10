import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FieldService } from '../src/service.js';
import { createApp } from '../src/api.js';
import { SourceStore } from '../src/sources/store.js';
import { ask, searchRules } from '../src/sources/ask.js';
import { expand } from '../src/sources/retrieve.js';
import { excerptSections } from '../src/sources/pdf-excerpts.js';
import { loadDemoSources } from '../src/sources/demo.js';
import type { SourceDocumentInput } from '../src/sources/types.js';
import type { SourceSearch } from '../src/sources/semantic.js';

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach(f => f()));
const token = 'pilot-safety-test-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const post = (body: unknown) => ({ method: 'POST', headers, body: JSON.stringify(body) });
const all: SourceSearch = { select: async (_, rows) => rows.map(p => p.section.key) };
const fixture = (over: Partial<SourceDocumentInput> = {}): SourceDocumentInput => ({
  id: 'fixture', title: 'Test-only reference', publisher: 'Test author', type: 'company_procedure', edition: 'A', scope: {}, demonstration: false,
  authorization: { basis: 'Owned synthetic test prose, not code provisions', storeAndIndex: true, useWithAi: true, display: 'full' },
  filename: 'fixture.md', content: '<!-- page: 2 -->\n## 1.1 Test procedure\nRead the fixture label.', ...over,
});
function memory() { const db = new Database(':memory:'); cleanup.push(() => db.close()); return new SourceStore(db); }
function http(search: SourceSearch = all) {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-safety-'));
  const service = new FieldService(dir), sources = new SourceStore(service.store.db);
  cleanup.push(() => { service.store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { sources, app: createApp(service, { token, sources, sourceSearch: search }) };
}

describe('evidence integrity', () => {
  it('expands reference chains and their exceptions once even with cycles', async () => {
    const store = memory();
    store.import(fixture({ content: '<!-- page: 2 -->\n## 1.1 First\nSee Section 2.1.\n## 2.1 Second\nSee Section 3.1.\n## 3.1 Third\nSee Section 1.1.\n\nException: Read the fixture note.\n\nNote 1: Retain this note.' }));
    const answer = await searchRules(store, 'First', { select: async () => ['fixture#0'] });
    expect(answer.sources.map(s => s.sectionId)).toEqual(['1.1', '2.1', '3.1', '3.1 Exception', '3.1 Note 1']);
    expect(answer.exceptions[0]).toMatchObject({ parentSectionId: '3.1', status: 'unknown' });
    expect(answer.sources.every(s => s.docId === 'fixture' && s.edition === 'A' && s.pageStart === 2)).toBe(true);
    for (const claim of answer.explanation) {
      expect(claim.citations).toHaveLength(1);
      const section = store.section(claim.citations[0])!;
      expect(claim.text).toBe(section.text);
    }
  });
  it('retains a PDF excerpt parent, its references and exceptions', () => {
    const store = memory();
    const doc = store.import(fixture({ content: '<!-- page: 2 -->\n## 1.1 First\nRead the fixture label. See Section 2.1.\n\nException: Check its fixture note.\n## 2.1 Second\nRelated fixture context.' }));
    const sections = store.sections(doc.id), source = sections[0];
    const excerpt = { id: 'test', sectionKey: source.key, page: 2, label: 'Short excerpt', text: 'Read the fixture label.', box: { x: 0, y: 0, w: 1, h: 1 }, contextBox: { x: 0, y: 0, w: 1, h: 1 }, pageWidth: 100, pageHeight: 100 };
    const section = excerptSections({ ...doc, pdf: { sha256: 'a'.repeat(64), pageCount: 2, excerpts: [excerpt] } }, sections)[0];
    const result = expand(store, [{ doc, section, role: 'main', notes: [], score: 0 }], [doc]);
    expect(result.map(r => r.section.key)).toEqual(expect.arrayContaining([section.key, ...sections.map(s => s.key)]));
  });
  it('keeps amendments within the same standard, edition and demonstration provenance, including their exceptions', () => {
    const store = memory();
    const code = store.import(fixture({ id: 'code', type: 'published_code', scope: { standard: 'fixture-standard' }, edition: 'A' }));
    const amend = fixture({ id: 'amend', type: 'local_amendment', scope: { standard: 'fixture-standard', amendsEdition: 'A', jurisdiction: 'test-city' }, content: '## 7.1 Change\nSection 1.1 is amended for this fixture.\n\nException: Keep the test note.' });
    store.import(amend);
    store.import({ ...amend, id: 'other-standard', scope: { ...amend.scope, standard: 'other' } });
    store.import({ ...amend, id: 'other-edition', scope: { ...amend.scope, amendsEdition: 'B' } });
    store.import({ ...amend, id: 'demonstration', demonstration: true });
    const result = expand(store, [{ doc: code, section: store.sections(code.id)[0], role: 'main', notes: [], score: 0 }], store.documents());
    expect([...new Set(result.map(r => r.doc.id))]).toEqual(['code', 'amend']);
    expect(result.find(r => r.role === 'exception')?.via).toBe('7.1');
  });
  it('keeps conflicting editions visible without choosing the governing source', async () => {
    const store = memory();
    for (const edition of ['A', 'B']) store.import(fixture({ id: `edition-${edition}`, edition }), { author: 'Test reviewer', notes: [{ sectionId: '1.1', text: 'Fixture interpretation', topic: 'fixture-choice', position: edition }] });
    const result = await searchRules(store, 'Fixture', all);
    expect(result.sources.map(s => s.edition)).toEqual(['A', 'B']);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].items.map(i => i.position)).toEqual(['A', 'B']);
    expect(result.summary).toContain('disagree');
    expect(result.context.edition.status).toBe('unknown');
    expect(result.context.jurisdiction).toBeNull();
  });
  it('returns local amendment scope explicitly without determining that it governs', async () => {
    const store = memory();
    const scope = { standard: 'fixture-standard', amendsEdition: 'A', jurisdiction: 'test-city' };
    store.import(fixture({ type: 'local_amendment', scope }));
    const answer = await searchRules(store, 'Fixture', all);
    expect(answer.sources[0]).toMatchObject({ type: 'local_amendment', scope });
    expect(answer.context.jurisdiction).toBeNull();
    expect(answer.context.edition.status).toBe('unknown');
  });
  it('marks a response containing only excluded demonstration references', async () => {
    const store = memory();
    store.import(fixture({ type: 'published_code', scope: { standard: 'nfpa13' }, demonstration: true }));
    const answer = await ask(store, { question: 'Fixture' }, null, [], all);
    expect(answer).toMatchObject({ demonstration: true, sources: [], excluded: [{ demonstration: true }] });
    expect(answer.summary).toContain('Demonstration content');
  });
  it('fails closed when source authorization changes while retrieval is pending', async () => {
    const store = memory(), doc = store.import(fixture());
    await expect(searchRules(store, 'Fixture', { select: async () => {
      store.db.prepare('UPDATE source_documents SET data=? WHERE id=?').run(JSON.stringify({ ...doc, authorization: { ...doc.authorization, display: 'reference_only' } }), doc.id);
      return ['fixture#0'];
    } })).rejects.toMatchObject({ code: 'source_unavailable' });
  });
});

describe('display authorization and demonstration isolation', () => {
  it.each(['excerpt', 'reference_only'] as const)('does not leak interpretation text, conditions or conflict positions for %s documents', async display => {
    const { sources, app } = http();
    const secret = 'PRIVATE_FIXTURE_WORDING_THAT_MUST_NOT_LEAK';
    for (const id of ['first', 'second']) sources.import(fixture({ id, authorization: { ...fixture().authorization, display, maxQuoteChars: 5 }, content: `## 1.1 Test\n${secret}\n\nException: ${secret}` }), { author: 'Test', notes: [{ sectionId: '1.1', text: secret, topic: 'choice', position: id + secret }, { sectionId: '1.1 Exception', text: secret, conditions: [{ id: 'condition', question: secret, input: { name: 'obstructionWidth', unit: 'mm' }, appliesWhen: { op: '<', value: 123 } }] }] });
    for (const path of ['/api/rules/search', '/api/ask']) {
      const response = await app.request(path, post({ question: 'Fixture' }));
      expect(response.status).toBe(200);
      const answer = await response.json();
      expect(JSON.stringify(answer)).not.toContain(secret);
      expect(answer.sources.every((s: any) => s.notes.length === 0 && s.page === null && s.excerpt === undefined)).toBe(true);
      expect(answer.exceptions.every((e: any) => e.checks.length === 0)).toBe(true);
      for (const citation of answer.sources) {
        const view = await app.request(citation.link, { headers });
        expect(await view.text()).not.toContain(secret);
      }
    }
    expect((await app.request('/api/sources/first/file', { headers })).status).toBe(403);
  });
  it('preserves demo status for all bundled types through Ask, excluded sources, inspection and original downloads', async () => {
    const { sources, app } = http(); loadDemoSources(sources, 'test-project');
    let groups: boolean[][] = [];
    const answer = await ask(sources, { question: 'Fixture', answers: { nfpa13Edition: '2025', jurisdiction: 'san_francisco' } }, null, [], { select: async (_, rows) => { groups.push(rows.map(r => r.doc.demonstration)); return rows.map(r => r.section.key); } });
    expect(answer.demonstration).toBe(true);
    expect(answer.summary).toContain('invented test data');
    expect(answer.sources.every(s => s.demonstration)).toBe(true);
    expect(answer.explanation.every(c => c.demonstration)).toBe(true);
    expect(answer.excluded.every(d => d.demonstration)).toBe(true);
    expect(groups.every(g => new Set(g).size === 1)).toBe(true);
    for (const doc of sources.documents()) {
      const detail = await (await app.request(`/api/sources/${doc.id}`, { headers })).json();
      expect(detail.document.demonstration).toBe(true);
      const file = await app.request(`/api/sources/${doc.id}/file`, { headers });
      expect(file.headers.get('X-Sprink-Demonstration')).toBe('true');
      expect(await file.text()).toContain('DEMONSTRATION');
    }
    expect(await (await app.request('/api/sources', { headers })).json()).toEqual({ documents: [] });
    expect(await searchRules(sources, 'Fixture', all)).toMatchObject({ code: 'empty_library', sources: [], demonstration: false });
  });
  it('rejects demo relabeling, same-content metadata changes, and malformed metadata', () => {
    const store = memory();
    const doc = fixture({ demonstration: true }); store.import(doc);
    expect(() => store.import({ ...doc, demonstration: false })).toThrow(/Demonstration/);
    expect(() => store.import({ ...doc, id: 'new-id', demonstration: false })).toThrow(/Demonstration/);
    expect(() => store.import({ ...fixture(), id: 'demo-code' })).toThrow(/Demonstration/);
    expect(() => store.import({ ...doc, authorization: { ...doc.authorization, display: 'reference_only' } })).toThrow(/metadata differs/);
    expect(store.import(doc).demonstration).toBe(true);
    expect(store.import(fixture({ id: 'ordinary-prose', content: '## 1.1 Training\nThis procedure mentions a demonstration in ordinary prose.' })).demonstration).toBe(false);
    for (const scope of [null, [], { productIds: [null] }]) expect(() => store.import(fixture({ id: 'bad', type: 'manufacturer', scope: scope as any }))).toThrow();
  });
  it.each(['document-id', 'section-doc', 'section-count', 'invalid-json'])('fails closed on stored %s inconsistency with no internal detail', async kind => {
    const { sources, app } = http(); const doc = sources.import(fixture());
    if (kind === 'document-id') sources.db.prepare('UPDATE source_documents SET data=?').run(JSON.stringify({ ...doc, id: 'wrong' }));
    if (kind === 'section-doc') sources.db.prepare('UPDATE source_sections SET data=?').run(JSON.stringify({ ...sources.sections(doc.id)[0], docId: 'wrong' }));
    if (kind === 'section-count') sources.db.prepare('DELETE FROM source_sections').run();
    if (kind === 'invalid-json') sources.db.prepare('UPDATE source_documents SET data=?').run('{');
    const response = await app.request('/api/rules/search', post({ question: 'Fixture' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'source_unavailable', error: 'Stored source data is incomplete or inconsistent. Ask the library operator to check the source.' });
  });
});
