/** Local API benchmark with synthetic non-code prose and a scripted JEV transport. No credentials or network. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FieldService } from '../apps/server/src/service.js';
import { SourceStore } from '../apps/server/src/sources/store.js';
import { JevSourceSearch } from '../apps/server/src/sources/semantic.js';
import { createApp } from '../apps/server/src/api.js';
import { JEV_MODEL } from '../packages/workflow/src/index.js';

for (const count of [1, 50, 600]) {
  const dir = mkdtempSync(join(tmpdir(), 'ask-benchmark-')), field = new FieldService(dir);
  try {
    const sources = new SourceStore(field.store.db);
    sources.import({ id: 'benchmark', title: 'Synthetic benchmark prose', publisher: 'Test author', type: 'company_procedure', edition: 'test', scope: {}, demonstration: false,
      authorization: { basis: 'Owned non-code benchmark prose', storeAndIndex: true, useWithAi: true, display: 'full' }, filename: 'test.md',
      content: Array.from({ length: count }, (_, i) => `## ${i + 1}.1 Test paragraph\nRead the test label for fixture ${i + 1}.`).join('\n') });
    let calls = 0, maxBytes = 0;
    const search = new JevSourceSearch(undefined, async req => {
      calls++; maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(req)));
      return { model: JEV_MODEL, answers: Object.fromEntries(Object.entries(req.questions).map(([id, q]) => [id, q.type === 'noul'
        ? { type: 'noul', noul: .99 }
        : { type: 'choice', choice: 'p0', confidence: 1, probabilities: Object.fromEntries(Object.keys(q.criteria).map((k, i) => [k, i === 0 ? 1 : 0])) }])) };
    });
    const app = createApp(field, { token: 'benchmark-local-token', sources, sourceSearch: search });
    const samples: number[] = []; let responseBytes = 0;
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      const response = await app.request('/api/rules/search', { method: 'POST', headers: { Authorization: 'Bearer benchmark-local-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Read the fixture label' }) });
      const body = await response.text(); if (response.status !== 200) throw new Error(body);
      samples.push(performance.now() - started); responseBytes = Buffer.byteLength(body);
    }
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({ passages: count, runs: 5, p50Ms: +samples[2].toFixed(1), maxMs: +samples[4].toFixed(1), callsPerRequest: calls / 5, maxRequestBytes: maxBytes, responseBytes, transport: 'scripted; no network latency' }));
  } finally { field.store.close(); rmSync(dir, { recursive: true, force: true }); }
}
