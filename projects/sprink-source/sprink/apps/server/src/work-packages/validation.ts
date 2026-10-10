import { Check } from 'typebox/value';
import type { Static, TSchema } from 'typebox';
import type { PackageInputs, PackagePlan } from '@sprink/core';

export class PackageError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export function parse<T extends TSchema>(schema: T, value: unknown): Static<T> {
  const finite = (item: unknown): boolean => typeof item === 'number' ? Number.isFinite(item)
    : Array.isArray(item) ? item.every(finite)
    : item !== null && typeof item === 'object' ? Object.values(item).every(finite) : true;
  if (!finite(value) || !Check(schema, value)) throw new PackageError(400, 'invalid_input');
  return structuredClone(value) as Static<T>;
}
export function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new PackageError(400, code);
}
export function validatePlan(plan: PackagePlan) {
  const entityIds = new Set(plan.entities.map(e => e.id));
  ensure(entityIds.size === plan.entities.length, 'duplicate_entity_id');
  ensure(new Set(plan.connections.map(c => c.id)).size === plan.connections.length, 'duplicate_connection_id');
  const ports = new Set<string>();
  for (const entity of plan.entities) {
    ensure(new Set(entity.ports.map(p => p.id)).size === entity.ports.length, 'duplicate_port_id');
    for (const port of entity.ports) {
      ensure(port.position !== null || port.unknownReason, 'unknown_position_requires_reason');
      if (port.position) ensure(Object.values(port.position).every(Number.isFinite), 'non_finite_position');
      ports.add(`${entity.id}/${port.id}`);
    }
  }
  for (const c of plan.connections) {
    const from = `${c.from.entityId}/${c.from.portId}`, to = `${c.to.entityId}/${c.to.portId}`;
    ensure(from !== to && ports.has(from) && ports.has(to), 'invalid_connection');
  }
}
export function validateInputs(inputs: PackageInputs, checkAsset: (id: string) => void) {
  const plan = inputs.baselinePlan;
  if (plan) validatePlan(plan);
  const entities = new Set(plan?.entities.map(e => e.id) ?? []);
  const checkSubjects = (ids: string[]) => ensure(ids.every(id => entities.has(id)), 'unknown_subject');
  if (inputs.sourceDrawing) {
    checkAsset(inputs.sourceDrawing.assetId);
    ensure(inputs.sourceDrawing.scale.unit === 'mm/pixel', 'invalid_scale_unit');
    const value = inputs.sourceDrawing.scale.value;
    ensure(value === null || (Number.isFinite(value) && value > 0), 'invalid_scale');
    // With a view, the scale is millimetres per sheet unit (PDF point or image pixel).
    const calibration = inputs.sourceDrawing.view?.calibration;
    if (calibration?.method === 'two_point') {
      ensure(calibration.a && calibration.b && calibration.realDistance, 'incomplete_calibration');
      const sheet = Math.hypot(calibration.b.x - calibration.a.x, calibration.b.y - calibration.a.y);
      ensure(sheet > 0, 'calibration_points_coincide');
      const mm = calibration.realDistance.value * { mm: 1, m: 1000, in: 25.4, ft: 304.8 }[calibration.realDistance.unit];
      ensure(value === null || Math.abs(value - mm / sheet) <= 1e-9 * (mm / sheet), 'scale_calibration_mismatch');
    }
    if (calibration?.method === 'printed_scale') ensure(calibration.printedScale, 'printed_scale_required');
  }
  if (inputs.scope) {
    ensure(plan && inputs.scope.coordinateFrame.id === plan.coordinateFrame.id, 'scope_frame_mismatch');
    checkSubjects([...inputs.scope.includedEntityIds, ...inputs.scope.excludedEntityIds, ...inputs.scope.tieInEntityIds]);
    ensure(!inputs.scope.includedEntityIds.some(id => inputs.scope!.excludedEntityIds.includes(id)), 'scope_overlap');
  }
  const facts = [...inputs.siteFacts, ...inputs.detailing];
  ensure(new Set(facts.map(f => f.id)).size === facts.length, 'duplicate_fact_id');
  ensure(inputs.siteFacts.every(f => f.context !== 'detailing') && inputs.detailing.every(f => f.context === 'detailing'), 'fact_context_mismatch');
  for (const fact of facts) {
    checkSubjects(fact.subjectIds);
    ensure(!fact.provenance || fact.provenance === 'confirmed_evidence' || fact.confirmation === 'proposed', 'unverified_provenance_cannot_be_confirmed');
    ensure(fact.value !== null || fact.unknownReason, 'unknown_fact_requires_reason');
    ensure(fact.value !== null || fact.confirmation === 'proposed', 'unknown_fact_cannot_be_confirmed');
    if (typeof fact.value === 'number') ensure(Number.isFinite(fact.value) && fact.unit, 'measurement_requires_unit');
    if (fact.source.assetId) checkAsset(fact.source.assetId);
  }
  if (inputs.changeRequest) {
    checkSubjects(inputs.changeRequest.affectedEntityIds);
    ensure(inputs.changeRequest.factIds.every(id => facts.some(f => f.id === id)), 'unknown_change_fact');
  }
}
