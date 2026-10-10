import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Type } from 'typebox';
import { emptySiteWork, measurementFields, reviewTopics, SiteReadingSchema, ReadingItemSchema, type SiteWork, type WorkPackageSnapshot, type PackageInputs, type ReadingItem, type SiteMeasurement, type EvidenceImage } from '@sprink/core';
import { canonical } from '../exports/snapshot.js';
import { openPdf } from '../uploads/pdf.js';
import { ensure, PackageError, parse } from './validation.js';
import type { WorkPackageService } from './service.js';

const text = Type.String({ minLength: 1, maxLength: 4000 });
const revision = Type.Integer({ minimum: 1 });
const nullableText = Type.Union([text, Type.Null()]);
const object = <T extends Record<string, import('typebox').TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const Crop = object({ x: Type.Number({ minimum: 0, maximum: 1 }), y: Type.Number({ minimum: 0, maximum: 1 }), width: Type.Number({ exclusiveMinimum: 0, maximum: 1 }), height: Type.Number({ exclusiveMinimum: 0, maximum: 1 }) });
const EvidenceInput = object({ expectedRevision: revision, assetId: text, page: Type.Integer({ minimum: 1, maximum: 100 }), role: Type.Enum(['drawing', 'site']), synthetic: Type.Boolean(), label: text });
const RequestInput = object({ expectedRevision: revision, evidenceId: text, instruction: text, crop: Type.Union([Crop, Type.Null()]) });
const ConfirmInput = object({ expectedRevision: revision, readingId: text, items: Type.Array(ReadingItemSchema, { maxItems: 80 }), reviewer: text, spanLengthMm: Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Null()]), elevationMm: Type.Union([Type.Number(), Type.Null()]), frameSynthetic: Type.Boolean(), pipeProductId: nullableText, fittingProductId: nullableText });
const MeasurementInput = object({ expectedRevision: revision, field: Type.Enum([...measurementFields]), subjectIds: Type.Array(text, { maxItems: 20 }), value: Type.Union([Type.Number(), Type.Null()]), unit: Type.Enum(['mm', 'm', 'in', 'ft']), reason: text, evidenceId: nullableText, synthetic: Type.Boolean(), confirmed: Type.Boolean(), unavailableReason: nullableText });
const ReviewInput = object({ expectedRevision: revision, reviewer: text, decision: Type.Enum(['accepted', 'conditional', 'revise']), conditions: text, evidenceIds: Type.Array(text, { maxItems: 30 }), checks: Type.Optional(Type.Array(object({topic:Type.Enum([...reviewTopics]),answer:Type.String({maxLength:4000}),evidence:Type.String({maxLength:4000})}), {maxItems:4})) });
export function reviewFingerprint(s: WorkPackageSnapshot): string {
  return createHash('sha256').update(canonical({ source: s.sourceDrawing, baseline: s.baselinePlan, selected: s.selectedPlan, scope: s.scope, facts: s.siteFacts, detailing: s.detailing, change: s.changeRequest, config: s.configVersion })).digest('hex');
}

/** All human mutations use the existing version guard and transaction. Machine readings never change facts. */
export class SiteWorkService {
  constructor(private packages: WorkPackageService) {}
  private update(id: string, expected: number, change: (s: WorkPackageSnapshot, work: SiteWork) => Partial<PackageInputs> | void) {
    return this.packages.store.db.transaction(() => {
      const s = this.packages.get(id);
      if (s.inputRevision !== expected) throw new PackageError(409, 'revision_conflict');
      ensure(s.intent === 'adapt_to_site', 'site_work_requires_adaptation');
      const work = structuredClone(s.siteWork ?? emptySiteWork());
      const patch = change(s, work) ?? {};
      if (patch.siteFacts && s.changeRequest && !patch.changeRequest) patch.changeRequest = { ...s.changeRequest, factIds: [...patch.siteFacts, ...(patch.detailing ?? s.detailing)].map(f => f.id) };
      this.packages.edit(id, { expectedRevision: expected, patch });
      const next = this.packages.store.get(id);
      next.siteWork = work;
      this.packages.store.save(next);
      return this.packages.get(id);
    })();
  }
  async evidence(id: string, raw: unknown) {
    const input = parse(EvidenceInput, raw), initial = this.packages.get(id);
    if (initial.inputRevision !== input.expectedRevision) throw new PackageError(409, 'revision_conflict');
    const asset = this.packages.sourceAsset(id, input.assetId);
    let image: Buffer;
    if (asset.metadata.mimeType === 'application/pdf') {
      const pdf = await openPdf(asset.bytes);
      try { ensure(input.page <= pdf.pageCount, 'page_out_of_range'); image = (await (await pdf.page(input.page)).render()).image; }
      finally { await pdf.close(); }
    } else {
      ensure(input.page === 1, 'image_has_one_page');
      image = await sharp(asset.bytes).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    }
    const meta = await sharp(image).metadata();
    // Check after rendering, before persisting anything.
    if (this.packages.get(id).inputRevision !== input.expectedRevision) throw new PackageError(409, 'revision_conflict');
    const imageId = randomUUID();
    return this.packages.store.db.transaction(() => {
      this.packages.store.putAsset({ id: imageId, packageId: id, projectId: initial.projectId, filename: `evidence-${input.page}.png`, mimeType: 'image/png', bytes: image.length, sha256: createHash('sha256').update(image).digest('hex'), purpose: 'source' }, image);
      return this.update(id, input.expectedRevision, (_s, w) => { w.evidence.push({ id: randomUUID(), originalAssetId: input.assetId, imageAssetId: imageId, page: input.page, width: meta.width!, height: meta.height!, role: input.role, synthetic: input.synthetic, label: input.label }); });
    })();
  }
  request(id: string, raw: unknown) {
    const input = parse(RequestInput, raw);
    return this.update(id, input.expectedRevision, (_s, w) => {
      ensure(w.evidence.some(e => e.id === input.evidenceId), 'evidence_not_found');
      if (input.crop) ensure(input.crop.x + input.crop.width <= 1 && input.crop.y + input.crop.height <= 1, 'crop_out_of_bounds');
      w.readingRequest = { evidenceId: input.evidenceId, instruction: input.instruction, crop: input.crop };
    });
  }
  async image(id: string) {
    const s = this.packages.get(id), request = s.siteWork?.readingRequest;
    ensure(request, 'reading_request_required');
    const e = s.siteWork!.evidence.find(e => e.id === request.evidenceId)!;
    const asset = this.packages.sourceAsset(id, e.imageAssetId);
    let image = sharp(asset.bytes);
    if (request.crop) {
      const c = request.crop, left = Math.floor(c.x * e.width), top = Math.floor(c.y * e.height);
      image = image.extract({ left, top, width: Math.min(e.width - left, Math.max(1, Math.floor(c.width * e.width))), height: Math.min(e.height - top, Math.max(1, Math.floor(c.height * e.height))) });
    }
    return { data: (await image.resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).png().toBuffer()).toString('base64'), mimeType: 'image/png', metadata: { evidence: e, request, coordinates: '0..1 within the displayed crop; origin top left; pixels are NOT millimetres', fields: measurementFields } };
  }
  saveReading(id: string, runId: string, raw: unknown) {
    const data = parse(SiteReadingSchema, raw), s = this.packages.store.get(id), w = s.siteWork;
    ensure(w?.readingRequest && s.run?.id === runId && s.run.status === 'running' && s.run.inputRevision === s.inputRevision, 'run_no_longer_current');
    ensure(new Set(data.items.map(i => i.id)).size === data.items.length, 'duplicate_reading_id');
    const crop = w.readingRequest.crop;
    const items = data.items.map(i => ({ ...i, points: i.points.map(p => crop ? { x: crop.x + p.x * crop.width, y: crop.y + p.y * crop.height } : p) }));
    const reading = { ...data, items, id: randomUUID(), evidenceId: w.readingRequest.evidenceId, inputRevision: s.inputRevision, configVersion: s.configVersion };
    w.readings.push(reading);
    this.packages.store.save(s);
    return { readingId: reading.id, count: items.length, status: 'awaiting_human_review' };
  }
  confirm(id: string, raw: unknown) {
    const input = parse(ConfirmInput, raw);
    return this.update(id, input.expectedRevision, (s, w) => {
      const reading = w.readings.find(r => r.id === input.readingId);
      ensure(reading && !reading.reviewedAt && reading.inputRevision === s.inputRevision && reading.configVersion === s.configVersion, 'stale_reading');
      const evidence = w.evidence.find(e => e.id === reading.evidenceId)!;
      ensure(input.items.every(i => reading.items.some(r => r.id === i.id)), 'unknown_reading_item');
      ensure(new Set(input.items.map(i => i.id)).size === input.items.length, 'duplicate_reading_id');
      const patch: Partial<PackageInputs> = {};
      const dimensions = input.items.filter(i => i.kind === 'dimension' && i.field && measurementFields.includes(i.field as never));
      const facts = [...s.siteFacts];
      for (const item of dimensions) {
        if (item.value === null || item.unit === null || item.field === 'span.length' || item.field === 'pipeElevation') continue;
        const f = dimensionFact(item.field!, item.value, item.unit, evidence, input.reviewer, item.evidence);
        const old = facts.findIndex(f => f.field === item.field && !f.subjectIds.length);
        if (old >= 0) facts.splice(old, 1);
        facts.push(f);
      }
      patch.siteFacts = facts;
      const pipe = input.items.find(i => i.kind === 'pipe');
      if (pipe && evidence.role === 'drawing') {
        ensure(input.items.filter(i=>i.kind==='pipe').length===1, 'choose_one_straight_span');
        ensure(!s.baselinePlan, 'existing_baseline_requires_manual_review');
        ensure(pipe.points.length === 2 && input.spanLengthMm !== null && input.elevationMm !== null, 'confirm_span_length_and_elevation');
        const [a, b] = pipe.points.map(p => ({ x: p.x * evidence.width, y: p.y * evidence.height }));
        const distance = Math.hypot(b.x - a.x, b.y - a.y);
        ensure(distance > 1, 'zero_length_span');
        const scale = input.spanLengthMm / distance, angle = Math.atan2(b.y - a.y, b.x - a.x), frame = { id: 'drawing-plan', lengthUnit: 'mm' as const, axes: 'right_handed_z_up' as const };
        const convert = (p: ReadingItem['points'][number]) => { const x = (p.x * evidence.width - a.x) * scale, y = -(p.y * evidence.height - a.y) * scale; return { x: Math.cos(angle) * x - Math.sin(angle) * y, y: Math.sin(angle) * x + Math.cos(angle) * y, z: input.elevationMm! }; };
        patch.baselinePlan = { id: `baseline-${randomUUID()}`, coordinateFrame: frame, confirmation: 'confirmed', entities: [
          { id: 'site-span', kind: 'pipe', productId: input.pipeProductId, ports: [{ id: 'start', position: { x: 0, y: 0, z: input.elevationMm }, unknownReason: null }, { id: 'end', position: { x: input.spanLengthMm, y: 0, z: input.elevationMm }, unknownReason: null }] },
          ...input.items.filter(i => i.kind === 'head').map((i, n) => ({ id: `retained-head-${n}`, kind: 'head' as const, productId: null, ports: [{ id: 'p', position: convert(i.points[0]), unknownReason: null }] })),
        ], connections: [] };
        for (const [index, port] of patch.baselinePlan.entities[0].ports.entries()) {
          const id = `scope-end-${index}`;
          patch.baselinePlan.entities.push({ id, kind:'tie_in', productId:null, ports:[{id:'p',position:port.position,unknownReason:null}] });
          patch.baselinePlan.connections.push({ id:`${id}-connection`, from:{entityId:'site-span',portId:port.id}, to:{entityId:id,portId:'p'} });
        }
        patch.scope = { coordinateFrame: frame, includedEntityIds: ['site-span','scope-end-0','scope-end-1'], excludedEntityIds: patch.baselinePlan.entities.filter(e => e.kind === 'head').map(e => e.id), tieInEntityIds: ['scope-end-0','scope-end-1'] };
        patch.sourceDrawing = { assetId: evidence.imageAssetId, drawingId: evidence.label, revision: 'human-reviewed-reading', page: 1, approval: 'unreviewed', scale: { value: scale, unit: 'mm/pixel', reason: null, basis: evidence.synthetic ? 'proposed_inputs' : 'confirmed_inputs' }, view: { sheetUnit: 'image_px', workArea: null, calibration: { method: 'two_point', a, b, realDistance: { value: input.spanLengthMm, unit: 'mm' }, printedScale: null, reference: `Reviewed by ${input.reviewer}; original ${evidence.originalAssetId} page ${evidence.page}`, pointUncertaintyMm: null }, frame: { origin: a, rotationDeg: angle * 180 / Math.PI }, derivativeOf: `${evidence.originalAssetId} page ${evidence.page}` } };
        patch.detailing = [...s.detailing, ...[
          ['adaptationFrame.origin.x', 0, 'mm'], ['adaptationFrame.origin.y', 0, 'mm'], ['adaptationFrame.origin.z', input.elevationMm, 'mm'], ['adaptationFrame.yaw', 0, 'deg'],
        ].map(([field, value, unit]) => ({ ...dimensionFact(String(field), Number(value), String(unit), evidence, input.reviewer, input.frameSynthetic?'Hypothetical local horizontal plane; no surveyed elevation':'Human confirmed local coordinate frame', input.frameSynthetic || evidence.synthetic), context: 'detailing' as const }))];
        if (input.fittingProductId) patch.detailing.push({ ...dimensionFact('elbowProductId', 0, 'mm', evidence, input.reviewer, 'Human selected fitting'), value: input.fittingProductId, unit: null, context: 'detailing' });
        for(const end of ['start','end']) patch.detailing.push({ ...dimensionFact(`datum.${end}`,0,'mm',evidence,input.reviewer,'Scope station only; no physical cut end or field joint established'),subjectIds:['site-span'],value:'scope_interface',unit:null,context:'detailing' });
        patch.changeRequest = { id: randomUUID(), description: 'Local duct conflict; preserve both endpoints and retained heads', affectedEntityIds: ['site-span'], factIds: facts.map(f => f.id) };
      }
      reading.originalItems = structuredClone(reading.items); reading.reviewedBy = input.reviewer;
      reading.items = input.items; reading.reviewedAt = new Date().toISOString(); reading.acceptedIds = input.items.map(i => i.id);
      return patch;
    });
  }
  measure(id: string, raw: unknown) {
    const input = parse(MeasurementInput, raw);
    return this.update(id, input.expectedRevision, (s, w) => {
      ensure(input.field !== 'span.length' && input.field !== 'pipeElevation', 'use_drawing_review_for_span');
      ensure(input.subjectIds.every(id => s.baselinePlan?.entities.some(e => e.id === id)), 'measurement_subject_not_found');
      ensure(input.value === null ? Boolean(input.unavailableReason) : input.unavailableReason === null, 'measurement_value_or_reason');
      const evidence = input.evidenceId ? w.evidence.find(e => e.id === input.evidenceId) : undefined;
      ensure(!input.evidenceId || evidence, 'evidence_not_found');
      const synthetic = input.synthetic || evidence?.synthetic === true;
      const m: SiteMeasurement = { ...input, synthetic };
      w.measurements.push({ ...m, inputRevision: s.inputRevision + 1 });
      const fact = dimensionFact(input.field, input.value, input.unit, evidence, 'User', input.reason, synthetic);
      fact.subjectIds = input.subjectIds; fact.unknownReason = input.unavailableReason;
      if (!input.confirmed || input.value === null) { fact.confirmation = 'proposed'; if (!synthetic) fact.provenance = 'user_entered'; }
      return { siteFacts: [...s.siteFacts.filter(f => !(f.field === input.field && canonical(f.subjectIds) === canonical(input.subjectIds))), fact] };
    });
  }
  review(id: string, raw: unknown) {
    const input = parse(ReviewInput, raw);
    return this.update(id, input.expectedRevision, (s, w) => {
      ensure(s.selectedPlan, 'select_plan_before_review');
      ensure(s.outputs.results.some(r => r.planId === s.selectedPlan!.id && r.inputRevision === s.inputRevision && r.configVersion === s.configVersion), 'current_result_required');
      ensure(input.evidenceIds.every(id => w.evidence.some(e => e.id === id)), 'evidence_not_found');
      w.reviews.push({ id: randomUUID(), ...input, planId: s.selectedPlan.id, inputRevision: s.inputRevision, configVersion: s.configVersion, fingerprint: reviewFingerprint(s), plan:structuredClone(s.selectedPlan), checks:reviewTopics.map(topic=>input.checks?.find(c=>c.topic===topic)??{topic,answer:'',evidence:''}), recordedAt: new Date().toISOString() });
    });
  }
}
function dimensionFact(field: string, value: number | null, unit: string, evidence: EvidenceImage | undefined, reviewer: string, reason: string, synthetic = evidence?.synthetic ?? false): WorkPackageSnapshot['siteFacts'][number] {
  return { id: randomUUID(), field, value, unit, subjectIds: [], unknownReason: value === null ? reason : null, confirmation: synthetic ? 'proposed' : 'confirmed', provenance: synthetic ? 'synthetic_assumption' : 'confirmed_evidence', context: 'observed', source: { description: `${synthetic ? 'ASSUMPTION: synthetic test evidence. ' : ''}${reviewer}: ${reason}`, assetId: evidence?.imageAssetId ?? null, page: evidence ? 1 : null } };
}
