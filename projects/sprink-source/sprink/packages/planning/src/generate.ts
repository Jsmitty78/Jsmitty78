import type { Box, Fact, GeometryPort, Length, Point, Unit } from "./geometry-port.js";
import type { Candidate, CandidateSet, GenerateInput, Plan, Reason, ReasonCode, Template } from "./types.js";

const SCALE: Record<Unit, number> = { m: 1, mm: 0.001, ft: 0.3048, in: 0.0254 };
const AXES = ["x", "y", "z"] as const;
type Axis = typeof AXES[number];
type Vec = Record<Axis, number>;
class Block extends Error {
  constructor(readonly reason: Reason) { super(reason.message); }
}
function block(code: ReasonCode, path: string, message: string): never {
  throw new Block({ code, path, message });
}
function known<T>(fact: Fact<T> | undefined, path: string): T {
  if (!fact || fact.value === null || !fact.confirmed || fact.source === "model" || !fact.evidenceIds.length) {
    block("input_missing", path, "A confirmed, evidenced value is required.");
  }
  return fact.value;
}
function id(value: string, path: string): void {
  if (typeof value !== "string" || !value.trim()) block("invalid_input", path, "A non-empty string ID is required.");
}
function finite(value: number, path: string): number {
  if (!Number.isFinite(value)) block("invalid_input", path, "Value must be finite.");
  return value;
}
function factor(unit: Unit): number {
  if (!Object.hasOwn(SCALE, unit)) block("unsupported", "unit", "Supported units are m, mm, ft and in.");
  return SCALE[unit];
}
function length(value: Length, path: string, positive = false): number {
  const result = finite(value.value * factor(value.unit), path);
  if (positive ? result <= 0 : result < 0) block("invalid_input", path, "Length is outside its permitted range.");
  return result;
}
function point(value: Point, frame: string, path: string): Vec {
  if (value.frameId !== frame) block("invalid_input", path, "Coordinate frames must match; no transform is assumed.");
  return Object.fromEntries(AXES.map(axis => [axis, finite(value[axis] * factor(value.unit), path)])) as Vec;
}
function box(value: Box, frame: string, path: string): { min: Vec; max: Vec } {
  if (value.kind !== "axis_aligned_box") block("unsupported", path, "Only axis-aligned boxes are supported.");
  const min = point(value.min, frame, path), max = point(value.max, frame, path);
  if (AXES.some(axis => min[axis] >= max[axis])) block("invalid_input", path, "Box extents must be positive.");
  return { min, max };
}
function proposed<T>(value: T): Fact<T> {
  return { value, confirmed: false, evidenceIds: [], source: "manual" };
}

/** Pure bounded search. No default geometry engine, product dimensions, or clearance. */
export function generateCandidates(input: GenerateInput, evaluate: GeometryPort): CandidateSet {
  const output: CandidateSet = {
    projectId: input.projectId, packageId: input.packageId, inputRevision: input.inputRevision,
    configVersion: input.configVersion, baselinePlanId: input.baseline.id,
    state: "no_candidate", candidates: [], rejected: [], searchedTemplates: [], reasons: [],
    baselineGeometry: null, selection: null,
    searchCoverage: "One straight tie-in span: direct plus four perpendicular, four-elbow detours. One midpoint lane per side; no exhaustive route search.",
    preference: "Fewer added elbows, then shorter added centerline length, then ASCII template ID. User selection required.",
  };
  try {
    for (const key of ["projectId", "packageId", "configVersion"] as const) id(input[key], key);
    if (!Number.isSafeInteger(input.inputRevision) || input.inputRevision < 0) block("invalid_input", "inputRevision", "Revision must be a nonnegative safe integer.");
    if (input.intent !== "adapt_to_site") block("unsupported", "intent", "Candidate generation requires adapt_to_site.");
    const baseline = input.baseline;
    id(baseline.id, "baseline.id");
    for (const [name, items] of Object.entries({ nodes: baseline.nodes, segments: baseline.segments,
      fittings: baseline.fittings, ducts: baseline.ducts, heads: baseline.heads.map(h => ({ id: h.headId })) })) {
      const ids = new Set<string>();
      for (const item of items) {
        id(item.id, name);
        if (ids.has(item.id)) block("invalid_connection", name, "Duplicate entity ID.");
        ids.add(item.id);
      }
    }
    // Graph integrity precedes the narrower supported-topology check.
    for (const segment of baseline.segments) {
      if (segment.startNodeId === segment.endNodeId || !baseline.nodes.some(n => n.id === segment.startNodeId)
        || !baseline.nodes.some(n => n.id === segment.endNodeId)) block("invalid_connection", segment.id, "Segment endpoints must resolve to two different nodes.");
    }
    const target = baseline.segments.find(s => s.id === input.targetSegmentId);
    if (!target) block("invalid_connection", "targetSegmentId", "Target segment does not exist.");
    if (baseline.heads.some(head => baseline.segments.some(segment => segment.id === head.headId))) {
      block("invalid_connection", "baseline.heads", "Head and pipe part IDs must be distinct.");
    }
    if (input.protectedSegmentIds.some(protectedId => !baseline.segments.some(s => s.id === protectedId))) {
      block("invalid_connection", "protectedSegmentIds", "A protected segment does not exist.");
    }
    if (input.protectedSegmentIds.includes(target.id)) block("unsupported", "targetSegmentId", "The selected segment is protected.");
    if (baseline.segments.length !== 1 || baseline.nodes.length !== 2 || baseline.fittings.length !== 0) {
      block("unsupported", "baseline", "First slice requires one straight span and exactly two tie-in nodes; extract a bounded span without interior branches/fittings.");
    }
    const start = baseline.nodes.find(n => n.id === target.startNodeId)!;
    const end = baseline.nodes.find(n => n.id === target.endNodeId)!;
    if (input.fixedConnectionNodeIds.length !== 2 || new Set(input.fixedConnectionNodeIds).size !== 2
      || !input.fixedConnectionNodeIds.includes(start.id) || !input.fixedConnectionNodeIds.includes(end.id)) {
      block("invalid_connection", "fixedConnectionNodeIds", "Both target endpoints must be the fixed connection nodes.");
    }
    if (start.kind !== "tie_in" || end.kind !== "tie_in") block("unsupported", "baseline.nodes", "Both fixed endpoints must be tie-ins.");
    const frame = known(baseline.coordinateFrame, "coordinateFrame");
    id(frame.id, "coordinateFrame.id"); factor(frame.lengthUnit);
    const a = point(known(start.position, "start.position"), frame.id, "start.position");
    const b = point(known(end.position, "end.position"), frame.id, "end.position");
    const changed = AXES.filter(axis => a[axis] !== b[axis]);
    if (!changed.length) block("invalid_connection", "targetSegmentId", "Zero-length span.");
    if (changed.length !== 1) block("unsupported", "targetSegmentId", "The target must be axis-parallel.");
    const along = changed[0]!;
    for (const head of baseline.heads) {
      if (!baseline.nodes.some(n => n.id === head.attachedNodeId)) block("invalid_connection", head.headId, "Head attachment does not resolve.");
      point(known(head.position, `heads.${head.headId}.position`), frame.id, head.headId);
    }
    const diameter = length(known(target.outsideDiameter, "outsideDiameter"), "outsideDiameter", true);
    const radius = diameter / 2;
    const clearance = length(known(input.requiredPipeClearance, "requiredPipeClearance"), "requiredPipeClearance");
    const envelope = box(known(input.workEnvelope, "workEnvelope"), frame.id, "workEnvelope");
    if (!baseline.ducts.length) block("input_missing", "ducts", "A confirmed site discrepancy box is required.");
    const ducts = baseline.ducts.map(duct => {
      const geometry = known(duct.geometry, `ducts.${duct.id}`);
      if (geometry.kind === "unsupported") block("unsupported", duct.id, "Duct geometry is unsupported.");
      return box(geometry, frame.id, duct.id);
    });
    const binding = known(input.product.compatibility, "product.compatibility");
    for (const key of ["pipeProductId", "elbowProductId", "connectionMethod"] as const) id(binding[key], `product.${key}`);
    if (target.productId !== binding.pipeProductId) block("invalid_input", "target.productId", "Target pipe must match the evidenced product binding.");
    // Missing takeouts do not erase known route geometry. The shared engine returns null cuts.
    for (const key of ["centerToFace", "insertionOrThreadMakeup"] as const) {
      const fact = input.product[key];
      if (fact.confirmed && fact.value !== null) length(fact.value, `product.${key}`);
    }
    const baselineCheck = evaluate({ plan: baseline, proposedNodeIds: [], proposedFittingIds: [] });
    if (!baselineCheck.ok) block(baselineCheck.code, baselineCheck.path, baselineCheck.reason);
    output.baselineGeometry = baselineCheck.result;
    if (baselineCheck.result.state === "unsupported") block("unsupported", "baseline", baselineCheck.result.unsupported.join(", ") || "Baseline geometry unsupported by the shared engine.");
    const baseLength = finite(Math.abs(b[along] - a[along]), "spanLength");
    const sign = b[along] > a[along] ? 1 : -1;
    const lowObstacle = Math.min(...ducts.map(d => d.min[along])) - radius - clearance;
    const highObstacle = Math.max(...ducts.map(d => d.max[along])) + radius + clearance;
    const entry = finite(a[along] / 2 + (sign > 0 ? lowObstacle : highObstacle) / 2, "entry");
    const exit = finite(b[along] / 2 + (sign > 0 ? highObstacle : lowObstacle) / 2, "exit");
    const templates: { template: Template; points: Vec[]; noSpace?: boolean }[] = [{ template: "direct", points: [a, b] }];
    for (const cross of AXES.filter(axis => axis !== along)) {
      for (const side of [-1, 1]) {
        const near = side < 0 ? Math.min(...ducts.map(d => d.min[cross])) - radius - clearance
          : Math.max(...ducts.map(d => d.max[cross])) + radius + clearance;
        const far = side < 0 ? envelope.min[cross] + radius : envelope.max[cross] - radius;
        const lane = finite(near / 2 + far / 2, "lane");
        templates.push({ template: `detour:${cross}${side < 0 ? "-" : "+"}`,
          noSpace: side * (far - near) <= 0 || sign * (entry - a[along]) <= 0
            || sign * (exit - entry) <= 0 || sign * (b[along] - exit) <= 0 || lane === a[cross],
          points: [a, { ...a, [along]: entry }, { ...a, [along]: entry, [cross]: lane },
            { ...b, [along]: exit, [cross]: lane }, { ...b, [along]: exit }, b] });
      }
    }
    for (const { template, points, noSpace } of templates) {
      output.searchedTemplates.push(template);
      const reject = (code: ReasonCode, path: string, message: string) => output.rejected.push({ template, reasons: [{ code, path, message }] });
      if (noSpace) { reject("outside_work_bounds", "workEnvelope", "No positive-width lane or ordered lead-in fits this template."); continue; }
      if (points.some(p => AXES.some(axis => p[axis] - radius < envelope.min[axis] || p[axis] + radius > envelope.max[axis]))) {
        reject("outside_work_bounds", "workEnvelope", "The modeled pipe envelope exceeds confirmed work bounds."); continue;
      }
      const candidateId = [input.projectId, input.packageId, input.inputRevision, input.configVersion, baseline.id, template]
        .map(value => encodeURIComponent(String(value))).join("/");
      const plan: Plan = structuredClone(baseline);
      plan.id = candidateId;
      const nodes = points.slice(1, -1).map((p, i) => ({ id: `${candidateId}/node/${i}`, kind: "fitting_center" as const,
        fittingId: `${candidateId}/elbow/${i}`, position: proposed<Point>({ ...p, unit: "m", frameId: frame.id }) }));
      const chain = [start.id, ...nodes.map(n => n.id), end.id];
      const segments = points.slice(1).map((_, i) => ({ ...structuredClone(target),
        sourceSegmentIds: [...(target.sourceSegmentIds ?? [target.id])],
        // The first changed entity retains its identity; all split entities retain lineage.
        id: i === 0 ? target.id : `${candidateId}/segment/${i}`, startNodeId: chain[i]!, endNodeId: chain[i + 1]! }));
      const fittings = nodes.map((node, i) => ({ id: node.fittingId, kind: proposed<"elbow_90">("elbow_90"),
        centerNodeId: node.id, productId: binding.elbowProductId,
        ports: [
          { segmentId: segments[i]!.id, endpoint: "end" as const, nodeId: node.id,
            centerToFace: structuredClone(input.product.centerToFace), insertionOrThreadMakeup: structuredClone(input.product.insertionOrThreadMakeup) },
          { segmentId: segments[i + 1]!.id, endpoint: "start" as const, nodeId: node.id,
            centerToFace: structuredClone(input.product.centerToFace), insertionOrThreadMakeup: structuredClone(input.product.insertionOrThreadMakeup) },
        ] as const }));
      const existingIds = new Set([...baseline.nodes, ...baseline.segments, ...baseline.fittings, ...baseline.ducts,
        ...baseline.heads.map(head => ({ id: head.headId }))].map(e => e.id));
      if ([...nodes, ...segments.slice(1), ...fittings].some(e => existingIds.has(e.id))) {
        reject("invalid_connection", "generatedIds", "Generated entity ID conflicts with a source entity."); continue;
      }
      plan.nodes = [...plan.nodes, ...nodes]; plan.segments = segments; plan.fittings = fittings;
      const proposedNodeIds = nodes.map(n => n.id), proposedFittingIds = fittings.map(f => f.id);
      const check = evaluate({ plan, proposedNodeIds, proposedFittingIds });
      if (!check.ok) { reject(check.code, check.path, check.reason); continue; }
      const geometry = check.result;
      if (geometry.state === "unsupported") { reject("unsupported", "geometry", geometry.unsupported.join(", ") || "Geometry engine cannot evaluate this template."); continue; }
      if (geometry.ductClearances.some(c => c.state === "collision" || (c.marginM !== undefined && c.marginM < clearance))) {
        reject("geometry_interference", "ducts", "Pipe envelope collides with a duct or violates the confirmed clearance."); continue;
      }
      // An incomplete clearance report must never masquerade as collision-free.
      if (geometry.ductClearances.length !== segments.length * baseline.ducts.length
        || geometry.ductClearances.some(c => c.state !== "clear" || c.marginM === undefined || !Number.isFinite(c.marginM))) {
        reject("input_missing", "ductClearances", "Complete pipe-to-duct clearance checks are required."); continue;
      }
      const routeLength = finite(points.slice(1).reduce((sum, p, i) => sum + AXES.reduce((n, axis) => n + Math.abs(p[axis] - points[i]![axis]), 0), 0), "routeLength");
      const added = fittings.length;
      const delta = finite(routeLength - baseLength, "lengthDelta");
      const candidate: Candidate = {
        id: candidateId, template, plan, status: "proposed", proposedNodeIds, proposedFittingIds, geometry,
        comparison: { addedFittings: added, centerlineLengthDeltaM: delta,
          cutLengthDeltaM: geometry.totalCutLengthM === null || baselineCheck.result.totalCutLengthM === null
            ? null : geometry.totalCutLengthM - baselineCheck.result.totalCutLengthM,
          changedSegmentIds: template === "direct" ? [] : [target.id],
          addedSegmentIds: segments.slice(1).map(s => s.id), retainedSegmentIds: template === "direct" ? [target.id] : [],
          proposedReuse: null, lineage: segments.map(s => ({ segmentId: s.id, baselineSegmentId: target.id })),
          explanation: `${added} added elbows; ${delta} m added centerline. Compared before any user selection.` },
        unresolved: ["Fitting-body clearance is not evaluated.", "Assembly access/movement, field joints and support design remain unresolved.",
          "Hydraulics, head discharge and applicable rule feedback require the shared evaluator.",
          "Product compatibility evidence is supplied by the caller; no product/service validation is performed here.",
          ...geometry.missingInputs.map(path => `Missing calculation input: ${path}`)],
      };
      output.candidates.push(candidate);
    }
    output.candidates.sort((a, b) => a.comparison.addedFittings - b.comparison.addedFittings
      || a.comparison.centerlineLengthDeltaM - b.comparison.centerlineLengthDeltaM
      || (a.template < b.template ? -1 : a.template > b.template ? 1 : 0));
    output.state = output.candidates.length
      ? output.candidates.some(c => c.geometry.state === "input_missing") ? "input_missing" : "ready"
      : output.rejected.some(r => r.reasons.some(reason => reason.code === "input_missing")) ? "input_missing"
        : output.rejected.some(r => r.reasons.some(reason => reason.code === "unsupported")) ? "unsupported" : "no_candidate";
    if (!output.candidates.length) output.reasons.push({ code: "no_candidate", path: "searchCoverage",
      message: "No candidate retained in this finite template search; this is not proof of global infeasibility." });
  } catch (error) {
    if (!(error instanceof Block)) throw error;
    output.reasons.push(error.reason);
    output.state = error.reason.code === "invalid_connection" ? "invalid_connection"
      : error.reason.code === "input_missing" ? "input_missing"
        : error.reason.code === "unsupported" ? "unsupported" : "invalid_input";
  }
  return output;
}
