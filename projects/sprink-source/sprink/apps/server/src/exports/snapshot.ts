import { createHash } from 'node:crypto';
import { ExportError, type ExportBinding, type ExportSnapshot } from './types.js';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  }
  return JSON.stringify(value);
}
export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export const snapshotHash = (snapshot: ExportSnapshot): string => sha256(canonical(snapshot));
export function assertSameBinding(a: ExportBinding, b: ExportBinding): void {
  if (canonical(a) !== canonical(b)) throw new ExportError(409, 'Work package changed. Regenerate the export from the current revision.');
}
export function unresolved(snapshot: ExportSnapshot): string[] {
  return [...new Set([
    ...snapshot.unresolvedItems,
    ...snapshot.materials.filter(r => r.status !== 'known').map(r => `${r.id}: ${r.unresolvedReason}`),
    ...snapshot.cuts.filter(r => r.status !== 'known').map(r => `${r.pieceId}: ${r.unresolvedReason}`),
    ...snapshot.assembly.filter(r => r.status !== 'known').map(r => `${r.id}: ${r.unresolvedReason}`),
    ...snapshot.findings.filter(r => r.status === 'unknown' || r.status === 'fail').map(r => `${r.id} [${r.status}]: ${r.description}`),
  ])];
}
export function validateSnapshot(s: ExportSnapshot): void {
  const fail = (message: string): never => { throw new ExportError(422, message); };
  if (!s || !s.binding || !s.derivedBinding) fail('Missing export/derived-output binding.');
  for (const key of ['packageId', 'configVersion', 'modelVersion', 'selectionId', 'catalogVersion', 'engineVersion', 'rulesVersion', 'evidenceVersion', 'outputVersion'] as const) {
    if (typeof s.binding[key] !== 'string' || !s.binding[key].trim()) fail(`Missing binding: ${key}`);
  }
  if (!Number.isSafeInteger(s.binding.inputRevision) || s.binding.inputRevision < 0) fail('Invalid input revision.');
  assertSameBinding(s.binding, s.derivedBinding);
  if (!['prepare_from_drawing', 'adapt_to_site'].includes(s.intent)) fail('Unsupported export intent.');
  for (const key of ['title', 'scope', 'drawingReference'] as const) if (!s[key]?.trim()) fail(`Missing ${key}.`);
  for (const key of ['materials', 'cuts', 'assembly', 'changes', 'findings', 'sources', 'unresolvedItems'] as const) {
    if (!Array.isArray(s[key])) fail(`Missing ${key} collection.`);
  }
  const unique = (ids: string[], label: string): Set<string> => {
    if (ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) fail(`Empty or duplicate ${label} ID.`);
    return new Set(ids);
  };
  const sources = unique(s.sources.map(r => r.id), 'source');
  unique(s.materials.map(r => r.id), 'material');
  const pieces = unique(s.cuts.map(r => r.pieceId), 'piece');
  unique(s.assembly.map(r => r.id), 'operation');
  unique(s.changes.map(r => r.id), 'change');
  unique(s.findings.map(r => r.id), 'finding');
  const refs = (ids: string[], available: Set<string>, label: string) => {
    if (!Array.isArray(ids) || ids.some(id => !available.has(id))) fail(`Unresolved ${label} cross-reference.`);
  };
  const validateValue = (value: number | null, unit: string, status: string, reason: string | null) => {
    if (!['known', 'unresolved', 'unsupported'].includes(status)) fail('Invalid value status.');
    if (!unit?.trim()) fail('Every numeric value needs an explicit unit.');
    if (status === 'known' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) fail('Known values must be finite and non-negative.');
    if (status !== 'known' && (value !== null || !reason?.trim())) fail('Unresolved values require null and a reason, never zero.');
  };
  const plan = s.selectedPlan;
  if (!plan || plan.id !== s.binding.selectionId) fail('Selected plan does not match export binding.');
  if (s.intent === 'adapt_to_site' && !s.baselinePlan) fail('Adaptation exports require the unchanged baseline plan.');
  if (s.intent === 'prepare_from_drawing' && s.changes.length) fail('Drawing preparation must not invent change data.');
  const point = (p: number[]) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  for (const view of [plan, ...(s.baselinePlan ? [s.baselinePlan] : [])]) {
    if (!view.id?.trim() || !view.title?.trim() || !view.unit?.trim() || !Array.isArray(view.segments) || !Array.isArray(view.joints)) fail('Invalid plan view.');
    unique(view.segments.map(r => r.id), 'segment'); unique(view.joints.map(r => r.id), 'joint');
    for (const seg of view.segments) {
      if (!point(seg.from) || !point(seg.to) || !Array.isArray(seg.pieceIds)) fail('Plan coordinates must be finite 3D points.');
    }
    unique((view.context ?? []).map(r => r.id), 'context');
    for (const item of view.context ?? []) if (!item.kind || !item.positions.every(point)) fail('Invalid protected context coordinates.');
    for (const joint of view.joints) if (!point(joint.position)) fail('Invalid joint coordinates.');
  }
  const segments = new Set(plan.segments.map(r => r.id));
  const joints = new Set(plan.joints.map(r => r.id));
  for (const row of s.materials) {
    validateValue(row.quantity, row.unit, row.status, row.unresolvedReason); refs(row.sourceIds, sources, 'source');
    if (!row.subjectIds.length) fail('Materials need drawing subject references.');
  }
  for (const row of s.cuts) {
    validateValue(row.length, row.unit, row.status, row.unresolvedReason); refs(row.sourceIds, sources, 'source');
    if (!row.segmentIds.length) fail('Cuts need segment lineage.');
    refs(row.segmentIds, segments, 'segment'); refs(row.jointIds, joints, 'joint');
  }
  for (const seg of plan.segments) refs(seg.pieceIds, pieces, 'piece');
  for (const row of s.assembly) {
    if (!['known', 'unresolved', 'unsupported'].includes(row.status) || (row.status !== 'known' && !row.unresolvedReason?.trim())) fail('Invalid assembly status/reason.');
    refs(row.pieceIds, pieces, 'piece'); refs(row.jointIds, joints, 'joint'); refs(row.sourceIds, sources, 'source');
  }
  for (const row of [...s.findings, ...s.changes]) refs(row.sourceIds, sources, 'source');
  if (s.findings.some(r => !['pass', 'fail', 'unknown', 'not_applicable'].includes(r.status))) fail('Invalid finding status.');
  if (s.changes.some(r => !['added', 'removed', 'retained', 'proposed_reuse', 'changed'].includes(r.kind) || !['material', 'cut', 'joint', 'operation'].includes(r.entityType))) fail('Invalid change category.');
  if ((!s.materials.length || !s.cuts.length || !s.assembly.length || !plan.segments.length) && !s.unresolvedItems.length) fail('Incomplete output needs an explicit unresolved item.');
}
