import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JEV_MODEL } from '@sprink/workflow';
import { FieldService } from '../src/service.js';
import { createApp } from '../src/api.js';
import { SourceStore } from '../src/sources/store.js';
import { JevSourceSearch, type SearchRequest, type SourceSearch } from '../src/sources/semantic.js';

const clean: Array<() => void> = [];
afterEach(() => { vi.unstubAllGlobals(); clean.splice(0).forEach(f => f()); });
const token = 'pilot-resilience-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
function setup(search: SourceSearch = new JevSourceSearch(), populated = true) {
  const dir = mkdtempSync(join(tmpdir(), 'ask-resilience-')), service = new FieldService(dir), store = new SourceStore(service.store.db);
  clean.push(() => { service.store.close(); rmSync(dir, { recursive: true, force: true }); });
  if (populated) store.import({ id: 'fixture', title: 'Test reference', publisher: 'Test author', type: 'company_procedure', edition: 'A', scope: {}, demonstration: false, authorization: { basis: 'Owned test prose', storeAndIndex: true, useWithAi: true, display: 'full' }, filename: 'fixture.md', content: '## 1.1 Test passage\nRead the fixture label.' });
  return { app: createApp(service, { token, sources: store, sourceSearch: search }), store };
}
const post = (body: unknown) => ({ method: 'POST', headers, body: JSON.stringify(body) });
function reply(req: SearchRequest) {
  return { model: JEV_MODEL, answers: Object.fromEntries(Object.entries(req.questions).map(([id, q]) => [id, q.type === 'noul' ? { type: 'noul', noul: .99 } : { type: 'choice', choice: 'p0', confidence: .99, probabilities: Object.fromEntries(Object.keys(q.criteria).map((k, i) => [k, i ? 0 : 1])) }])) };
}
const goodFetch = async (_url: unknown, init: any) => Response.json(reply(JSON.parse(init.body)));

describe.each(['/api/rules/search', '/api/ask'])('%s pilot request boundary', path => {
  it.each([{}, null, [], { question: '' }, { question: ' \n\t ' }, { question: 123 }, { question: 'q'.repeat(1001) }])('rejects malformed questions without retrieval (%j)', async body => {
    const select = vi.fn(), { app } = setup({ select });
    const response = await app.request(path, post(body));
    expect(response.status).toBe(400); expect((await response.json()).code).toBe('invalid_question'); expect(select).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON and large bodies with stable codes', async () => {
    const { app } = setup();
    expect(await (await app.request(path, { method: 'POST', headers, body: '{' })).json()).toMatchObject({ code: 'invalid_json' });
    const large = await app.request(path, post({ question: 'ok', padding: 'x'.repeat(40_000) }));
    expect(large.status).toBe(413); expect((await large.json()).code).toBe('invalid_question');
  });
  it.each([undefined, 'Bearer wrong', `Bearer ${'x'.repeat(token.length)}`])('rejects missing and wrong authorization', async authorization => {
    const select = vi.fn(), { app } = setup({ select });
    const response = await app.request(path, { ...post({ question: 'Fixture' }), headers: authorization ? { Authorization: authorization } : {} });
    expect(response.status).toBe(401); expect((await response.json()).code).toBe('authentication_required'); expect(select).not.toHaveBeenCalled();
  });
  it('distinguishes an empty eligible library from absent support without calling a provider for an empty library', async () => {
    const select = vi.fn(async () => []), empty = setup({ select }, false);
    const response = await empty.app.request(path, post({ question: 'Fixture' }));
    expect(await response.json()).toMatchObject({ status: 'no_source', code: 'empty_library', explanation: [], sources: [] });
    expect(select).not.toHaveBeenCalled();
    const populated = setup({ select });
    expect(await (await populated.app.request(path, post({ question: 'Fixture' }))).json()).toMatchObject({ code: 'no_supporting_source', explanation: [], sources: [] });
    expect(select).toHaveBeenCalledTimes(1);
  });
});

it.each([{ measurements: {} }, { measurements: [null] }, { answers: [] }, { answers: { jurisdiction: {} } }, { attachments: 'invalid' }, { packageId: 1 }])('validates optional Ask context before lookups (%j)', async extra => {
  const { app } = setup();
  const response = await app.request('/api/ask', post({ question: 'Fixture', ...extra }));
  expect(response.status).toBe(400); expect((await response.json()).code).toBe('invalid_question');
});

it('keeps health minimal and public while private APIs still require authentication', async () => {
  const { app } = setup();
  const health = await app.request('/health');
  expect(health.status).toBe(200); expect(await health.json()).toEqual({ ok: true });
  expect((await app.request('/api/health')).status).toBe(401);
});

describe('JEV failure handling at the API', () => {
  it.each([400, 401, 403, 429, 500, 503])('redacts provider HTTP %s bodies and returns no answer', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('SECRET_PROVIDER_BODY_AND_API_KEY', { status })));
    const { app } = setup(new JevSourceSearch('test-key'));
    const response = await app.request('/api/rules/search', post({ question: 'Fixture' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: `source_search_http_${status}`, error: 'Source search is unavailable. Please try again.' });
  });
  it('distinguishes missing credentials, network errors, and timeouts without exposing error details', async () => {
    for (const [search, code, status] of [
      [new JevSourceSearch(), 'source_search_not_configured', 503],
      [new JevSourceSearch('test', async () => { throw new Error('secret /db/path stack trace'); }), 'source_search_transport_failed', 503],
      [new JevSourceSearch('test', async () => new Promise(() => {}), { timeoutMs: 40, batchTimeoutMs: 20 }), 'source_search_timeout', 504],
    ] as const) {
      const { app } = setup(search);
      const response = await app.request('/api/rules/search', post({ question: 'Fixture' }));
      expect(response.status).toBe(status);
      const body = await response.json(); expect(body.code).toBe(code); expect(body).not.toHaveProperty('sources'); expect(JSON.stringify(body)).not.toMatch(/secret|stack|\/db\/path/);
    }
  });
  it('times out a stalled HTTP response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start() {} }))));
    const { app } = setup(new JevSourceSearch('test', undefined, { timeoutMs: 40, batchTimeoutMs: 20 }));
    const response = await app.request('/api/rules/search', post({ question: 'Fixture' }));
    expect(response.status).toBe(504); expect((await response.json()).code).toBe('source_search_timeout');
  });
  it.each(['json', 'missing', 'wrong-model', 'negative', 'over-one', 'nan', 'infinite', 'string', 'sum', 'choice', 'missing-support', 'oversized'])('rejects %s provider responses', async kind => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init: any) => {
      const value = reply(JSON.parse(init.body));
      if (kind === 'json') return new Response('{');
      if (kind === 'missing') return Response.json({});
      if (kind === 'wrong-model') value.model = 'other';
      if (kind === 'missing-support') delete value.answers.support0;
      if (kind === 'choice') value.answers.relevant.choice = 'foreign-id';
      if (kind === 'sum') value.answers.relevant.probabilities.p0 = .4;
      if (kind === 'negative') value.answers.support0.noul = -.1;
      if (kind === 'over-one') value.answers.support0.noul = 1.1;
      if (kind === 'nan') value.answers.support0.noul = NaN;
      if (kind === 'infinite') value.answers.support0.noul = Infinity;
      if (kind === 'string') value.answers.support0.noul = '0.99';
      if (kind === 'oversized') return new Response('x'.repeat(1_048_577));
      return Response.json(value);
    }));
    const { app } = setup(new JevSourceSearch('test-key'));
    const response = await app.request('/api/rules/search', post({ question: 'Fixture' }));
    expect(response.status).toBe(503); expect((await response.json()).code).toBe('source_search_invalid_response');
  });
  it('does not treat similar vocabulary or a tied evidence verdict as support', async () => {
    for (const noul of [0, .49, .5]) {
      const { app } = setup(new JevSourceSearch(undefined, async req => { const value = reply(req); value.answers.support0.noul = noul; return value; }));
      const answer = await (await app.request('/api/rules/search', post({ question: 'Related fixture vocabulary but no answer' }))).json();
      expect(answer).toMatchObject({ code: 'no_supporting_source', sources: [], explanation: [] });
    }
  });
  it('returns a safe internal error for an unexpected backend fault', async () => {
    const { app } = setup({ select: async () => { throw new Error('OPENAI_API_KEY=secret /private/db'); } });
    const response = await app.request('/api/rules/search', post({ question: 'Fixture' }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Source library operation failed', code: 'internal_error' });
  });
});

it('isolates repeated and concurrent questions, with one JEV call per single-batch query and no SQLite writes', async () => {
  let active = 0, peak = 0;
  const fetcher = vi.fn(async (_url: unknown, init: any) => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return goodFetch(_url, init); });
  vi.stubGlobal('fetch', fetcher);
  const { app, store } = setup(new JevSourceSearch('test'));
  const changes = store.db.prepare('SELECT total_changes() AS n').get();
  const run = async (question: string) => {
    const response = await app.request('/api/rules/search', post({ question }));
    expect(response.status).toBe(200); const answer = await response.json();
    expect(answer.question).toBe(question); expect(answer.sources).toHaveLength(1); return answer.id;
  };
  const ids = await Promise.all(Array.from({ length: 8 }, (_, i) => run(`Fixture ${i}`)));
  ids.push(await run('Fixture 0'));
  expect(new Set(ids).size).toBe(9); expect(fetcher).toHaveBeenCalledTimes(9); expect(peak).toBeLessThanOrEqual(4);
  expect(store.db.prepare('SELECT total_changes() AS n').get()).toEqual(changes);
});

it('bounds admission and releases capacity after a timeout so retries recover', async () => {
  let blocked = true;
  const search = new JevSourceSearch('test', async req => blocked ? new Promise(() => {}) : reply(req), { timeoutMs: 40, batchTimeoutMs: 20 });
  const { app } = setup(search);
  const pending = Array.from({ length: 9 }, () => app.request('/api/rules/search', post({ question: 'Fixture' })));
  const results = await Promise.all(pending);
  expect(await results[8].json()).toMatchObject({ code: 'source_search_busy' });
  expect(results.slice(0, 8).every(r => r.status === 504)).toBe(true);
  blocked = false;
  expect((await app.request('/api/rules/search', post({ question: 'Fixture' }))).status).toBe(200);
});

it('returns source_unavailable for a missing original page without disclosing disk paths', async () => {
  const { app, store } = setup(); const doc = store.document('fixture')!;
  store.db.prepare('UPDATE source_documents SET data=?').run(JSON.stringify({ ...doc, pdf: { sha256: 'a'.repeat(64), pageCount: 2 } }));
  const response = await app.request('/api/sources/fixture/pages/2', { headers });
  expect(response.status).toBe(404); expect((await response.json()).code).toBe('source_unavailable');
});
