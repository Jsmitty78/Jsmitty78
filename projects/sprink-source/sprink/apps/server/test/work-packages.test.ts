import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { CreateWorkPackage, PackageResult } from '@sprink/core';
import { FieldService } from '../src/service.js';
import { createApp } from '../src/api.js';
import { WorkPackageStore } from '../src/work-packages/store.js';
import { WorkPackageService, type PackageRunContext, type WorkPackageRunner } from '../src/work-packages/service.js';

import { shapePatch, shapeValues } from '../../web/src/workbench/site/shapes.js';

const token = 'work-package-test-token';
const headers = { Authorization: `Bearer ${token}` };
const example = (scenario: number, kind = 'create') => JSON.parse(readFileSync(new URL(`../../../docs/contracts/examples/scenario-${scenario}.${kind}.json`, import.meta.url), 'utf8'));
const input = (scenario = 2): CreateWorkPackage => example(scenario);
const json = (body: unknown, method = 'POST') => ({ method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const resources: Array<{ field: FieldService; packages: WorkPackageService; dir: string }> = [];

class ControlledRunner implements WorkPackageRunner {
  contexts: PackageRunContext[] = [];
  completions: Array<(value: { status: 'completed' | 'waiting_input' | 'blocked'; stopReason: string }) => void> = [];
  execute(context: PackageRunContext) {
    this.contexts.push(context);
    return new Promise<{ status: 'completed' | 'waiting_input' | 'blocked'; stopReason: string }>(resolve => this.completions.push(resolve));
  }
  finish(index = 0, status: 'completed' | 'waiting_input' | 'blocked' = 'completed') {
    this.completions[index]({ status, stopReason: `synthetic_${status}` });
  }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(runner?: WorkPackageRunner, configVersion?: string, dir = mkdtempSync(join(tmpdir(), 'work-package-test-'))) {
  const field = new FieldService(dir), packages = new WorkPackageService(new WorkPackageStore(field.store.db), configVersion, runner);
  resources.push({ field, packages, dir });
  return { field, packages, dir, app: createApp(field, { token, workPackages: packages }) };
}
afterEach(() => {
  for (const r of resources.splice(0)) {
    if (r.field.store.db.open) { r.packages.close(); r.field.store.close(); }
    rmSync(r.dir, { recursive: true, force: true });
  }
});
function result(ctx: PackageRunContext, planId = ctx.snapshot.baselinePlan!.id): PackageResult {
  return { ...example(2, 'outputs').results[0], id: `result-${ctx.run.id}`, inputRevision: ctx.run.inputRevision, configVersion: ctx.run.configVersion, planId };
}
function publishCandidates(ctx: PackageRunContext) {
  ctx.publish({ candidates: { ...example(3, 'outputs').candidates, id: `set-${ctx.run.id}`, inputRevision: ctx.run.inputRevision, configVersion: ctx.run.configVersion } });
}
async function start(s: ReturnType<typeof setup>, runner: ControlledRunner, scenario = 2) {
  const snapshot = s.packages.create(input(scenario));
  const response = await s.app.request(`/api/work-packages/${snapshot.id}/runs`, json({ expectedRevision: 1, goal: snapshot.intent }));
  expect(response.status).toBe(202);
  await tick();
  return { snapshot, context: runner.contexts.at(-1)!, path: `/api/work-packages/${snapshot.id}` };
}

describe('work-package HTTP contracts and input ownership', () => {
  it.each([2, 3])('starts scenario %s independently and matches the published JSON response example', async scenario => {
    const s = setup();
    const response = await s.app.request('/api/work-packages', json(example(scenario)));
    expect(response.status).toBe(201);
    const actual = await response.json() as Record<string, unknown>;
    const expected = example(scenario, 'response');
    expect({ ...actual, id: expected.id, createdAt: expected.createdAt, updatedAt: expected.updatedAt }).toEqual(expected);
    expect((await s.app.request(`/api/work-packages/${actual.id}`, { headers })).status).toBe(200);
    const listed = await s.app.request('/api/work-packages?projectId=example-project', { headers });
    expect(await listed.json()).toHaveLength(1);
    expect(await (await s.app.request('/api/work-packages?projectId=other-project', { headers })).json()).toEqual([]);
  });
  it('protects every new route with the existing token and leaves legacy APIs available', async () => {
    const s = setup();
    for (const path of ['', '/x', '/x/assets/a', '/x/candidates', '/x/outputs', '/x/requests', '/x/artifacts', '/x/artifacts/a/download', '/x/runs/latest']) {
      expect((await s.app.request(`/api/work-packages${path}`)).status).toBe(401);
    }
    expect((await s.app.request('/api/work-packages', { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await s.app.request('/api/health', { headers })).status).toBe(200);
    expect((await s.app.request('/api/tasks', json({ title: 'Legacy unchanged' }))).status).toBe(201);
    expect(s.packages.list()).toEqual([]);
  });
  it('has no production fixture runner and does not mark missing outputs available', async () => {
    const field = new FieldService(mkdtempSync(join(tmpdir(), 'work-package-default-')));
    const app = createApp(field, { token });
    try {
      const created = await (await app.request('/api/work-packages', json(input()))).json() as { id: string };
      const response = await app.request(`/api/work-packages/${created.id}/runs`, json({ expectedRevision: 1, goal: 'prepare_from_drawing' }));
      expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: 'runner_unavailable' });
      const view = await (await app.request(`/api/work-packages/${created.id}`, { headers })).json();
      expect(view).toMatchObject({ run: null, freshness: { candidates: false, results: [], artifacts: [] } });
    } finally { field.store.close(); rmSync(field.dataDir, { recursive: true, force: true }); }
  });
  it('rejects concurrent stale edits, client result injection, invalid graph references and unknowns without reasons', async () => {
    const s = setup(), p = s.packages.create(input()), path = `/api/work-packages/${p.id}`;
    const edits = await Promise.all(['one', 'two'].map(title => s.app.request(path, json({ expectedRevision: 1, patch: { title } }, 'PATCH'))));
    expect(edits.map(r => r.status).sort()).toEqual([200, 409]);
    expect(s.packages.get(p.id).inputRevision).toBe(2);
    expect((await s.app.request(path, json({ expectedRevision: 2, patch: { outputs: {} } }, 'PATCH'))).status).toBe(400);
    for (const bad of [
      { ...input(), detailing: [{ ...input().detailing![0], unknownReason: null }] },
      { ...input(), detailing: [{ ...input().detailing![0], confirmation: 'confirmed' }] },
      { ...input(), scope: { ...input().scope!, coordinateFrame: { ...input().scope!.coordinateFrame, id: 'wrong' } } },
      { ...input(), baselinePlan: { ...input().baselinePlan!, connections: [{ id: 'c', from: { entityId: 'missing', portId: 'start' }, to: { entityId: 'pipe-1', portId: 'end' } }] } },
    ]) expect((await s.app.request('/api/work-packages', json(bad))).status).toBe(400);
    expect((await s.app.request(path, { ...json(null, 'PATCH'), body: '{' })).status).toBe(400);
  });
  it('copies source assets atomically and rejects stale revisions without leaving a package', async () => {
    const s = setup(), p = s.packages.create(input());
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
    const asset = await s.packages.upload(p.id, image, 'image/png', 'drawing.png');
    const sourceDrawing = { assetId: asset.id, drawingId: 'drawing-1', revision: 'A', page: 1, approval: 'approved', scale: { value: null, unit: 'mm/pixel', reason: 'Explicit dimensions used', basis: 'unknown' } };
    const source = s.packages.edit(p.id, { expectedRevision: 1, patch: { sourceDrawing } });
    const path = `/api/work-packages/${p.id}/site-change`;
    expect((await s.app.request(path, { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await s.app.request(path, json({ expectedRevision: 1, title: 'Stale copy' }))).status).toBe(409);
    expect(s.packages.list()).toHaveLength(1);
    const response = await s.app.request(path, json({ expectedRevision: source.inputRevision, title: 'Site change' }));
    expect(response.status).toBe(201);
    const copied = await response.json() as typeof source;
    expect(copied.sourceDrawing!.assetId).not.toBe(asset.id);
    expect(copied.baselinePlan).toEqual(source.baselinePlan);
    expect(s.packages.sourceAsset(copied.id, copied.sourceDrawing!.assetId).bytes).toEqual(image);
    const before = s.field.store.db.prepare('SELECT count(*) AS n FROM work_package_assets').get();
    const fail = vi.spyOn(s.packages, 'edit').mockImplementationOnce(() => { throw new Error('simulated final edit failure'); });
    expect(() => s.packages.copyForSiteChange(p.id, { expectedRevision: source.inputRevision, title: 'Failed copy' })).toThrow('simulated final edit failure');
    fail.mockRestore();
    expect(s.packages.list()).toHaveLength(2);
    expect(s.field.store.db.prepare('SELECT count(*) AS n FROM work_package_assets').get()).toEqual(before);
    expect(s.packages.get(p.id)).toEqual(source);
  });
  it('uploads real decoded PNG bytes, freezes confirmed sources and blocks same-project and cross-project asset reuse', async () => {
    const s = setup(), p = s.packages.create(input());
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
    const form = new FormData(); form.set('file', new File([new Uint8Array(image)], 'drawing.png', { type: 'image/png' }));
    const response = await s.app.request(`/api/work-packages/${p.id}/assets`, { method: 'POST', headers, body: form });
    expect(response.status).toBe(201);
    const asset = await response.json() as { id: string };
    const sourceDrawing = { assetId: asset.id, drawingId: 'drawing-1', revision: 'A', page: 1, approval: 'approved', scale: { value: null, unit: 'mm/pixel', reason: 'Explicit dimensions used', basis: 'unknown' } };
    const updated = s.packages.edit(p.id, { expectedRevision: 1, patch: { sourceDrawing, baselinePlan: { ...p.baselinePlan, confirmation: 'confirmed' } } });
    expect(updated.inputRevision).toBe(2);
    expect(() => s.packages.edit(p.id, { expectedRevision: 2, patch: { baselinePlan: input().baselinePlan } })).toThrow('confirmed_baseline');
    for (const projectId of ['example-project', 'other-project']) {
      const other = s.packages.create({ ...input(), projectId });
      expect(() => s.packages.edit(other.id, { expectedRevision: 1, patch: { sourceDrawing } })).toThrow('asset_not_found');
      const wrongFact = { ...input().detailing![0], source: { description: 'Foreign evidence', assetId: asset.id, page: null } };
      expect(() => s.packages.edit(other.id, { expectedRevision: 1, patch: { detailing: [wrongFact] } })).toThrow('asset_not_found');
      expect((await s.app.request(`/api/work-packages/${other.id}/assets/${asset.id}`, { headers })).status).toBe(404);
    }
    const downloaded = await s.app.request(`/api/work-packages/${p.id}/assets/${asset.id}`, { headers });
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(image);
    expect(downloaded.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(s.packages.upload(p.id, Buffer.from('<svg/>'), 'image/svg+xml', 'evil.svg')).rejects.toThrow('unsupported_media_type');
    await expect(s.packages.upload(p.id, image, 'image/jpeg', 'fake.jpg')).rejects.toThrow('invalid_image');
    await expect(s.packages.upload(p.id, Buffer.alloc(20 * 1024 * 1024 + 1), 'application/pdf', 'big.pdf')).rejects.toThrow('asset_size_limit');
  });
});

describe('revision-bound outputs and explicit human decisions', () => {
  it('persists shape edits and unknown height through the API and invalidates previous calculations', async () => {
    const runner = new ControlledRunner(), s = setup(runner), { snapshot, context, path } = await start(s, runner, 3);
    publishCandidates(context); context.publish({ results: [result(context)] });
    runner.finish(); await tick();
    const before = s.packages.get(snapshot.id), draft = shapeValues(before);
    draft.duct = [4200, -350, null, 5900, 450, null];
    const response = await s.app.request(path, json({ expectedRevision: before.inputRevision, patch: shapePatch(before, draft) }, 'PATCH'));
    expect(response.status).toBe(200);
    const saved = s.packages.get(snapshot.id);
    expect(shapeValues(saved).duct).toEqual(draft.duct);
    expect(saved.inputRevision).toBe(before.inputRevision + 1);
    expect(saved.freshness.candidates).toBe(false);
    expect(saved.freshness.results.every(r => !r.current)).toBe(true);
    expect(saved.baselinePlan).toEqual(before.baselinePlan);
  });
  it('saves partial results without changing inputs and makes a user-selected candidate stale without mutating source or site facts', async () => {
    const runner = new ControlledRunner(), s = setup(runner), { snapshot, context, path } = await start(s, runner, 3);
    const baseline = structuredClone(snapshot.baselinePlan), facts = structuredClone(snapshot.siteFacts);
    publishCandidates(context); context.publish({ results: [result(context)] }); context.progress('Synthetic comparison saved');
    const before = s.packages.get(snapshot.id);
    expect(before.inputRevision).toBe(1); expect(before.selectedPlan).toBeNull(); expect(before.freshness.candidates).toBe(true);
    expect(before.outputs.results[0].cuts[0].length).toEqual({ value: null, unit: 'mm', reason: 'Makeup unknown', basis: 'unknown' });
    expect(before.run?.progress).toBe('Synthetic comparison saved');
    runner.finish(0, 'waiting_input'); await tick();
    const response = await s.app.request(`${path}/selection`, json({ expectedRevision: 1, planId: 'candidate-1' }));
    expect(response.status).toBe(200);
    const selected = s.packages.get(snapshot.id);
    expect(selected.selectedPlan?.id).toBe('candidate-1'); expect(selected.selectedPlan?.confirmation).toBe('proposed');
    expect(selected.baselinePlan).toEqual(baseline); expect(selected.siteFacts).toEqual(facts);
    expect(selected.inputRevision).toBe(2); expect(selected.freshness.candidates).toBe(false); expect(selected.freshness.results[0].current).toBe(false);
    expect((await s.app.request(`${path}/selection`, json({ expectedRevision: 2, planId: 'candidate-1' }))).status).toBe(409);
  });
  it('rejects wrong output versions, candidate confirmation, foreign subjects and mutated output IDs', async () => {
    const runner = new ControlledRunner(), s = setup(runner), { context } = await start(s, runner, 3);
    const output = result(context);
    expect(() => context.publish({ results: [{ ...output, inputRevision: 10 }] })).toThrow('output_version_mismatch');
    expect(() => context.publish({ results: [{ ...output, configVersion: 'wrong' }] })).toThrow('output_version_mismatch');
    expect(() => context.publish({ results: [{ ...output, materials: [{ ...output.materials[0], quantity: { value: Infinity, unit: 'piece', reason: null, basis: 'proposed_inputs' } }] }] })).toThrow('invalid_input');
    expect(() => context.publish({ results: [{ ...output, planId: 'other' }] })).toThrow('result_plan_not_found');
    expect(() => context.publish({ results: [{ ...output, gaps: [{ id: 'g', subjectIds: ['foreign'], reason: 'wrong' }] }] })).toThrow('result_unknown_subject');
    publishCandidates(context);
    const candidates = s.packages.get(context.snapshot.id).outputs.candidates!;
    candidates.candidates[0].plan.confirmation = 'confirmed';
    expect(() => context.publish({ candidates })).toThrow('candidate_cannot_confirm');
    expect(() => context.publish({ results: [{ ...output, id: 'bad-assembly', assembly: output.assembly.map(step => ({ ...step, pieceIds: ['missing-piece'] })) }] })).toThrow('assembly_unknown_reference');
    context.publish({ results: [output] });
    expect(() => context.publish({ results: [{ ...output, materials: output.materials.map(m => ({ ...m, description: 'changed description' })) }] })).toThrow('output_id_reused');
    expect(s.packages.get(context.snapshot.id).outputs.results[0]).toEqual(output);
  });
  it('persists a question and unavailable answer without inventing or confirming a value', async () => {
    const runner = new ControlledRunner(), s = setup(runner), { snapshot, context, path } = await start(s, runner);
    context.publish({ requests: [{ id: 'request-1', inputRevision: 1, configVersion: context.run.configVersion, subjectIds: ['pipe-1'], question: 'What is the confirmed thread makeup?' }] });
    runner.finish(0, 'waiting_input'); await tick();
    const response = await s.app.request(`${path}/answers`, json({ expectedRevision: 1, requestId: 'request-1', value: null, unavailableReason: 'No supported product sheet' }));
    expect(response.status).toBe(200);
    const saved = s.packages.get(snapshot.id);
    expect(saved.inputRevision).toBe(2); expect(saved.detailing).toEqual(snapshot.detailing);
    expect(saved.answers[0]).toMatchObject({ value: null, unavailableReason: 'No supported product sheet' });
    expect((await s.app.request(`${path}/answers`, json({ expectedRevision: 2, requestId: 'request-1', value: 0, unavailableReason: null }))).status).toBe(409);
    s.packages.start(snapshot.id, { expectedRevision: 2, goal: snapshot.intent }); await tick();
    expect(runner.contexts[1].snapshot.answers).toEqual(saved.answers);
  });
  it('serves only current artifact bytes and never bypasses freshness through the source asset route', async () => {
    const runner = new ControlledRunner(), s = setup(runner), { snapshot, context, path } = await start(s, runner);
    const output = result(context), bytes = Buffer.from('Synthetic test bytes; not an export renderer');
    context.publish({ results: [output] });
    const asset = context.registerArtifact(bytes, 'text/csv', '../test.csv');
    const artifact = { id: 'artifact-1', inputRevision: 1, configVersion: context.run.configVersion, planId: output.planId, resultId: output.id, assetId: asset.id, kind: 'cut_csv' as const };
    expect(() => context.publish({ artifacts: [{ ...artifact, resultId: 'other' }] })).toThrow('artifact_result_mismatch');
    const foreign = s.packages.create(input());
    const foreignAsset = await s.packages.upload(foreign.id, Buffer.from('%PDF-1.4\n%%EOF'), 'application/pdf', 'foreign.pdf');
    expect(() => context.publish({ artifacts: [{ ...artifact, assetId: foreignAsset.id }] })).toThrow('asset_not_found');
    context.publish({ artifacts: [artifact] });
    expect((await s.app.request(`${path}/assets/${asset.id}`, { headers })).status).toBe(404);
    const download = await s.app.request(`${path}/artifacts/artifact-1/download`, { headers });
    expect(download.status).toBe(200); expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
    expect(download.headers.get('content-disposition')).toContain('attachment');
    runner.finish(); await tick();
    s.packages.edit(snapshot.id, { expectedRevision: 1, patch: { title: 'Changed' } });
    expect((await s.app.request(`${path}/artifacts/artifact-1/download`, { headers })).status).toBe(409);
    expect(s.packages.get(snapshot.id).freshness.artifacts[0].current).toBe(false);
  });
});

describe('single-process run lifecycle and crash boundary', () => {
  it('returns the active run for duplicate starts and rejects stale input or a different scenario goal', async () => {
    const runner = new ControlledRunner(), s = setup(runner), { snapshot, context, path } = await start(s, runner);
    const duplicate = await s.app.request(`${path}/runs`, json({ expectedRevision: 1, goal: snapshot.intent }));
    expect(duplicate.status).toBe(200); expect(await duplicate.json()).toMatchObject({ reused: true, run: { id: context.run.id } });
    expect(runner.contexts).toHaveLength(1);
    expect((await s.app.request(`${path}/runs`, json({ expectedRevision: 2, goal: snapshot.intent }))).status).toBe(409);
    expect((await s.app.request(`${path}/runs`, json({ expectedRevision: 1, goal: 'adapt_to_site' }))).status).toBe(400);
  });
  it.each(['cancel', 'edit'])('%s rejects all late writes and cannot overwrite a new run', async action => {
    const runner = new ControlledRunner(), s = setup(runner), { snapshot, context, path } = await start(s, runner);
    if (action === 'cancel') {
      expect((await s.app.request(`${path}/runs/${context.run.id}/cancel`, json({}))).status).toBe(200);
      expect(s.packages.get(snapshot.id).run?.status).toBe('cancelled');
    } else s.packages.edit(snapshot.id, { expectedRevision: 1, patch: { title: 'Changed input' } });
    expect(context.signal.aborted).toBe(true);
    expect(() => context.publish({ results: [result(context)] })).toThrow('run_no_longer_current');
    expect(() => context.progress('Late progress')).toThrow('run_no_longer_current');
    expect(() => context.registerArtifact(Buffer.from('late'), 'text/csv', 'late.csv')).toThrow('run_no_longer_current');
    const revision = s.packages.get(snapshot.id).inputRevision;
    const next = s.packages.start(snapshot.id, { expectedRevision: revision, goal: snapshot.intent }); await tick();
    runner.finish(0); await tick();
    expect(s.packages.get(snapshot.id).run?.id).toBe(next.run.id); expect(s.packages.get(snapshot.id).run?.status).toBe('running');
    expect((await s.app.request(`${path}/runs/${context.run.id}/cancel`, json({}))).status).toBe(404);
    runner.contexts[1].publish({ results: [result(runner.contexts[1])] }); runner.finish(1); await tick();
    expect(s.packages.get(snapshot.id).run?.status).toBe('completed'); expect(s.packages.get(snapshot.id).freshness.results[0].current).toBe(true);
  });
  it('marks running work interrupted on actual database reopen, preserves input and only runs again on request', async () => {
    const runner = new ControlledRunner(), s = setup(runner), { snapshot, context } = await start(s, runner, 3);
    context.publish({ results: [result(context)] });
    const saved = s.packages.get(snapshot.id);
    s.field.store.close(); // Crash simulation: no service.close, no cancellation/finalization.
    const restartedRunner = new ControlledRunner(), restarted = setup(restartedRunner, undefined, s.dir);
    const restored = restarted.packages.get(snapshot.id);
    expect(restored.baselinePlan).toEqual(saved.baselinePlan); expect(restored.siteFacts).toEqual(saved.siteFacts);
    expect(restored.inputRevision).toBe(1); expect(restored.run).toMatchObject({ status: 'interrupted', stopReason: 'server_restarted' });
    expect(restored.outputs).toEqual(saved.outputs); expect(restartedRunner.contexts).toHaveLength(0);
    restarted.packages.start(snapshot.id, { expectedRevision: 1, goal: snapshot.intent }); await tick();
    expect(restartedRunner.contexts).toHaveLength(1); expect(restartedRunner.contexts[0].snapshot.baselinePlan).toEqual(saved.baselinePlan);
    runner.finish(); await tick(); // The obsolete closed connection cannot accept the old completion.
  });
  it('configuration changes invalidate output freshness without incrementing semantic input', async () => {
    const runner = new ControlledRunner(), s = setup(runner), { snapshot, context } = await start(s, runner);
    context.publish({ results: [result(context)] }); runner.finish(); await tick(); s.packages.close(); s.field.store.close();
    const updated = setup(undefined, 'deployed-config-v2', s.dir).packages.get(snapshot.id);
    expect(updated.configVersion).toBe('deployed-config-v2'); expect(updated.inputRevision).toBe(1);
    expect(updated.outputs.results[0].configVersion).toBe('work-package-contract-v1'); expect(updated.freshness.results[0].current).toBe(false);
  });
  it('finalizes runner failures and permits manual retry without exposing provider errors', async () => {
    const runner: WorkPackageRunner = { execute: async () => { throw new Error('provider detail must not leak'); } };
    const s = setup(runner), p = s.packages.create(input());
    const first = s.packages.start(p.id, { expectedRevision: 1, goal: p.intent }); await tick();
    expect(s.packages.get(p.id).run).toMatchObject({ status: 'failed', stopReason: 'runner_failed' });
    const next = s.packages.start(p.id, { expectedRevision: 1, goal: p.intent });
    expect(next.reused).toBe(false); expect(next.run.id).not.toBe(first.run.id); await tick();
  });
});
