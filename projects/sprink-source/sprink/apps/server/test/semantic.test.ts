import { describe, expect, it } from 'vitest';
import { JevSourceSearch, fits, type Passage, type SearchRequest } from '../src/sources/semantic.js';
import { JEV_MODEL } from '@sprink/workflow';

function reply(req: SearchRequest, exists = 0.99) {
  return { model: JEV_MODEL, answers: Object.fromEntries(Object.entries(req.questions).map(([id, q]) => {
    const ids = Object.keys(q.criteria);
    return [id, q.type === 'noul' ? { type: 'noul', noul: exists } : { type: 'choice', choice: ids[0], confidence: 1, probabilities: Object.fromEntries(ids.map((id, i) => [id, i === 0 ? 1 : 0])) }];
  })) };
}
const passage = (i: number, text = '原文に記載された回答。'): Passage => ({
  doc: { id: 'doc', title: 'Registered source', edition: '2025' },
  section: { key: `doc#${i}`, sectionId: String(i), heading: 'Clause', text, table: null },
} as Passage);

describe('JEV source selection', () => {
  it('sends original clauses and identifiers; selects multiple supporting clauses without a keyword prefilter', async () => {
    const rows = [passage(1), passage(2), passage(3)];
    const search = new JevSourceSearch(undefined, async req => {
      expect((req.state as any).passages.map((p: any) => p.text)).toEqual(rows.map(p => p.section.text));
      const result = reply(req);
      result.answers.support2 = { type: 'noul', noul: 0.1 } as any;
      return result;
    });
    expect(await search.select('言い換えた質問', rows)).toEqual(['doc#1', 'doc#2']);
  });
  it('never uses the top Choice when the answer does not exist', async () => {
    const search = new JevSourceSearch(undefined, async req => reply(req, 0.1));
    expect(await search.select('Absent answer', [passage(1)])).toEqual([]);
  });
  it('covers every clause in bounded concurrent batches within both input budgets', async () => {
    const seen: string[] = []; let active = 0, peak = 0, calls = 0;
    const search = new JevSourceSearch(undefined, async req => {
      active++; peak = Math.max(peak, active); calls++;
      expect(fits(req)).toBe(true);
      expect(Object.keys(req.questions.relevant.criteria).length).toBeLessThanOrEqual(255);
      seen.push(...(req.state as any).passages.map((p: any) => p.key));
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      return reply(req);
    });
    const rows = Array.from({ length: 600 }, (_, i) => passage(i, '日本語の長い条文。'.repeat(50)));
    expect(await search.select('質問', rows)).toHaveLength(600);
    expect(new Set(seen).size).toBe(600); expect(calls).toBeGreaterThan(3); expect(peak).toBeLessThanOrEqual(4);
  });
  it('rejects an oversized clause without truncating it or sending any batch', async () => {
    let called = false;
    const search = new JevSourceSearch(undefined, async req => { called = true; return reply(req); });
    await expect(search.select('q', [passage(1), passage(2, 'あ'.repeat(32_000))])).rejects.toMatchObject({ code: 'source_section_too_large' });
    expect(called).toBe(false);
  });
  it('fails closed on malformed, foreign-id, or failed responses with no fallback', async () => {
    for (const transport of [async () => ({ model: 'other', answers: {} }), async (req: SearchRequest) => { const r = reply(req); (r.answers.relevant as any).choice = 'unknown'; return r; }, async () => { throw new Error('offline'); }]) {
      await expect(new JevSourceSearch(undefined, transport).select('q', [passage(1)])).rejects.toThrow();
    }
    await expect(new JevSourceSearch().select('q', [passage(1)])).rejects.toMatchObject({ code: 'source_search_not_configured' });
  });
  it('returns no sources for an empty library without a model call', async () => {
    const search = new JevSourceSearch(undefined, async req => reply(req));
    expect(await search.select('q', [])).toEqual([]);
  });
});

it('preserves demonstration provenance in the provider request', async () => {
  const row = passage(1); row.doc.demonstration = true;
  await new JevSourceSearch(undefined, async req => {
    expect((req.state as any).passages[0].demonstration).toBe(true);
    return reply(req);
  }).select('Fixture', [row]);
});

it('discards successful batches when any sibling fails', async () => {
  let calls = 0;
  const search = new JevSourceSearch(undefined, async req => {
    if (++calls === 2) throw new Error('private transport detail');
    return reply(req);
  });
  await expect(search.select('Fixture', Array.from({ length: 8 }, (_, i) => passage(i, 'Test prose. '.repeat(1700))))).rejects.toMatchObject({ code: 'source_search_transport_failed' });
});

it('bounds the whole search even if every individual batch stays within its deadline', async () => {
  const search = new JevSourceSearch(undefined, async req => { await new Promise(resolve => setTimeout(resolve, 20)); return reply(req); }, { timeoutMs: 25, batchTimeoutMs: 100 });
  await expect(search.select('Fixture', Array.from({ length: 8 }, (_, i) => passage(i, 'Test prose. '.repeat(1700))))).rejects.toMatchObject({ code: 'source_search_timeout' });
});

it('rejects excessive library size before making any provider call', async () => {
  let calls = 0;
  const search = new JevSourceSearch(undefined, async req => { calls++; return reply(req); });
  await expect(search.select('Fixture', Array.from({ length: 8193 }, (_, i) => passage(i)))).rejects.toMatchObject({ code: 'source_search_capacity' });
  expect(calls).toBe(0);
});
