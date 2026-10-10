import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Type } from 'typebox';
import {
  AnswerPackageRequestSchema, CreateWorkPackageSchema, EditWorkPackageSchema, PublishPackageOutputsSchema,
  SelectPackagePlanSchema, StartPackageRunSchema,
  type PackageAsset, type PackageRun, type PackageRunStatus, type PublishPackageOutputs, type WorkPackageSnapshot,
} from '@sprink/core';
import { WorkPackageStore } from './store.js';
import { ensure, PackageError, parse, validateInputs, validatePlan } from './validation.js';

const now = () => new Date().toISOString();
const maxBytes = 20 * 1024 * 1024;
export const DEFAULT_PACKAGE_CONFIG_VERSION = 'work-package-contract-v1';
type Binding = { inputRevision: number; configVersion: string };
export interface PackageRunContext {
  snapshot: Readonly<WorkPackageSnapshot>;
  run: Readonly<PackageRun>;
  signal: AbortSignal;
  progress(message: string): void;
  publish(outputs: PublishPackageOutputs): void;
  registerArtifact(bytes: Buffer, mimeType: 'application/pdf' | 'text/csv' | 'application/json', filename: string): PackageAsset;
}
export interface WorkPackageRunner {
  validateSelection?(snapshot: Readonly<WorkPackageSnapshot>): void;
  execute(context: PackageRunContext): Promise<{ status: Extract<PackageRunStatus, 'completed' | 'waiting_input' | 'blocked' | 'failed'>; stopReason: string }>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sourceFields = new Set(['sourceLabel', 'nominalSize', 'materialRequirement', 'materialRequirement.material', 'requiredConnectionMethod', 'requiredPipeSpecification']);

/** Reopening is a separate review action, never permission to replace a confirmed graph in the same patch. */
function isDrawingReopen(before: WorkPackageSnapshot, after: WorkPackageSnapshot): boolean {
  if (!before.sourceDrawing || before.sourceDrawing.approval === 'approved' || !before.baselinePlan
      || after.baselinePlan?.confirmation !== 'proposed' || after.sourceDrawing?.approval !== 'unreviewed') return false;
  const expectedSource = { ...before.sourceDrawing, approval: 'unreviewed',
    scale: before.sourceDrawing.scale.value === null ? before.sourceDrawing.scale : { ...before.sourceDrawing.scale, basis: 'proposed_inputs' } };
  return same(after.baselinePlan, { ...before.baselinePlan, confirmation: 'proposed' })
    && same(after.sourceDrawing, expectedSource) && same(after.scope, before.scope);
}

/** Remove copied facts that no longer describe the corrected source or graph. */
function invalidateCorrectedInputs(before: WorkPackageSnapshot, after: WorkPackageSnapshot) {
  const a = before.sourceDrawing, b = after.sourceDrawing;
  const identity = (d: typeof a) => d && [d.assetId, d.drawingId, d.revision, d.page];
  const transform = (d: typeof a) => d && [d.scale.value, d.view?.sheetUnit, d.view?.frame];
  const sourceChanged = !!a && !same(identity(a), identity(b));
  const frameChanged = !!a && !same(transform(a), transform(b));
  const graph = (p: typeof before.baselinePlan) => p && [p.coordinateFrame, p.entities, p.connections];
  const graphChanged = !!before.baselinePlan && !same(graph(before.baselinePlan), graph(after.baselinePlan));
  const spatial = (p: typeof before.baselinePlan) => p && [p.coordinateFrame, p.entities.map(({ productId: _product, ...entity }) => entity), p.connections];
  const spatialChanged = !!before.baselinePlan && (!same(spatial(before.baselinePlan), spatial(after.baselinePlan)) || !same(before.scope, after.scope));
  const localFrame = (s: WorkPackageSnapshot) => ['origin.x', 'origin.y', 'origin.z', 'yaw'].map(name => {
    const f = [...s.detailing, ...s.siteFacts].find(f => f.field === `adaptationFrame.${name}` && !f.subjectIds.length);
    return f ? [f.value, f.unit] : null;
  });
  const localFrameChanged = !same(localFrame(before), localFrame(after));
  if (!sourceChanged && !frameChanged && !graphChanged && !spatialChanged && !localFrameChanged) return;
  const previous = new Map([...before.detailing, ...before.siteFacts].map(f => [f.id, f]));
  const entities = new Set(after.baselinePlan?.entities.map(e => e.id) ?? []);
  const keep = (f: WorkPackageSnapshot['detailing'][number]) => {
    if (f.subjectIds.some(id => !entities.has(id))) return false;
    // Newly supplied evidence is allowed; an unchanged copied fact still belongs to the previous revision.
    if (!same(previous.get(f.id), f)) return true;
    if (sourceChanged && sourceFields.has(f.field)) return false;
    if (localFrameChanged && /^(duct|workEnvelope)\./.test(f.field)) return false;
    if ((frameChanged || sourceChanged || spatialChanged) && /^(adaptationFrame|duct|workEnvelope)\./.test(f.field)) return false;
    if ((graphChanged || frameChanged || sourceChanged) && f.subjectIds.length && !sourceFields.has(f.field)) return false;
    return true;
  };
  after.detailing = after.detailing.filter(keep);
  after.siteFacts = after.siteFacts.filter(keep);
  if (sourceChanged || frameChanged || graphChanged || spatialChanged) after.changeRequest = null;
  else if (after.changeRequest) {
    const remaining = new Set([...after.detailing, ...after.siteFacts].map(f => f.id));
    after.changeRequest = { ...after.changeRequest, factIds: after.changeRequest.factIds.filter(id => remaining.has(id)) };
  }
}

export class WorkPackageService {
  private active = new Map<string, { runId: string; controller: AbortController }>();
  constructor(readonly store: WorkPackageStore, readonly configVersion = DEFAULT_PACKAGE_CONFIG_VERSION, private readonly runner?: WorkPackageRunner) {
    ensure(typeof configVersion === 'string' && configVersion.trim().length > 0 && configVersion.length <= 8000, 'invalid_config_version');
  }
  private current(item: Binding, snapshot: WorkPackageSnapshot) {
    return item.inputRevision === snapshot.inputRevision && item.configVersion === this.configVersion;
  }
  private snapshot(id: string) {
    const snapshot = this.store.get(id);
    snapshot.configVersion = this.configVersion;
    return snapshot;
  }
  get(id: string) {
    const snapshot = this.snapshot(id), outputs = snapshot.outputs;
    return {
      ...snapshot,
      freshness: {
        candidates: outputs.candidates ? this.current(outputs.candidates, snapshot) : false,
        results: outputs.results.map(r => ({ id: r.id, current: this.current(r, snapshot) })),
        requests: outputs.requests.map(r => ({ id: r.id, current: this.current(r, snapshot), answered: snapshot.answers.some(a => a.requestId === r.id) })),
        artifacts: outputs.artifacts.map(a => ({ id: a.id, current: this.artifactCurrent(a, snapshot) })),
      },
    };
  }
  list(projectId?: string) { return this.store.list(projectId).map(s => this.get(s.id)); }
  create(input: unknown) {
    const data = parse(CreateWorkPackageSchema, input);
    const snapshot: WorkPackageSnapshot = {
      id: randomUUID(), projectId: data.projectId, title: data.title, intent: data.intent,
      sourceDrawing: data.sourceDrawing ?? null, baselinePlan: data.baselinePlan ?? null, scope: data.scope ?? null,
      siteFacts: data.siteFacts ?? [], detailing: data.detailing ?? [], changeRequest: data.changeRequest ?? null,
      selectedPlan: null, inputRevision: 1, configVersion: this.configVersion,
      outputs: { candidates: null, results: [], requests: [], artifacts: [] }, answers: [], run: null, createdAt: now(), updatedAt: now(),
    };
    this.validate(snapshot);
    this.store.insert(snapshot);
    return this.get(snapshot.id);
  }
  /** The new package and all source assets either commit together or roll back together. */
  copyForSiteChange(id: string, input: unknown) {
    const data = parse(Type.Object({ expectedRevision: Type.Integer({ minimum: 1 }), title: Type.String({ minLength: 1, maxLength: 8000 }) }, { additionalProperties: false }), input);
    return this.store.db.transaction(() => {
      const source = this.snapshot(id);
      this.expected(source, data.expectedRevision);
      const next = this.create({ projectId: source.projectId, intent: 'adapt_to_site', title: data.title });
      const ids = new Set([source.sourceDrawing?.assetId, ...source.siteFacts.concat(source.detailing).map(f => f.source.assetId)].filter((id): id is string => !!id));
      const replacements = new Map<string, string>();
      for (const assetId of ids) {
        const asset = this.sourceAsset(id, assetId), copiedId = randomUUID();
        this.store.putAsset({ ...asset.metadata, id: copiedId, packageId: next.id }, asset.bytes);
        replacements.set(assetId, copiedId);
      }
      const copyFacts = (facts: WorkPackageSnapshot['siteFacts']) => facts.map(f => ({ ...f, source: { ...f.source, assetId: f.source.assetId ? replacements.get(f.source.assetId)! : null } }));
      return this.edit(next.id, { expectedRevision: next.inputRevision, patch: {
        sourceDrawing: source.sourceDrawing ? { ...source.sourceDrawing, assetId: replacements.get(source.sourceDrawing.assetId)! } : null,
        baselinePlan: source.baselinePlan, scope: source.scope, detailing: copyFacts(source.detailing), siteFacts: copyFacts(source.siteFacts),
      } });
    })();
  }
  private validate(snapshot: WorkPackageSnapshot) {
    validateInputs(snapshot, id => {
      const asset = this.store.asset(snapshot.id, snapshot.projectId, id).metadata;
      ensure(asset.purpose === 'source', 'not_source_asset');
    });
    ensure(snapshot.intent !== 'prepare_from_drawing' || snapshot.changeRequest === null, 'change_requires_adaptation');
  }
  private expected(snapshot: WorkPackageSnapshot, expectedRevision: number) {
    if (snapshot.inputRevision !== expectedRevision) throw new PackageError(409, 'revision_conflict');
  }
  private changed(snapshot: WorkPackageSnapshot) {
    snapshot.inputRevision++;
    snapshot.updatedAt = now();
    if (snapshot.run?.status === 'running') {
      snapshot.run.status = 'interrupted';
      snapshot.run.stopReason = 'inputs_changed';
      snapshot.run.updatedAt = now();
    }
    this.store.save(snapshot);
    this.active.get(snapshot.id)?.controller.abort();
    this.active.delete(snapshot.id);
    return this.get(snapshot.id);
  }
  edit(id: string, input: unknown) {
    const data = parse(EditWorkPackageSchema, input), snapshot = this.snapshot(id);
    this.expected(snapshot, data.expectedRevision);
    const next = { ...snapshot, ...data.patch };
    if (snapshot.baselinePlan?.confirmation === 'confirmed' &&
        (!same(snapshot.baselinePlan, next.baselinePlan) || !same(snapshot.sourceDrawing, next.sourceDrawing) || !same(snapshot.scope, next.scope))
        && !isDrawingReopen(snapshot, next)) {
      throw new PackageError(409, 'confirmed_baseline_is_immutable');
    }
    if (snapshot.sourceDrawing?.approval === 'approved' && JSON.stringify(snapshot.sourceDrawing) !== JSON.stringify(next.sourceDrawing)) {
      throw new PackageError(409, 'approved_source_is_immutable');
    }
    // A selected proposal remains bound to its source model, even before baseline confirmation.
    if (snapshot.selectedPlan && JSON.stringify(snapshot.baselinePlan) !== JSON.stringify(next.baselinePlan)) {
      throw new PackageError(409, 'selected_plan_baseline_conflict');
    }
    invalidateCorrectedInputs(snapshot, next);
    this.validate(next);
    return this.changed(next);
  }
  select(id: string, input: unknown) {
    const data = parse(SelectPackagePlanSchema, input), snapshot = this.snapshot(id);
    this.expected(snapshot, data.expectedRevision);
    if (data.planId === snapshot.baselinePlan?.id) snapshot.selectedPlan = null;
    else {
      const candidates = snapshot.outputs.candidates;
      if (!candidates || !this.current(candidates, snapshot)) throw new PackageError(409, 'stale_candidates');
      const candidate = candidates.candidates.find(c => c.plan.id === data.planId);
      if (!candidate) throw new PackageError(404, 'candidate_not_found');
      this.runner?.validateSelection?.(snapshot);
      snapshot.selectedPlan = structuredClone(candidate.plan);
    }
    return this.changed(snapshot);
  }
  answer(id: string, input: unknown) {
    const data = parse(AnswerPackageRequestSchema, input), snapshot = this.snapshot(id);
    this.expected(snapshot, data.expectedRevision);
    const request = snapshot.outputs.requests.find(r => r.id === data.requestId);
    if (!request) throw new PackageError(404, 'request_not_found');
    if (!this.current(request, snapshot) || snapshot.answers.some(a => a.requestId === request.id)) throw new PackageError(409, 'stale_request');
    ensure(data.value !== null ? data.unavailableReason === null : Boolean(data.unavailableReason), 'answer_requires_value_or_reason');
    snapshot.answers.push({ requestId: request.id, inputRevision: snapshot.inputRevision + 1, value: data.value, unavailableReason: data.unavailableReason });
    return this.changed(snapshot);
  }
  private saveAsset(snapshot: WorkPackageSnapshot, bytes: Buffer, mimeType: string, filename: string, purpose: PackageAsset['purpose']) {
    if (bytes.length === 0 || bytes.length > maxBytes) throw new PackageError(413, 'asset_size_limit');
    const asset: PackageAsset = {
      id: randomUUID(), packageId: snapshot.id, projectId: snapshot.projectId,
      filename: filename.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'asset',
      mimeType, purpose, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    this.store.putAsset(asset, bytes);
    return asset;
  }
  async upload(id: string, bytes: Buffer, mimeType: string, filename: string) {
    const snapshot = this.snapshot(id);
    if (bytes.length === 0 || bytes.length > maxBytes) throw new PackageError(413, 'asset_size_limit');
    if (mimeType === 'application/pdf') {
      if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new PackageError(415, 'invalid_pdf_signature');
    } else if (mimeType === 'image/png' || mimeType === 'image/jpeg') {
      try {
        const image = sharp(bytes, { limitInputPixels: 40000000 }), metadata = await image.metadata();
        if (metadata.format !== (mimeType === 'image/png' ? 'png' : 'jpeg')) throw new Error('type mismatch');
        await image.resize(1, 1).toBuffer();
      } catch { throw new PackageError(415, 'invalid_image'); }
    } else throw new PackageError(415, 'unsupported_media_type');
    return this.saveAsset(snapshot, bytes, mimeType, filename, 'source');
  }
  sourceAsset(id: string, assetId: string) {
    const snapshot = this.snapshot(id), asset = this.store.asset(id, snapshot.projectId, assetId);
    if (asset.metadata.purpose !== 'source') throw new PackageError(404, 'source_asset_not_found');
    return asset;
  }
  private artifactCurrent(artifact: WorkPackageSnapshot['outputs']['artifacts'][number], snapshot: WorkPackageSnapshot) {
    return this.current(artifact, snapshot) && snapshot.outputs.results.some(r => r.id === artifact.resultId && r.planId === artifact.planId && this.current(r, snapshot));
  }
  artifact(id: string, artifactId: string) {
    const snapshot = this.snapshot(id), artifact = snapshot.outputs.artifacts.find(a => a.id === artifactId);
    if (!artifact) throw new PackageError(404, 'artifact_not_found');
    if (!this.artifactCurrent(artifact, snapshot)) throw new PackageError(409, 'stale_artifact');
    return this.store.asset(id, snapshot.projectId, artifact.assetId);
  }
  start(id: string, input: unknown) {
    const data = parse(StartPackageRunSchema, input), snapshot = this.snapshot(id);
    this.expected(snapshot, data.expectedRevision);
    ensure(data.goal === snapshot.intent || data.goal === 'export_selected_package' || (data.goal === 'read_site_evidence' && snapshot.intent === 'adapt_to_site' && snapshot.siteWork?.readingRequest), 'goal_intent_mismatch');
    if (snapshot.run?.status === 'running') {
      if (snapshot.run.goal !== data.goal) throw new PackageError(409, 'active_run_goal_conflict');
      return { run: snapshot.run, reused: true };
    }
    if (!this.runner) throw new PackageError(503, 'runner_unavailable');
    const run: PackageRun = {
      id: randomUUID(), goal: data.goal, inputRevision: snapshot.inputRevision, configVersion: this.configVersion,
      status: 'running', progress: 'starting', stopReason: null, startedAt: now(), updatedAt: now(),
    };
    snapshot.run = run;
    this.store.save(snapshot);
    const controller = new AbortController();
    this.active.set(id, { runId: run.id, controller });
    // Deferral makes the running summary observable even for a synchronously completing adapter.
    void Promise.resolve().then(() => this.execute(snapshot, run, controller));
    return { run, reused: false };
  }
  private bound(id: string, runId: string) {
    const snapshot = this.snapshot(id), active = this.active.get(id);
    if (!active || active.runId !== runId || active.controller.signal.aborted || snapshot.run?.id !== runId || snapshot.run.status !== 'running' || !this.current(snapshot.run, snapshot)) {
      throw new PackageError(409, 'run_no_longer_current');
    }
    return snapshot;
  }
  private publish(id: string, runId: string, raw: PublishPackageOutputs) {
    const outputs = parse(PublishPackageOutputsSchema, raw), snapshot = this.bound(id, runId);
    const checkBinding = (item: Binding) => { if (!this.current(item, snapshot)) throw new PackageError(409, 'output_version_mismatch'); };
    const next = { ...snapshot.outputs, ...outputs };
    if (outputs.candidates) {
      const candidates = outputs.candidates;
      checkBinding(candidates);
      ensure(snapshot.intent === 'adapt_to_site' && candidates.baselinePlanId === snapshot.baselinePlan?.id, 'candidate_baseline_mismatch');
      const planIds = candidates.candidates.map(c => c.plan.id);
      ensure(new Set(planIds).size === planIds.length && !planIds.includes(candidates.baselinePlanId), 'duplicate_plan_id');
      for (const c of candidates.candidates) {
        validatePlan(c.plan);
        ensure(c.plan.confirmation === 'proposed', 'candidate_cannot_confirm');
        ensure(c.plan.coordinateFrame.id === snapshot.baselinePlan?.coordinateFrame.id, 'candidate_frame_mismatch');
        const prior = snapshot.selectedPlan?.id === c.plan.id ? snapshot.selectedPlan
          : snapshot.outputs.candidates?.candidates.find(p => p.plan.id === c.plan.id)?.plan;
        if (prior && JSON.stringify(prior) !== JSON.stringify(c.plan)) throw new PackageError(409, 'candidate_plan_id_reused');
      }
    }
    const plans = [snapshot.baselinePlan, snapshot.selectedPlan, ...(next.candidates && this.current(next.candidates, snapshot) ? next.candidates.candidates.map(c => c.plan) : [])].filter(p => p !== null);
    for (const result of outputs.results ?? []) {
      checkBinding(result);
      const plan = plans.find(p => p.id === result.planId);
      ensure(plan, 'result_plan_not_found');
      const entities = new Set(plan.entities.map(e => e.id));
      ensure([...result.materials.flatMap(m => m.entityIds), ...result.cuts.flatMap(c => c.sourceEntityIds), ...result.evaluations.flatMap(e => e.subjectIds), ...result.gaps.flatMap(g => g.subjectIds)].every(id => entities.has(id)), 'result_unknown_subject');
      const pieces = new Set(result.cuts.map(c => c.pieceId)), joints = new Set(plan.connections.map(c => c.id));
      ensure(result.assembly.every(step => step.pieceIds.every(id => pieces.has(id)) && step.jointIds.every(id => joints.has(id))), 'assembly_unknown_reference');
    }
    for (const request of outputs.requests ?? []) {
      checkBinding(request);
      ensure(!snapshot.answers.some(a => a.requestId === request.id), 'answered_request_id_reused');
      ensure(request.subjectIds.every(id => plans.some(p => p.entities.some(e => e.id === id))), 'request_unknown_subject');
    }
    for (const artifact of outputs.artifacts ?? []) {
      checkBinding(artifact);
      ensure(next.results.some(r => r.id === artifact.resultId && r.planId === artifact.planId && this.current(r, snapshot)), 'artifact_result_mismatch');
      const asset = this.store.asset(id, snapshot.projectId, artifact.assetId).metadata;
      const mime = artifact.kind === 'pdf' ? 'application/pdf' : artifact.kind === 'manifest' ? 'application/json' : 'text/csv';
      ensure(asset.purpose === 'artifact' && asset.mimeType === mime, 'artifact_asset_mismatch');
    }
    for (const items of [next.results, next.requests, next.artifacts]) ensure(new Set(items.map(i => i.id)).size === items.length, 'duplicate_output_id');
    // An ID names immutable content; replacing content needs a new ID, even in one run.
    for (const key of ['results', 'requests', 'artifacts'] as const) {
      for (const item of outputs[key] ?? []) {
        const prior = snapshot.outputs[key].find(p => p.id === item.id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(item)) throw new PackageError(409, 'output_id_reused');
      }
    }
    snapshot.outputs = next;
    this.store.save(snapshot);
  }
  private async execute(snapshot: WorkPackageSnapshot, run: PackageRun, controller: AbortController) {
    const id = snapshot.id;
    try {
      this.bound(id, run.id);
      const result = await this.runner!.execute({
        snapshot: structuredClone(snapshot), run: structuredClone(run), signal: controller.signal,
        progress: message => {
          ensure(typeof message === 'string' && message.length > 0 && message.length <= 8000, 'invalid_progress');
          const current = this.bound(id, run.id);
          current.run!.progress = message; current.run!.updatedAt = now(); this.store.save(current);
        },
        publish: outputs => this.publish(id, run.id, outputs),
        registerArtifact: (bytes, mimeType, filename) => {
          ensure(['application/pdf', 'text/csv', 'application/json'].includes(mimeType), 'unsupported_artifact_type');
          return this.saveAsset(this.bound(id, run.id), bytes, mimeType, filename, 'artifact');
        },
      });
      ensure(['completed', 'waiting_input', 'blocked', 'failed'].includes(result.status) && typeof result.stopReason === 'string' && result.stopReason.length > 0 && result.stopReason.length <= 8000, 'invalid_runner_result');
      const current = this.bound(id, run.id);
      current.run!.status = result.status; current.run!.stopReason = result.stopReason; current.run!.updatedAt = now();
      this.store.save(current);
    } catch {
      // Cancellation, edits, restart/shutdown, or a newer run must never be overwritten.
      if (!controller.signal.aborted && this.store.db.open) {
        const current = this.snapshot(id);
        if (current.run?.id === run.id && current.run.status === 'running') {
          current.run.status = 'failed'; current.run.stopReason = 'runner_failed'; current.run.updatedAt = now(); this.store.save(current);
        }
      }
    } finally {
      if (this.active.get(id)?.runId === run.id) this.active.delete(id);
    }
  }
  cancel(id: string, runId: string) {
    const snapshot = this.snapshot(id);
    if (!snapshot.run || snapshot.run.id !== runId) throw new PackageError(404, 'run_not_found');
    if (snapshot.run.status === 'running') {
      snapshot.run.status = 'cancelled'; snapshot.run.stopReason = 'user_cancelled'; snapshot.run.updatedAt = now();
      this.store.save(snapshot);
      this.active.get(id)?.controller.abort(); this.active.delete(id);
    }
    return snapshot.run;
  }
  close() {
    for (const [id, active] of this.active) {
      const snapshot = this.snapshot(id);
      if (snapshot.run?.id === active.runId && snapshot.run.status === 'running') {
        snapshot.run.status = 'interrupted'; snapshot.run.stopReason = 'server_stopped'; snapshot.run.updatedAt = now(); this.store.save(snapshot);
      }
      active.controller.abort();
    }
    this.active.clear();
  }
}
