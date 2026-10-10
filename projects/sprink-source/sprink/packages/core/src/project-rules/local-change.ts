import type { Fact, RuleStatus } from "../types.js";
import type {
  DocumentRevisionRef,
  ProjectEvaluationRequest,
  ProjectEvidence,
  ProjectQuantity,
  ProjectRuleResult,
  ProjectSourceReference,
} from "../project-contract.js";
import { normalizeProjectQuantity, ProjectInputError, toProjectSourceReference } from "../project-contract.js";
import { evaluateLocalPlanGeometry, type LocalPlanGeometryResult } from "../local-change-geometry.js";
import { resolveSfNfpa13Edition, type SfProjectFacts } from "../sf-project-basis.js";
import type {
  LocalChangeVerificationState,
  ProjectLocalChangeInput,
  ProjectLocalChangeReport,
  ProjectLocalBomLine,
  ProjectLocalHeadDelta,
  ProjectLocalPlan,
} from "../local-change-contract.js";

const AB204 = "https://sf-fire.org/media/4169";
const NFPA_REASON = "NFPA 13 spacing, obstruction, support-capacity, and hydraulic-adequacy criteria have not been incorporated into this bounded local-change evaluator.";

function ref(page: number, clause: string, purpose: string, document = "SFFD AB 2.04", url = AB204): ProjectSourceReference {
  return toProjectSourceReference({
    document: document === "SFFD AB 2.04" ? "SFFD Administrative Bulletin 2.04, Fire Sprinkler Submittals" : "SFFD Administrative Bulletin 4.15, Attachments and Anchors Acceptable for Hanging and Sway Bracing of Sprinkler Pipe",
    revision: "2025", page, url, purpose,
  }, document, "2025", [clause]);
}

const SOURCES = {
  scope: [ref(1, "Note 1.A-C", "San Francisco NFPA 13 permit-edition basis; edition basis only.")],
  plans: [ref(4, "I.14(C)", "Sprinkler relocations must be represented on approved plans."), ref(6, "I.19(D)-(E)", "Change plan information and affected pipe/fitting layout details.")],
  geometry: [ref(6, "I.19(E)(3)", "Plan length is center-to-center; derived cut arithmetic is only a bounded material detail.")],
  headReuse: [ref(4, "I.14(D)", "A threaded sprinkler removed from a fitting or welded is not to be reinstalled.")],
  headRemoval: [ref(4, "I.14(A)", "A modification includes removing unused excess piping.")],
  riser: [ref(4, "I.15", "When piping or sprinklers are added to an existing system, show existing configuration and connection to existing riser.")],
  fieldDeviation: [ref(4, "I.14(E)", "A field installation that differs from approved plans may require recalculation; review is not automatic failure.")],
  hydraulic: [ref(10, "I.22(A)(2)(a)-(d)", "Named existing-system recalculation triggers and the residual case-by-case direction.")],
  supports: [ref(9, "I.21(A)-(F)", "Affected support and brace information; numeric adequacy remains subject to the referenced NFPA text.", "SFFD AB 2.04")],
  pending: [] as ProjectSourceReference[],
};

interface FactCheck<T> {
  value?: T;
  evidenceIds: string[];
  issues: string[];
  state: LocalChangeVerificationState;
}

function sameRevision(left: DocumentRevisionRef | null | undefined, right: DocumentRevisionRef | null | undefined): boolean {
  return !!left && !!right && left.documentId === right.documentId && left.revision === right.revision && left.edition === right.edition;
}

function checkFact<T>(
  request: ProjectEvaluationRequest,
  fact: Fact<T> | undefined,
  path: string,
  subjects: readonly string[],
  kinds: readonly ProjectEvidence["kind"][],
  expectedRevision?: DocumentRevisionRef,
): FactCheck<T> {
  const issues: string[] = [];
  if (!fact || fact.value == null || !fact.confirmed || fact.source === "model") issues.push(path);
  if (!fact?.evidenceIds?.length) issues.push(`${path}.evidenceIds`);
  const evidenceIds = fact?.evidenceIds ?? [];
  for (const id of evidenceIds) {
    const matches = (request.evidence ?? []).filter(record => record.id === id);
    if (matches.length !== 1) {
      issues.push(`${path}.evidenceIds:${id}`);
      continue;
    }
    const record = matches[0]!;
    if (record.projectId !== request.project.id || !subjects.every(subject => record.subjectIds.includes(subject)) || record.superseded || record.invalidated || !kinds.includes(record.kind)) {
      issues.push(`${path}.evidenceIds:${id}`);
    }
    if (expectedRevision && !sameRevision(record.documentRevision, expectedRevision)) issues.push(`${path}.evidenceIds:${id}.documentRevision`);
  }
  const uniqueIssues = [...new Set(issues)];
  return {
    ...(uniqueIssues.length || fact?.value == null ? {} : { value: fact.value }),
    evidenceIds: [...new Set(evidenceIds)],
    issues: uniqueIssues,
    state: uniqueIssues.length ? "input_missing" : "verified",
  };
}

function result(
  request: ProjectEvaluationRequest,
  ruleId: string,
  title: string,
  status: RuleStatus,
  state: LocalChangeVerificationState,
  reason: string,
  subjects: readonly string[],
  sourceRefs: readonly ProjectSourceReference[],
  evidenceIds: readonly string[] = [],
  missingInputs: readonly string[] = [],
): ProjectRuleResult {
  return {
    ruleId, title, targetId: request.localChange!.id,
    status,
    applicability: status === "not_applicable" ? "not_applicable" : status === "unknown" ? "unknown" : "applicable",
    reason,
    missingInputs: [...new Set(missingInputs)],
    evidenceIds: [...new Set(evidenceIds)],
    sourceRefs,
    versions: { taskRevision: request.project.revision, ruleVersion: "1", sourceRevision: "2025" },
    packId: "sf-local-change-2025",
    subjectIds: [...new Set(subjects)],
    requirementLevel: "requirement",
    verificationState: state,
  };
}

function unknownResult(request: ProjectEvaluationRequest, id: string, title: string, state: LocalChangeVerificationState, reason: string, subjects: readonly string[], sources: readonly ProjectSourceReference[], missing: readonly string[] = [], evidence: readonly string[] = []): ProjectRuleResult {
  return result(request, id, title, "unknown", state, reason, subjects, sources, evidence, missing);
}

function docFact(request: ProjectEvaluationRequest, fact: Fact<DocumentRevisionRef> | undefined, path: string, subjects: readonly string[], kinds: readonly ProjectEvidence["kind"][]): FactCheck<DocumentRevisionRef> {
  return checkFact(request, fact, path, subjects, kinds, fact?.value ?? undefined);
}

function planGeometryFacts(request: ProjectEvaluationRequest, plan: ProjectLocalPlan): { issues: string[]; evidenceIds: string[] } {
  const issues: string[] = [];
  const evidenceIds: string[] = [];
  const source = docFact(request, plan.sourceDrawing, `${plan.id}.sourceDrawing`, [plan.id], ["drawing"]);
  issues.push(...source.issues);
  evidenceIds.push(...source.evidenceIds);
  const revision = source.value;
  const use = <T>(fact: Fact<T> | undefined, path: string, subject: string) => {
    const checked = checkFact(request, fact, path, [subject, plan.id], ["drawing"], revision);
    issues.push(...checked.issues);
    evidenceIds.push(...checked.evidenceIds);
    return checked;
  };
  use(plan.coordinateFrame, `${plan.id}.coordinateFrame`, plan.id);
  for (const room of plan.rooms) use(room.ceiling, `rooms.${room.id}.ceiling`, room.id);
  for (const node of plan.nodes) {
    use(node.position, `nodes.${node.id}.position`, node.id);
    if (node.kind === "tie_in") use(node.tieInNetCutOffset, `nodes.${node.id}.tieInNetCutOffset`, node.id);
  }
  for (const segment of plan.segments) use(segment.outsideDiameter, `segments.${segment.id}.outsideDiameter`, segment.id);
  for (const segment of plan.segments) {
    use(segment.cutEndDatumAtStart, `segments.${segment.id}.cutEndDatumAtStart`, segment.id);
    use(segment.cutEndDatumAtEnd, `segments.${segment.id}.cutEndDatumAtEnd`, segment.id);
  }
  for (const fitting of plan.fittings) {
    use(fitting.kind, `fittings.${fitting.id}.kind`, fitting.id);
    for (const [index, port] of fitting.ports.entries()) {
      use(port.centerToFace, `fittings.${fitting.id}.ports.${index}.centerToFace`, fitting.id);
      use(port.insertionOrThreadMakeup, `fittings.${fitting.id}.ports.${index}.insertionOrThreadMakeup`, fitting.id);
    }
  }
  for (const duct of plan.ducts) use(duct.geometry, `ducts.${duct.id}.geometry`, duct.id);
  return { issues: [...new Set(issues)], evidenceIds: [...new Set(evidenceIds)] };
}

const lengthFactor: Readonly<Record<string, number>> = { m: 1, mm: 0.001, ft: 0.3048, in: 0.0254 };

function pointMeters(point: { x: number; y: number; z: number; unit: string; frameId: string }): [number, number, number] | undefined {
  const factor = lengthFactor[point.unit];
  if (factor === undefined) return undefined;
  const result = [point.x * factor, point.y * factor, point.z * factor] as [number, number, number];
  return result.every(Number.isFinite) ? result : undefined;
}

function impactNeighborhoodCheck(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput): FactCheck<NonNullable<Fact<ProjectLocalChangeInput["changeRequest"]["impactNeighborhood"]["value"]>["value"]>> {
  const fact = input.changeRequest.impactNeighborhood;
  const checked = checkFact(request, fact, "changeRequest.impactNeighborhood", [input.changeRequest.id], ["permit", "drawing"]);
  if (!checked.value) return checked as FactCheck<NonNullable<Fact<ProjectLocalChangeInput["changeRequest"]["impactNeighborhood"]["value"]>["value"]>>;
  const requiredSubjects = [input.changeRequest.id, ...checked.value.roomIds, ...checked.value.headIds, ...checked.value.supportIds, ...checked.value.ductIds, ...checked.value.segmentIds];
  const covered = new Set((request.evidence ?? []).filter(record => checked.evidenceIds.includes(record.id) && record.projectId === request.project.id && !record.superseded && !record.invalidated).flatMap(record => record.subjectIds));
  const uncovered = requiredSubjects.filter(subject => !covered.has(subject));
  const idFields = [
    ["roomIds", [...new Set([...input.baseline.rooms.map(item => item.id), ...input.proposed.rooms.map(item => item.id)])]],
    ["headIds", [...new Set([...input.baseline.heads.map(item => item.headId), ...input.proposed.heads.map(item => item.headId)])]],
    ["supportIds", [...new Set([...input.baseline.supports.map(item => item.supportId), ...input.proposed.supports.map(item => item.supportId)])]],
    ["ductIds", [...new Set([...input.baseline.ducts.map(item => item.id), ...input.proposed.ducts.map(item => item.id)])]],
    ["segmentIds", [...new Set([...input.baseline.segments.map(item => item.id), ...input.proposed.segments.map(item => item.id)])]],
  ] as const;
  const omitted = idFields.flatMap(([field, ids]) => ids.filter(id => !checked.value![field].includes(id)).map(id => `changeRequest.impactNeighborhood.${field}:${id}`));
  return { ...checked, issues: [...new Set([...checked.issues, ...uncovered.map(subject => `changeRequest.impactNeighborhood.evidenceScope:${subject}`), ...omitted])], state: uncovered.length || omitted.length ? "input_missing" : checked.state };
}

function routeHasChanged(baseline: ProjectLocalPlan, proposed: ProjectLocalPlan, delta: ProjectLocalChangeReport["delta"]): boolean {
  if (delta.state === "verified" && (delta.pipeCountDelta !== 0 || delta.centerlineLengthDeltaM !== 0 || delta.elbowCountDelta !== 0)) return true;
  const signature = (plan: ProjectLocalPlan) => {
    const nodes = new Map(plan.nodes.map(node => [node.id, node]));
    return JSON.stringify(plan.segments.map(segment => {
      const a = nodes.get(segment.startNodeId)?.position.value;
      const b = nodes.get(segment.endNodeId)?.position.value;
      const point = (value: typeof a) => value ? pointMeters(value) : undefined;
      return [segment.id, segment.startNodeId, segment.endNodeId, point(a), point(b), segment.outsideDiameter.value ? segment.outsideDiameter.value.value * lengthFactor[segment.outsideDiameter.value.unit] : null];
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  };
  return signature(baseline) !== signature(proposed);
}

function scopeState(request: ProjectEvaluationRequest): { state: LocalChangeVerificationState; reason: string; missing: string[]; evidence: string[] } {
  const facts = request.facts ?? {};
  const scopeFacts = [facts.systemType, facts.sprinklerType, facts.storage, facts.hazardClassification];
  const scopeFields = ["facts.systemType", "facts.sprinklerType", "facts.storage", "facts.hazardClassification"];
  const checks = scopeFacts.map((fact, index) => checkFact(request, fact, scopeFields[index]!, [request.project.id], ["permit", "drawing"]));
  const missing = checks.flatMap(check => check.issues);
  const evidence = checks.flatMap(check => check.evidenceIds);
  const sfInput = facts.sfNfpa13 ?? {};
  const context = {
    targetId: request.project.id,
    taskRevision: request.project.revision,
    observations: (request.evidence ?? [])
      .filter(record => record.projectId === request.project.id && record.subjectIds.includes(request.project.id))
      .map(record => ({ id: record.id, targetId: request.project.id, ...(record.superseded ? { superseded: true } : {}), ...(record.invalidated ? { invalidated: true } : {}) })),
  };
  const resolved = resolveSfNfpa13Edition(sfInput as SfProjectFacts, context);
  const sfFacts = Object.entries(sfInput).filter(([, fact]) => fact?.value != null) as [string, Fact<unknown>][];
  for (const [field, fact] of sfFacts) {
    const check = checkFact(request, fact, `facts.sfNfpa13.${field}`, [request.project.id], ["permit"]);
    missing.push(...check.issues);
    evidence.push(...check.evidenceIds);
  }
  if (resolved.status === "resolved" && resolved.nfpa13Edition !== "2025") {
    return { state: "unsupported", reason: `The confirmed permit-based NFPA 13 ${resolved.nfpa13Edition} basis is outside this NFPA 13-2025 local-change pack.`, missing: [], evidence: [...new Set(evidence)] };
  }
  if (resolved.status !== "resolved") {
    return {
      state: resolved.status === "not_applicable" ? "unsupported" : "input_missing",
      reason: resolved.status === "not_applicable" ? "The confirmed project basis is outside the implemented San Francisco NFPA 13-2025 change scope." : "The permit-based San Francisco NFPA 13-2025 edition basis is not established.",
      missing: [...new Set([...missing, ...resolved.missingInputs])],
      evidence: [...new Set(evidence)],
    };
  }
  if (missing.length) return { state: "input_missing", reason: "The local-change scope facts do not resolve to current permit/design evidence.", missing: [...new Set(missing)], evidence: [...new Set(evidence)] };
  const [system, sprinkler, storage, hazard] = checks.map(check => check.value);
  if (system !== "wet" || sprinkler !== "standard_spray" || storage !== "non_storage") {
    return { state: "unsupported", reason: "The confirmed system type, sprinkler type, or storage scope is outside this bounded local-change implementation; no code applicability is inferred.", missing: [], evidence: [...new Set(evidence)] };
  }
  if (!hazard) return { state: "input_missing", reason: "A confirmed hazard classification is required for this supported local-change scope.", missing: ["facts.hazardClassification"], evidence: [...new Set(evidence)] };
  if (hazard === "other") return { state: "unsupported", reason: "The confirmed hazard class is outside this bounded local-change scope; no hazard or design decision is inferred.", missing: [], evidence: [...new Set(evidence)] };
  const workType = checkFact(request, request.localChange?.changeRequest.systemWorkType, "localChange.changeRequest.systemWorkType", [request.localChange!.changeRequest.id], ["permit", "drawing"]);
  if (workType.issues.length) return { state: "input_missing", reason: "The project must distinguish new-system work from an existing-system modification.", missing: workType.issues, evidence: [...new Set([...evidence, ...workType.evidenceIds])] };
  if (workType.value === "new_system") return { state: "unimplemented", reason: "AB 2.04 I.22(A)(1) provides a separate new-system calculation pathway; this pack evaluates existing-system local changes only.", missing: [], evidence: [...new Set([...evidence, ...workType.evidenceIds])] };
  const existing = checkFact(request, request.localChange?.changeRequest.existingSystem, "localChange.changeRequest.existingSystem", [request.localChange!.changeRequest.id], ["permit", "drawing"]);
  if (existing.issues.length || existing.value !== "yes") return { state: "input_missing", reason: "The bounded change slice requires an independently confirmed existing sprinkler system.", missing: existing.issues.length ? existing.issues : ["existingSystem:yes"], evidence: [...new Set([...evidence, ...workType.evidenceIds, ...existing.evidenceIds])] };
  return { state: "verified", reason: "Permit-based NFPA 13-2025, wet standard-spray, non-storage, and existing-system local-change scope are established.", missing: [], evidence: [...new Set([...evidence, ...workType.evidenceIds, ...existing.evidenceIds])] };
}

function maskGeometry(result: LocalPlanGeometryResult, issues: readonly string[]): LocalPlanGeometryResult {
  if (!issues.length) return result;
  const datumPathFor = (segmentId: string) => `segments.${segmentId}.cutEndDatumAt`;
  const datumIssues = issues.filter(issue => result.segments.some(segment => issue.startsWith(datumPathFor(segment.segmentId))));
  const nonDatumIssues = issues.filter(issue => !datumIssues.includes(issue));
  if (datumIssues.length && !nonDatumIssues.length) {
    return {
      ...result,
      state: "input_missing",
      totalCutLengthM: null,
      segments: result.segments.map(segment => {
        const relevant = datumIssues.filter(issue => issue.startsWith(datumPathFor(segment.segmentId)));
        return relevant.length
          ? { ...segment, cutLengthM: null, state: "input_missing", missingInputs: [...new Set([...segment.missingInputs, ...relevant])] }
          : segment;
      }),
      missingInputs: [...new Set([...result.missingInputs, ...datumIssues])],
    };
  }
  return {
    ...result,
    state: "input_missing",
    totalCenterlineLengthM: null,
    totalCutLengthM: null,
    segments: result.segments.map(segment => ({ ...segment, centerlineLengthM: null, cutLengthM: null, outsideDiameterM: null, state: "input_missing", missingInputs: [...new Set([...segment.missingInputs, ...issues])] })),
    ductClearances: result.ductClearances.map(clearance => ({ ...clearance, state: "input_missing", distanceM: undefined, radiusM: undefined, marginM: undefined, missingInputs: [...new Set([...clearance.missingInputs, ...issues])] })),
    missingInputs: [...new Set([...result.missingInputs, ...issues])],
  };
}

function planRefFact(request: ProjectEvaluationRequest, plan: ProjectLocalPlan, path: string): FactCheck<DocumentRevisionRef> {
  return docFact(request, plan.sourceDrawing, path, [plan.id], ["drawing"]);
}

function compareStableContext(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput): { state: LocalChangeVerificationState; changedIds: string[]; missing: string[]; evidence: string[] } {
  const { baseline, proposed, changeRequest } = input;
  const change = checkFact(request, changeRequest.affectedEntityIds, "changeRequest.affectedEntityIds", [changeRequest.id], ["permit", "drawing"]);
  const affected = new Set(change.value ?? []);
  const changedIds: string[] = [];
  const missing = [...change.issues];
  const evidence = [...change.evidenceIds];
  const planA = planRefFact(request, baseline, "baseline.sourceDrawing");
  const planB = planRefFact(request, proposed, "proposed.sourceDrawing");
  missing.push(...planA.issues, ...planB.issues);
  evidence.push(...planA.evidenceIds, ...planB.evidenceIds);
  if (baseline.coordinateFrame.value?.id !== proposed.coordinateFrame.value?.id) return { state: "unsupported", changedIds, missing: [...new Set([...missing, "coordinateFrame.id:mismatch"])], evidence: [...new Set(evidence)] };
  const compareContexts = <T>(name: string, before: readonly T[], after: readonly T[], idOf: (item: T) => string, shape: (item: T) => string | undefined) => {
    const beforeMap = new Map(before.map(item => [idOf(item), shape(item)]));
    const afterMap = new Map(after.map(item => [idOf(item), shape(item)]));
    const ids = new Set([...beforeMap.keys(), ...afterMap.keys()]);
    for (const id of ids) {
      if (beforeMap.get(id) === afterMap.get(id)) continue;
      changedIds.push(id);
      if (!affected.has(id)) missing.push(`${name}.${id}.affectedEntityIds`);
    }
  };
  const roomShape = (room: ProjectLocalPlan["rooms"][number]) => room.ceiling.value ? JSON.stringify({ id: room.ceiling.value.id, kind: room.ceiling.value.kind, heightM: room.ceiling.value.height.value * lengthFactor[room.ceiling.value.height.unit] }) : undefined;
  const ductShape = (duct: ProjectLocalPlan["ducts"][number]) => {
    const value = duct.geometry.value;
    if (!value || value.kind !== "axis_aligned_box") return value ? JSON.stringify(value) : undefined;
    const point = (point: typeof value.min) => pointMeters(point);
    const min = point(value.min); const max = point(value.max);
    return min && max ? JSON.stringify({ roomId: duct.roomId, min, max }) : undefined;
  };
  const tieIns = (plan: ProjectLocalPlan) => plan.nodes.filter(node => node.kind === "tie_in");
  const tieShape = (node: ProjectLocalPlan["nodes"][number]) => {
    const point = node.position.value && pointMeters(node.position.value);
    const offset = node.tieInNetCutOffset?.value;
    return point ? JSON.stringify({ point, offset: offset ? offset.value * lengthFactor[offset.unit] : null }) : undefined;
  };
  compareContexts("room", baseline.rooms, proposed.rooms, room => room.id, roomShape);
  compareContexts("duct", baseline.ducts, proposed.ducts, duct => duct.id, ductShape);
  compareContexts("tieIn", tieIns(baseline), tieIns(proposed), node => node.id, tieShape);
  return { state: missing.length ? "input_missing" : "verified", changedIds: [...new Set(changedIds)], missing: [...new Set(missing)], evidence: [...new Set(evidence)] };
}

function headChanges(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput): { deltas: ProjectLocalHeadDelta[]; issues: string[]; evidence: string[]; moved: string[] } {
  const { baseline, proposed } = input;
  const old = new Map(baseline.heads.map(head => [head.headId, head]));
  const next = new Map(proposed.heads.map(head => [head.headId, head]));
  const ids = new Set([...old.keys(), ...next.keys()]);
  const deltas: ProjectLocalHeadDelta[] = [];
  const issues: string[] = [];
  const evidence: string[] = [];
  const moved: string[] = [];
  for (const id of ids) {
    const before = old.get(id); const after = next.get(id);
    if (!before || !after) {
      deltas.push({ headId: id, moved: null, distanceM: null, baselinePosition: null, proposedPosition: null, roomId: after?.roomId ?? before?.roomId ?? null, ceilingId: after?.ceilingId ?? before?.ceilingId ?? null, state: "input_missing", missingInputs: [`head.${id}.matchingBaselineAndProposal`] });
      issues.push(`head.${id}.matchingBaselineAndProposal`);
      continue;
    }
    const a = checkFact(request, before.position, `baseline.heads.${id}.position`, [id, baseline.id], ["drawing"], baseline.sourceDrawing.value ?? undefined);
    const b = checkFact(request, after.position, `proposed.heads.${id}.position`, [id, proposed.id], ["drawing"], proposed.sourceDrawing.value ?? undefined);
    evidence.push(...a.evidenceIds, ...b.evidenceIds);
    const pA = a.value && pointMeters(a.value); const pB = b.value && pointMeters(b.value);
    const frameMatch = pA && pB && a.value!.frameId === b.value!.frameId && a.value!.frameId === baseline.coordinateFrame.value?.id;
    if (a.issues.length || b.issues.length || !frameMatch) {
      const missing = [...a.issues, ...b.issues, ...(!frameMatch ? [`head.${id}.sameCoordinateFrame`] : [])];
      issues.push(...missing);
      deltas.push({ headId: id, moved: null, distanceM: null, baselinePosition: pA ? { x: pA[0], y: pA[1], z: pA[2], unit: "m", frameId: a.value!.frameId } : null, proposedPosition: pB ? { x: pB[0], y: pB[1], z: pB[2], unit: "m", frameId: b.value!.frameId } : null, roomId: after.roomId, ceilingId: after.ceilingId, state: "input_missing", missingInputs: [...new Set(missing)] });
      continue;
    }
    const distance = Math.hypot(pB![0] - pA![0], pB![1] - pA![1], pB![2] - pA![2]);
    if (!Number.isFinite(distance)) {
      issues.push(`head.${id}.distance`);
      deltas.push({ headId: id, moved: null, distanceM: null, baselinePosition: null, proposedPosition: null, roomId: after.roomId, ceilingId: after.ceilingId, state: "unsupported", missingInputs: [`head.${id}.distance`] });
      continue;
    }
    // Room/ceiling references are part of the head location. A changed reference
    // still requires relocation review even when the coordinates are unchanged.
    const hasMoved = distance > 0 || after.roomId !== before.roomId || after.ceilingId !== before.ceilingId;
    if (hasMoved) moved.push(id);
    deltas.push({ headId: id, moved: hasMoved, distanceM: distance, baselinePosition: { x: pA![0], y: pA![1], z: pA![2], unit: "m", frameId: a.value!.frameId }, proposedPosition: { x: pB![0], y: pB![1], z: pB![2], unit: "m", frameId: b.value!.frameId }, roomId: after.roomId, ceilingId: after.ceilingId, state: "verified", missingInputs: [] });
  }
  return { deltas, issues: [...new Set(issues)], evidence: [...new Set(evidence)], moved };
}

function bomDeltas(
  request: ProjectEvaluationRequest,
  input: ProjectLocalChangeInput,
  baselineGeometry: LocalPlanGeometryResult,
  proposedGeometry: LocalPlanGeometryResult,
): { output: ProjectLocalChangeReport["bomDeltas"]; missing: string[]; evidence: string[]; status: RuleStatus; verificationState: LocalChangeVerificationState; reason: string } {
  const old = new Map((input.baseline.bom ?? []).map(line => [line.itemId, line]));
  const next = new Map((input.proposed.bom ?? []).map(line => [line.itemId, line]));
  const missing: string[] = [];
  const evidence: string[] = [];
  const mismatches: string[] = [];
  const unknownRows: string[] = [];
  const derive = (plan: ProjectLocalPlan, geometry: LocalPlanGeometryResult) => {
    const map = new Map<string, { kind: ProjectLocalBomLine["kind"]; quantity: number; cutLengthM: number | null }>();
    for (const segment of plan.segments) map.set(segment.id, { kind: "pipe", quantity: 1, cutLengthM: geometry.segments.find(item => item.segmentId === segment.id)?.cutLengthM ?? null });
    for (const fitting of plan.fittings) map.set(fitting.id, { kind: "fitting", quantity: 1, cutLengthM: null });
    for (const head of plan.heads) map.set(head.headId, { kind: "head", quantity: 1, cutLengthM: null });
    for (const support of plan.supports) map.set(support.supportId, { kind: "support", quantity: 1, cutLengthM: null });
    return map;
  };
  const derivedOld = derive(input.baseline, baselineGeometry);
  const derivedNext = derive(input.proposed, proposedGeometry);
  const allIds = new Set([...derivedOld.keys(), ...derivedNext.keys(), ...old.keys(), ...next.keys()]);
  if (allIds.size === 0) missing.push("baseline/proposed.planParts");
  const output = [...allIds].map(itemId => {
    const a = old.get(itemId); const b = next.get(itemId);
    const derivedA = derivedOld.get(itemId); const derivedB = derivedNext.get(itemId);
    const factCheck = (line: typeof a, plan: ProjectLocalPlan) => line ? checkFact(request, line.quantity, `${plan.id}.bom.${line.itemId}.quantity`, [line.itemId, plan.id], ["drawing"], plan.sourceDrawing.value ?? undefined) : { issues: [] as string[], evidenceIds: [] as string[] };
    const qaCheck = factCheck(a, input.baseline); const qbCheck = factCheck(b, input.proposed);
    missing.push(...qaCheck.issues, ...qbCheck.issues); evidence.push(...qaCheck.evidenceIds, ...qbCheck.evidenceIds);
    const validQty = (line: typeof a, checked: { issues: string[] }) => line?.quantity?.confirmed && line.quantity.source !== "model" && line.quantity.value !== null && !checked.issues.length ? line.quantity.value : null;
    const qa = validQty(a, qaCheck); const qb = validQty(b, qbCheck);
    let cutA: number | null = null; let cutB: number | null = null;
    const cutFact = (line: typeof a, plan: ProjectLocalPlan) => line?.cutLength ? checkFact(request, line.cutLength, `${plan.id}.bom.${line.itemId}.cutLength`, [line.itemId, plan.id], ["drawing"], plan.sourceDrawing.value ?? undefined) : undefined;
    const caCheck = cutFact(a, input.baseline); const cbCheck = cutFact(b, input.proposed);
    if (caCheck) { missing.push(...caCheck.issues); evidence.push(...caCheck.evidenceIds); }
    if (cbCheck) { missing.push(...cbCheck.issues); evidence.push(...cbCheck.evidenceIds); }
    if (a?.cutLength?.value && !caCheck?.issues.length) cutA = a.cutLength.value.value * lengthFactor[a.cutLength.value.unit];
    if (b?.cutLength?.value && !cbCheck?.issues.length) cutB = b.cutLength.value.value * lengthFactor[b.cutLength.value.unit];
    if (a && derivedA && derivedA.kind !== a.kind) mismatches.push(`${itemId}.baselineKind`);
    if (b && derivedB && derivedB.kind !== b.kind) mismatches.push(`${itemId}.proposedKind`);
    if (a && derivedA && qa !== null && qa !== derivedA.quantity) mismatches.push(`${itemId}.baselineQuantity`);
    if (b && derivedB && qb !== null && qb !== derivedB.quantity) mismatches.push(`${itemId}.proposedQuantity`);
    if (a && !derivedA) unknownRows.push(`${itemId}.baselineUnmodeledPart`);
    if (b && !derivedB) unknownRows.push(`${itemId}.proposedUnmodeledPart`);
    if (a?.kind === "pipe" && derivedA && (cutA === null || derivedA.cutLengthM === null)) missing.push(`${itemId}.baselineCutLength`);
    if (b?.kind === "pipe" && derivedB && (cutB === null || derivedB.cutLengthM === null)) missing.push(`${itemId}.proposedCutLength`);
    if (a?.kind === "pipe" && cutA !== null && derivedA?.cutLengthM !== null && derivedA?.cutLengthM !== undefined && cutA !== derivedA.cutLengthM) mismatches.push(`${itemId}.baselineCutLength`);
    if (b?.kind === "pipe" && cutB !== null && derivedB?.cutLengthM !== null && derivedB?.cutLengthM !== undefined && cutB !== derivedB.cutLengthM) mismatches.push(`${itemId}.proposedCutLength`);
    const baselineSideVerified = !derivedA && !a || !!derivedA && !!a && qa !== null && (a.kind !== "pipe" || cutA !== null && derivedA.cutLengthM !== null);
    const proposedSideVerified = !derivedB && !b || !!derivedB && !!b && qb !== null && (b.kind !== "pipe" || cutB !== null && derivedB.cutLengthM !== null);
    const baselineQuantity = qa ?? (!derivedA ? 0 : null);
    const proposedQuantity = qb ?? (!derivedB ? 0 : null);
    const baselineCutLengthM = derivedA?.kind === "pipe" && derivedA.cutLengthM === null ? null : cutA ?? (derivedA ? derivedA.cutLengthM : 0);
    const proposedCutLengthM = derivedB?.kind === "pipe" && derivedB.cutLengthM === null ? null : cutB ?? (derivedB ? derivedB.cutLengthM : 0);
    const state: LocalChangeVerificationState = baselineSideVerified && proposedSideVerified && !unknownRows.some(row => row.startsWith(`${itemId}.`)) ? "verified" : "input_missing";
    const kind = (derivedB ?? derivedA)?.kind ?? (b ?? a)!.kind;
    return {
      itemId,
      kind,
      baselineQuantity,
      proposedQuantity,
      quantityDelta: baselineQuantity !== null && proposedQuantity !== null ? proposedQuantity - baselineQuantity : null,
      baselineCutLengthM,
      proposedCutLengthM,
      cutLengthDeltaM: baselineCutLengthM !== null && proposedCutLengthM !== null ? proposedCutLengthM - baselineCutLengthM : null,
      derivedBaselineQuantity: derivedA?.quantity ?? 0,
      derivedProposedQuantity: derivedB?.quantity ?? 0,
      baselineMatchesDerived: a && derivedA && qa !== null ? qa === derivedA.quantity : !a && !derivedA ? true : null,
      proposedMatchesDerived: b && derivedB && qb !== null ? qb === derivedB.quantity : !b && !derivedB ? true : null,
      state,
    };
  });
  for (const [side, lines, derived] of [["baseline", old, derivedOld], ["proposed", next, derivedNext]] as const) {
    for (const id of derived.keys()) if (!lines.has(id)) missing.push(`${side}.bom.${id}`);
  }
  const status: RuleStatus = mismatches.length ? "fail" : missing.length || unknownRows.length ? "unknown" : "pass";
  return {
    output,
    missing: [...new Set([...missing, ...mismatches, ...unknownRows])],
    evidence: [...new Set(evidence)],
    status,
    verificationState: mismatches.length ? "verified" : missing.length || unknownRows.length ? "input_missing" : "verified",
    reason: mismatches.length ? `Supplied BOM rows disagree with derived plan items: ${[...new Set(mismatches)].join(", ")}.` : missing.length || unknownRows.length ? "A confirmed supplied BOM row and current evidence are required for every derived baseline/proposed pipe, fitting, head, and support. Unmodeled 'other' lines remain visible and unknown." : "Every supplied BOM row matches the derived plan item kind, quantity, and reported cut length. This is material-accounting consistency only, not installation or code compliance.",
  };
}

function sourceDrawingCheck(request: ProjectEvaluationRequest, plan: ProjectLocalPlan, side: "baseline" | "proposed"): FactCheck<DocumentRevisionRef> {
  return docFact(request, plan.sourceDrawing, `${side}.sourceDrawing`, [plan.id], ["drawing"]);
}

function normalizePressure(value: { value: number; unit: "Pa" | "kPa" | "bar" | "psi" }) {
  return normalizeProjectQuantity({ value: value.value, unit: value.unit } as ProjectQuantity, "pressure");
}

function pressureReport(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput): { output: ProjectLocalChangeReport["pressureChecks"]; result: ProjectRuleResult } {
  const systemFact = checkFact(request, input.systemMaximumWorkingPressure, "localChange.systemMaximumWorkingPressure", [request.project.id, input.id], ["calculation"]);
  const systemValue = systemFact.value;
  const systemIsMax = systemValue?.basis === "system_maximum";
  const systemPsi = systemIsMax && !systemFact.issues.length ? normalizePressure(systemValue).value : null;
  const candidates = [
    ...input.proposed.segments.map(item => ({ id: item.id, kind: "pipe" as const, rating: item.pressureRating })),
    ...input.proposed.fittings.map(item => ({ id: item.id, kind: "fitting" as const, rating: item.pressureRating })),
  ];
  const output = candidates.map(item => {
    const ratingEvidence = checkFact(request, item.rating, `proposed.${item.kind}.${item.id}.pressureRating`, [item.id, input.proposed.id], ["drawing"]);
    const rating = item.rating.value && !ratingEvidence.issues.length ? normalizePressure(item.rating.value).value : null;
    const ids = [...new Set([...systemFact.evidenceIds, ...ratingEvidence.evidenceIds])];
    const state = systemFact.issues.length || !systemValue || !systemIsMax || ratingEvidence.issues.length || rating === null ? "input_missing" as const : "source_pending" as const;
    return {
      partId: item.id,
      partKind: item.kind,
      systemMaximumPressure: systemValue ? { value: systemValue.value, unit: systemValue.unit, basis: systemValue.basis } : null,
      partPublishedPressureRating: rating !== null && item.rating.value ? { value: item.rating.value.value, unit: item.rating.value.unit } : null,
      comparison: systemPsi !== null && rating !== null ? (systemPsi > rating ? "system_exceeds_reported_rating" as const : "system_not_above_reported_rating" as const) : null,
      state,
      evidenceIds: ids,
      missingInputs: [...new Set([...systemFact.issues, ...(!systemIsMax ? ["systemMaximumWorkingPressure.basis:system_maximum"] : []), ...ratingEvidence.issues, ...(!rating ? [`${item.id}.pressureRating`] : []), ...(state === "source_pending" ? ["serviceFluidTemperature", "manufacturerPressureRatingConditions"] : [])])],
    };
  });
  const state: LocalChangeVerificationState = systemFact.issues.length || !systemValue || !systemIsMax || output.some(item => item.state === "input_missing") ? "input_missing" : "source_pending";
  return {
    output,
    result: result(request, "LOCAL_CHANGE_PART_PRESSURE_COMPATIBILITY_V1", "Part pressure rating against confirmed system maximum", "unknown", state,
      "The system maximum must be calculation-backed and labeled system_maximum. Part ratings are exposed for comparison, but pressure compatibility stays unresolved until the selected manufacturer revision and service-temperature conditions are established; a spot reading or design-intent value is not a system maximum.",
      [input.id, ...candidates.map(item => item.id)], [], [...systemFact.evidenceIds, ...candidates.flatMap(item => item.rating.evidenceIds)],
      [...systemFact.issues, ...(!systemIsMax ? ["systemMaximumWorkingPressure.basis:system_maximum"] : []), ...output.flatMap(item => item.missingInputs)]),
  };
}

function localIds(input: ProjectLocalChangeInput): void {
  const plans = [input.baseline, input.proposed];
  if (new Set(plans.map(plan => plan.id)).size !== 2 || input.id === input.baseline.id || input.id === input.proposed.id || input.changeRequest.id === input.id || plans.some(plan => plan.id === input.changeRequest.id)) {
    throw new ProjectInputError("duplicate_id", "Local-change, baseline-plan, and proposed-plan IDs must be unique.", ["localChange.id", "localChange.baseline.id", "localChange.proposed.id"]);
  }
  for (const plan of plans) {
    const ids = [
      ...plan.nodes.map(item => item.id), ...plan.segments.map(item => item.id), ...plan.fittings.map(item => item.id),
      ...plan.ducts.map(item => item.id), ...plan.rooms.map(item => item.id), ...plan.heads.map(item => item.headId),
      ...plan.supports.map(item => item.supportId),
    ];
    if (new Set(ids).size !== ids.length) throw new ProjectInputError("duplicate_id", `Entity IDs in plan '${plan.id}' must be unique.`, [`localChange.${plan.id}`]);
    const bomIds = (plan.bom ?? []).map(item => item.itemId);
    if (new Set(bomIds).size !== bomIds.length) throw new ProjectInputError("duplicate_id", `BOM item IDs in plan '${plan.id}' must be unique.`, [`localChange.${plan.id}.bom`]);
  }
}

/** Computes a bounded local-change report and per-check results; it is not a project verdict. */
export function evaluateLocalChange(request: ProjectEvaluationRequest): { rules: ProjectRuleResult[]; report: ProjectLocalChangeReport } {
  const input = request.localChange;
  if (!input) throw new Error("localChange is required for the local-change pack");
  localIds(input);
  const rules: ProjectRuleResult[] = [];
  const requiredArtifacts: ProjectLocalChangeReport["requiredArtifacts"] = [];
  const scope = scopeState(request);
  rules.push(result(request, "SFFD_LOCAL_CHANGE_SCOPE_V1", "Supported San Francisco local-change scope", scope.state === "verified" ? "pass" : "unknown", scope.state, scope.reason, [input.id], SOURCES.scope, scope.evidence, scope.missing));

  const approval = approvedBaselineContext(request, input);
  const { approvedDoc, baselineDrawing } = approval;
  rules.push(approvedBaselineCheck(request, input, approval));

  const drawing = proposedDrawingContext(request, input, approvedDoc);
  const { proposedDrawing } = drawing;
  rules.push(drawingLineageCheck(request, input, drawing));

  const geometry = localGeometryContext(request, input);
  const { baseline, proposed, delta, stable } = geometry;
  const clearances = proposed.ductClearances;
  rules.push(routeGeometryCheck(request, input, geometry));

  rules.push(ductEnvelopeCheck(request, input, geometry));

  const interfaces = interfaceChecks(request, input);
  rules.push(interfaces.result);
  const bomResult = bomDeltas(request, input, baseline, proposed);
  const bom = bomResult.output;
  rules.push(bomAccountingCheck(request, input, bomResult));

  const headContext = localHeadContext(request, input, delta);
  const { heads, routeChanged, listedHeads } = headContext;
  rules.push(headNeighborhoodCheck(request, input, headContext));
  rules.push(unknownResult(request, "NFPA13_LOCAL_HEAD_SPACING_SOURCE_PENDING_V1", "Head spacing and coverage after the proposed change", "source_pending", NFPA_REASON, [input.id, ...listedHeads], SOURCES.pending, ["NFPA13.headSpacingAndCoverage"]));
  rules.push(unknownResult(request, "NFPA13_LOCAL_OBSTRUCTION_SOURCE_PENDING_V1", "Sprinkler discharge obstruction after the proposed change", "source_pending", "A clear modeled straight-pipe/duct envelope is not a discharge-obstruction determination. The applicable NFPA 13-2025 obstruction clauses and project inputs are not implemented.", [input.id, ...listedHeads, ...clearances.map(item => item.ductId)], SOURCES.pending, ["NFPA13.obstructionCriteria"]));

  const relocation = headRelocationCheck(request, input, heads, drawing);
  rules.push(...relocation.rules);
  requiredArtifacts.push(...relocation.requiredArtifacts);

  const supportChanged = input.baseline.supports.length !== input.proposed.supports.length || input.proposed.supports.some(support => !input.baseline.supports.some(prior => prior.supportId === support.supportId && JSON.stringify(prior.attachedPipeSegmentIds.value) === JSON.stringify(support.attachedPipeSegmentIds.value)));
  if (supportChanged || routeChanged || heads.moved.length > 0) {
    rules.push(unknownResult(request, "SFFD_LOCAL_CHANGE_SUPPORT_DESIGN_REVIEW_V1", "Affected hanger and brace details need design review", "unimplemented", "The changed support/pipe neighborhood is identified, but this slice does not evaluate hanger selection, fasteners, loads, spacing, capacity, or structural adequacy. SFFD AB 2.04 I.21 requests affected support details; NFPA §18.5 numeric criteria remain source-pending.", [input.id, ...input.proposed.supports.map(support => support.supportId)], SOURCES.supports, ["supportTypeManufacturerSizeFigure", "fastenerSubstrateEmbedment", "braceLoadCalculation", "NFPA18.5.capacityAndSpacing"]));
  }

  const hydraulic = hydraulicCheck(request, input);
  rules.push(hydraulic.result);
  if (hydraulic.artifact) requiredArtifacts.push(hydraulic.artifact);

  const deviation = fieldDeviationCheck(request, input);
  rules.push(...deviation.rules);
  requiredArtifacts.push(...deviation.requiredArtifacts);

  const pressure = pressureReport(request, input);
  rules.push(pressure.result);
  const localReport: ProjectLocalChangeReport = {
    version: "1",
    ruleIds: rules.map(item => item.ruleId),
    baseline: { ...baseline, sourceDrawing: baselineDrawing.value ?? null },
    proposed: { ...proposed, sourceDrawing: proposedDrawing.value ?? null },
    delta,
    stableContextState: stable.state,
    changedContextIds: stable.changedIds,
    headDeltas: heads.deltas,
    bomDeltas: bom,
    pressureChecks: pressure.output,
    requiredArtifacts,
    physicalClearanceMeaning: "modeled_straight_pipe_envelope_only",
  };
  return { rules, report: localReport };
}

function compareGeometry(baseline: LocalPlanGeometryResult, proposed: LocalPlanGeometryResult): ProjectLocalChangeReport["delta"] {
  const elbowCountKnown = (result: LocalPlanGeometryResult) =>
    ![...result.missingInputs, ...result.unsupported].some(path => path.startsWith("fittings[") && path.includes("].kind"));
  const state = baseline.state === "unsupported" || proposed.state === "unsupported" ? "unsupported" : baseline.state !== "verified" || proposed.state !== "verified" ? "input_missing" : "verified";
  return {
    baselinePlanId: baseline.planId,
    proposedPlanId: proposed.planId,
    state,
    pipeCountDelta: proposed.segmentCount - baseline.segmentCount,
    elbowCountDelta: elbowCountKnown(baseline) && elbowCountKnown(proposed) ? proposed.elbowCount - baseline.elbowCount : null,
    centerlineLengthDeltaM: baseline.totalCenterlineLengthM !== null && proposed.totalCenterlineLengthM !== null
      ? proposed.totalCenterlineLengthM - baseline.totalCenterlineLengthM
      : null,
    cutLengthDeltaM: baseline.totalCutLengthM !== null && proposed.totalCutLengthM !== null
      ? proposed.totalCutLengthM - baseline.totalCutLengthM
      : null,
  };
}

function interfaceChecks(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput): { result: ProjectRuleResult } {
  const mismatches: string[] = [];
  const unresolved: string[] = [];
  const evidence: string[] = [];
  const partIds: string[] = [input.id];
  const nominal = (value: string) => value.trim().toUpperCase().replace(/\s+/g, "");
  const standard = (value: string) => value.trim().toUpperCase().replace(/\s+/g, "");
  for (const fitting of input.proposed.fittings) {
    partIds.push(fitting.id);
    for (const port of fitting.ports) {
      const segment = input.proposed.segments.find(item => item.id === port.segmentId);
      partIds.push(port.segmentId);
      if (!segment) { unresolved.push(`fittings.${fitting.id}.ports.${port.segmentId}`); continue; }
      const fitSize = checkFact(request, fitting.nominalSize, `fittings.${fitting.id}.nominalSize`, [fitting.id], ["drawing"]);
      const pipeSize = checkFact(request, segment.nominalSize, `segments.${segment.id}.nominalSize`, [segment.id], ["drawing"]);
      const pipeEnd = port.endpoint === "start" ? segment.connectionAtStart : segment.connectionAtEnd;
      const checkedPipeEnd = checkFact(request, pipeEnd, `segments.${segment.id}.connectionAt${port.endpoint}`, [segment.id], ["drawing"]);
      const checkedFitConnection = checkFact(request, port.connection, `fittings.${fitting.id}.ports.${port.segmentId}.connection`, [fitting.id], ["drawing"]);
      const checks = [fitSize, pipeSize, checkedPipeEnd, checkedFitConnection];
      evidence.push(...checks.flatMap(item => item.evidenceIds));
      unresolved.push(...checks.flatMap(item => item.issues));
      if (fitSize.value && pipeSize.value) {
        const fittingSize = nominal(fitSize.value); const segmentSize = nominal(pipeSize.value);
        const knownSameFamily = (/^NPS\d/.test(fittingSize) && /^NPS\d/.test(segmentSize)) || (/^DN\d/.test(fittingSize) && /^DN\d/.test(segmentSize)) || (/^\d/.test(fittingSize) && /^\d/.test(segmentSize));
        if (knownSameFamily && fittingSize !== segmentSize) mismatches.push(`${fitting.id}/${segment.id}.nominalSize`);
        else if (!knownSameFamily) unresolved.push(`${fitting.id}/${segment.id}.nominalSize.family`);
      }
      if (checkedPipeEnd.value && checkedFitConnection.value) {
        if (standard(checkedPipeEnd.value.standard) !== standard(checkedFitConnection.value.standard)) mismatches.push(`${segment.id}/${fitting.id}.connection.standard`);
        if (checkedPipeEnd.value.gender !== "other" && checkedFitConnection.value.gender !== "other" && checkedPipeEnd.value.gender === checkedFitConnection.value.gender) mismatches.push(`${segment.id}/${fitting.id}.connection.gender`);
        if (checkedPipeEnd.value.gender === "other" || checkedFitConnection.value.gender === "other") unresolved.push(`${segment.id}/${fitting.id}.connection.gender:unsupported`);
      }
    }
  }
  const status: RuleStatus = mismatches.length ? "fail" : "unknown";
  const state: LocalChangeVerificationState = mismatches.length ? "verified" : unresolved.length ? "input_missing" : "source_pending";
  return { result: result(request, "LOCAL_CHANGE_CONFIRMED_INTERFACE_SCREEN_V1", "Confirmed nominal size and connection interface screen", status, state,
    mismatches.length ? `Confirmed connector size/standard/gender mismatch: ${mismatches.join(", ")}. This is an interface screen and does not establish product approval or pressure suitability.` : "No independently confirmed size/standard/gender mismatch was found, but exact selected product and joint compatibility remain unknown until current applicable manufacturer evidence is linked. Material names are not compared for string equality.",
    partIds, [], evidence, [...new Set([...unresolved, ...(mismatches.length ? [] : ["selectedProductPairCompatibility", "materialCombinationApplicability"])])] ) };
}

function hydraulicCheck(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput): { result: ProjectRuleResult; artifact?: ProjectLocalChangeReport["requiredArtifacts"][number] } {
  const c = input.changeRequest;
  const fields = [c.remoteAreaChanged, c.hazardBecameMoreDemanding, c.waterSupplyRoutingOrBackflowChanged];
  const paths = ["remoteAreaChanged", "hazardBecameMoreDemanding", "waterSupplyRoutingOrBackflowChanged"];
  const checks = fields.map((fact, index) => checkFact(request, fact, `changeRequest.${paths[index]}`, [c.id], ["permit", "drawing", "calculation"]));
  const evidence = checks.flatMap(item => item.evidenceIds);
  const missing = checks.flatMap(item => item.issues);
  const positive = checks.some(item => item.value === "yes");
  const allNo = checks.every(item => !item.issues.length && item.value === "no");
  const workType = checkFact(request, c.systemWorkType, "changeRequest.systemWorkType", [c.id], ["permit", "drawing"]);
  if (workType.issues.length) missing.push(...workType.issues);
  if (workType.value === "new_system") return { result: unknownResult(request, "SFFD_AB204_NEW_SYSTEM_HYDRAULIC_PATH_I22A1_V1", "New-system hydraulic calculation pathway", "unimplemented", "AB 2.04 I.22(A)(1) separately addresses all new systems; this pack does not evaluate that pathway.", [input.id], [ref(9, "I.22(A)(1)", "Hydraulic calculations for all new systems, subject to the applicable NFPA 13R/13D provisions.")], ["newSystemHydraulicCalculationReview"], workType.evidenceIds) };
  if (workType.value !== "existing_system_modification") return { result: unknownResult(request, "SFFD_AB204_HYDRAULIC_RECALC_I22A2_V1", "Existing-system hydraulic recalculation trigger review", "input_missing", "New-system versus existing-system modification scope must be confirmed before applying I.22(A)(2).", [input.id], SOURCES.hydraulic, missing, evidence) };
  if (positive) {
    const check = calculationLink(request, input);
    const artifact = { id: "SFFD_AB204_REVISED_HYDRAULIC_CALCULATIONS_I22A2", title: "Updated hydraulic calculations for the changed system", state: "required" as const, reason: "A confirmed I.22(A)(2)(a)-(c) trigger requires hydraulic calculations.", subjectIds: [input.id, ...input.changeRequest.affectedEntityIds.value ?? []], sourceRefs: SOURCES.hydraulic };
    return { result: result(request, "SFFD_AB204_HYDRAULIC_RECALC_I22A2_V1", "Hydraulic recalculation and revision link", check.status, check.state,
      check.ok ? "A revised calculation is linked to the proposed drawing revision, baseline calculation reference points, and affected entities. This checks lineage only, not hydraulic adequacy." : check.reason,
      [input.id, ...input.changeRequest.affectedEntityIds.value ?? []], SOURCES.hydraulic, [...evidence, ...check.evidence], [...missing, ...check.missing]), artifact };
  }
  if (!allNo) return { result: unknownResult(request, "SFFD_AB204_HYDRAULIC_RECALC_I22A2_V1", "Existing-system hydraulic recalculation trigger review", "input_missing", "At least one named recalculation trigger is not resolved by current evidence.", [input.id], SOURCES.hydraulic, missing.length ? missing : ["changeRequest.hydraulicTriggerFacts"], evidence) };
  const direction = checkFact(request, c.caseByCaseHydraulicDecision, "changeRequest.caseByCaseHydraulicDecision", [c.id], ["permit", "calculation"]);
  if (direction.issues.length || !direction.value) return { result: unknownResult(request, "SFFD_AB204_HYDRAULIC_RECALC_I22A2_V1", "Case-by-case hydraulic calculation direction", "input_missing", "No named trigger is confirmed. AB 2.04 I.22(A)(2)(d) leaves other cases to the authority; no length-based assumption is made.", [input.id], SOURCES.hydraulic, direction.issues.length ? direction.issues : ["caseByCaseHydraulicDecision"], [...evidence, ...direction.evidenceIds]) };
  if (direction.value === "no_additional_calculation_directed") return { result: result(request, "SFFD_AB204_HYDRAULIC_RECALC_I22A2_V1", "Case-by-case hydraulic calculation direction", "pass", "verified", "A current project-specific authority record resolves only the residual I.22(A)(2)(d) branch as no additional calculations directed; it cannot override a named trigger.", [input.id], SOURCES.hydraulic, [...evidence, ...direction.evidenceIds]) };
  const check = calculationLink(request, input);
  const artifact = { id: "SFFD_AB204_REVISED_HYDRAULIC_CALCULATIONS_CASE_BY_CASE", title: "Updated hydraulic calculations directed by the authority", state: "required" as const, reason: "A project-specific I.22(A)(2)(d) direction requires recalculation.", subjectIds: [input.id], sourceRefs: SOURCES.hydraulic };
  return { result: result(request, "SFFD_AB204_HYDRAULIC_RECALC_I22A2_V1", "Case-by-case hydraulic calculation direction", check.status, check.state, check.ok ? "The directed revised calculation is linked to the proposed drawing and affected entities/reference points; adequacy remains unverified." : check.reason, [input.id], SOURCES.hydraulic, [...evidence, ...direction.evidenceIds, ...check.evidence], [...missing, ...check.missing]), artifact };
}

function calculationLink(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput): { ok: boolean; status: RuleStatus; state: LocalChangeVerificationState; reason: string; missing: string[]; evidence: string[] } {
  const affected = checkFact(request, input.changeRequest.affectedEntityIds, "changeRequest.affectedEntityIds", [input.changeRequest.id], ["permit", "drawing"]);
  const baseline = checkFact(request, input.baselineCalculation, "baselineCalculation", [input.id], ["calculation"], input.baselineCalculation?.value ? { documentId: input.baselineCalculation.value.documentId, revision: input.baselineCalculation.value.revision, edition: input.baselineCalculation.value.edition } : undefined);
  const revised = checkFact(request, input.revisedCalculation, "revisedCalculation", [input.id], ["calculation"], input.revisedCalculation?.value ? { documentId: input.revisedCalculation.value.documentId, revision: input.revisedCalculation.value.revision, edition: input.revisedCalculation.value.edition } : undefined);
  const missing = [...affected.issues, ...baseline.issues, ...revised.issues];
  const evidence = [...affected.evidenceIds, ...baseline.evidenceIds, ...revised.evidenceIds];
  const b = baseline.value; const r = revised.value;
  if (!b || !r || missing.length) return { ok: false, status: "unknown", state: "input_missing", reason: "A baseline calculation and revised calculation must each resolve to current calculation evidence before their scope and reference points can be compared.", missing: [...new Set([...missing, ...(!b ? ["baselineCalculation"] : []), ...(!r ? ["revisedCalculation"] : [])])], evidence };
  const conflicts: string[] = [];
  if (!sameRevision(b.drawing, input.baseline.sourceDrawing.value)) conflicts.push("baselineCalculation.drawing:baseline.sourceDrawing");
  if (!sameRevision(r.drawing, input.proposed.sourceDrawing.value)) conflicts.push("revisedCalculation.drawing:proposed.sourceDrawing");
  const targetIds = affected.value ?? [];
  if (!targetIds.length || targetIds.some(id => !b.affectedEntityIds.includes(id) || !r.affectedEntityIds.includes(id))) conflicts.push("calculation.affectedEntityIds:changeRequest");
  const baselineRefs = [...b.referencePointIds].sort(); const revisedRefs = [...r.referencePointIds].sort();
  if (!baselineRefs.length || !revisedRefs.length || JSON.stringify(baselineRefs) !== JSON.stringify(revisedRefs)) conflicts.push("calculation.referencePointIds:baselineAndRevisedMustMatch");
  if (conflicts.length) return { ok: false, status: "fail", state: "verified", reason: `Calculation document links conflict with the required drawing revision, affected targets, or shared reference points (${conflicts.join(", ")}).`, missing: conflicts, evidence };
  return { ok: true, status: "pass", state: "verified", reason: "Baseline and revised calculation metadata are linked to the corresponding drawings and share the changed targets/reference points; calculation adequacy is not assessed.", missing: [], evidence };
}

export interface LocalChangeRuleOutput {
  rules: ProjectRuleResult[];
  requiredArtifacts: ProjectLocalChangeReport["requiredArtifacts"];
}

/** Execute a single check through the same verdict implementation used by bulk reports. */
export function evaluateLocalChangeRule(request: ProjectEvaluationRequest, ruleId: string): LocalChangeRuleOutput {
  const input = request.localChange;
  if (!input) throw new Error("localChange is required");
  localIds(input);
  const one = (rule: ProjectRuleResult): LocalChangeRuleOutput => ({ rules: [rule], requiredArtifacts: [] });
  const scope = scopeState(request);
  if (ruleId === "SFFD_LOCAL_CHANGE_SCOPE_V1") return one(result(request, ruleId, "Supported San Francisco local-change scope", scope.state === "verified" ? "pass" : "unknown", scope.state, scope.reason, [input.id], SOURCES.scope, scope.evidence, scope.missing));
  // Execution guards do not prefilter the selection catalog.
  if (ruleId.startsWith("SFFD_") && scope.state !== "verified") return one(unknownResult(request, ruleId, ruleId, scope.state, scope.reason, [input.id], SOURCES.scope, scope.missing, scope.evidence));
  switch (ruleId) {
    case "LOCAL_CHANGE_CONFIRMED_INTERFACE_SCREEN_V1": return one(interfaceChecks(request, input).result);
    case "LOCAL_CHANGE_PART_PRESSURE_COMPATIBILITY_V1": return one(pressureReport(request, input).result);
    case "SFFD_AB204_FIELD_DEVIATION_I14E_V1": return fieldDeviationCheck(request, input);
    case "SFFD_LOCAL_CHANGE_APPROVED_BASELINE_V1": return one(approvedBaselineCheck(request, input, approvedBaselineContext(request, input)));
    case "SFFD_LOCAL_CHANGE_DRAWING_LINEAGE_V1": return one(drawingLineageCheck(request, input, proposedDrawingContext(request, input, approvedBaselineContext(request, input).approvedDoc)));
    case "SFFD_AB204_HEAD_RELOCATION_I14C_V1": return headRelocationCheck(request, input, headChanges(request, input), proposedDrawingContext(request, input, approvedBaselineContext(request, input).approvedDoc));
    case "SFFD_AB204_HYDRAULIC_RECALC_I22A2_V1": {
      const checked = hydraulicCheck(request, input);
      if (checked.result.ruleId !== ruleId) return one({ ...checked.result, ruleId, status: "not_applicable", applicability: "not_applicable", reason: "The selected existing-system trigger rule does not cover the confirmed new-system pathway. The new-system hydraulic review remains unimplemented." });
      return { rules: [checked.result], requiredArtifacts: checked.artifact ? [checked.artifact] : [] };
    }
    case "SFFD_LOCAL_CHANGE_ROUTE_GEOMETRY_V1": return one(routeGeometryCheck(request, input, localGeometryContext(request, input)));
    case "LOCAL_CHANGE_STRAIGHT_PIPE_DUCT_ENVELOPE_V1": return one(ductEnvelopeCheck(request, input, localGeometryContext(request, input)));
    case "LOCAL_CHANGE_BOM_ACCOUNTING_V1": {
      const { baseline, proposed } = localGeometryContext(request, input);
      return one(bomAccountingCheck(request, input, bomDeltas(request, input, baseline, proposed)));
    }
    case "LOCAL_CHANGE_HEAD_NEIGHBORHOOD_V1": return one(headNeighborhoodCheck(request, input, localHeadContext(request, input, localGeometryContext(request, input).delta)));
    default: throw new Error(`Unknown executable local change rule: ${ruleId}`);
  }
}

export function localChangeRuleSources(ruleId: string): ProjectSourceReference[] {
  if (ruleId.includes("SCOPE")) return SOURCES.scope;
  if (ruleId.includes("I14D")) return SOURCES.headReuse;
  if (ruleId.includes("I14A")) return SOURCES.headRemoval;
  if (ruleId.includes("I15_")) return SOURCES.riser;
  if (ruleId.includes("I14E")) return SOURCES.fieldDeviation;
  if (ruleId.includes("HYDRAULIC")) return SOURCES.hydraulic;
  if (ruleId.includes("GEOMETRY") || ruleId.includes("ENVELOPE") || ruleId.includes("INTERFACE") || ruleId.includes("BOM")) return SOURCES.geometry;
  return SOURCES.plans;
}

function approvedBaselineContext(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput) {
  const approvedDoc = docFact(request, input.approvedDrawing.document, "approvedDrawing.document", [input.id], ["permit", "drawing"]);
  const approvedState = checkFact(request, input.approvedDrawing.approval, "approvedDrawing.approval", [input.id], ["permit", "drawing"], approvedDoc.value);
  const baselineDrawing = sourceDrawingCheck(request, input.baseline, "baseline");
  const baselineMatchesApproval = sameRevision(approvedDoc.value, baselineDrawing.value);
  const baselineApprovalStatus = !approvedDoc.issues.length && !approvedState.issues.length && approvedState.value === "approved" && !baselineDrawing.issues.length && baselineMatchesApproval;
  const knownBaselineRejection = !approvedDoc.issues.length && !approvedState.issues.length && approvedState.value === "not_approved" && !baselineDrawing.issues.length && baselineMatchesApproval;
  return { approvedDoc, approvedState, baselineDrawing, baselineMatchesApproval, baselineApprovalStatus, knownBaselineRejection };
}

function proposedDrawingContext(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput, approvedDoc: FactCheck<DocumentRevisionRef>) {
  const proposedDrawing = sourceDrawingCheck(request, input.proposed, "proposed");
  const revisedDoc: FactCheck<DocumentRevisionRef> = input.revisedDrawing
    ? docFact(request, input.revisedDrawing.document, "revisedDrawing.document", [input.id], ["permit", "drawing"])
    : { issues: ["revisedDrawing.document"], evidenceIds: [], state: "input_missing" };
  const revisedApproval: FactCheck<"approved" | "not_approved"> = input.revisedDrawing
    ? checkFact(request, input.revisedDrawing.approval, "revisedDrawing.approval", [input.id], ["permit", "drawing"], revisedDoc.value)
    : { issues: ["revisedDrawing.approval"], evidenceIds: [], state: "input_missing" };
  const sameAsBaseline = sameRevision(proposedDrawing.value, approvedDoc.value);
  const revisedMatches = sameRevision(revisedDoc.value, proposedDrawing.value);
  const lineageOk = !proposedDrawing.issues.length && (sameAsBaseline || (!revisedDoc.issues.length && revisedMatches));
  return { proposedDrawing, revisedDoc, revisedApproval, sameAsBaseline, revisedMatches, lineageOk };
}

function localGeometryContext(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput) {
  const geometryBase = evaluateLocalPlanGeometry(input.baseline);
  const geometryProposed = evaluateLocalPlanGeometry(input.proposed);
  const baseEvidence = planGeometryFacts(request, input.baseline);
  const proposedEvidence = planGeometryFacts(request, input.proposed);
  const baseline = maskGeometry(geometryBase, baseEvidence.issues);
  const proposed = maskGeometry(geometryProposed, proposedEvidence.issues);
  const delta = compareGeometry(baseline, proposed);
  const stable = compareStableContext(request, input);
  const hasRouteParts = input.baseline.segments.length > 0 && input.proposed.segments.length > 0;
  return { baseline, proposed, baseEvidence, proposedEvidence, delta, stable, hasRouteParts };
}

function localHeadContext(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput, delta: ProjectLocalChangeReport["delta"]) {
  const heads = headChanges(request, input);
  const neighborhood = impactNeighborhoodCheck(request, input);
  const routeChanged = routeHasChanged(input.baseline, input.proposed, delta);
  const listedHeads = neighborhood.value?.headIds ?? [];
  const movedNotCovered = heads.moved.filter(id => !listedHeads.includes(id));
  const routeRequiresHeadScope = routeChanged && !listedHeads.length;
  const neighborMissing = [...neighborhood.issues, ...(routeRequiresHeadScope ? ["changeRequest.impactNeighborhood.headIds"] : []), ...(movedNotCovered.length ? ["changeRequest.impactNeighborhood.headIds:" + movedNotCovered.join(",")] : []), ...heads.issues];
  const headStatus: RuleStatus = neighborMissing.length ? "unknown" : heads.moved.length ? "pass" : "not_applicable";
  const headState: LocalChangeVerificationState = neighborMissing.length ? "input_missing" : "verified";
  return { heads, neighborhood, routeChanged, listedHeads, neighborMissing, headStatus, headState };
}

function approvedBaselineCheck(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput, context: ReturnType<typeof approvedBaselineContext>) {
  const rules: ProjectRuleResult[] = [];
  const { approvedDoc, approvedState, baselineDrawing, baselineMatchesApproval, baselineApprovalStatus, knownBaselineRejection } = context;
  rules.push(result(request, "SFFD_LOCAL_CHANGE_APPROVED_BASELINE_V1", "Approved baseline drawing is revision-linked", baselineApprovalStatus ? "pass" : knownBaselineRejection ? "fail" : "unknown", baselineApprovalStatus || knownBaselineRejection ? "verified" : "input_missing",
    baselineApprovalStatus ? "The approved baseline and baseline plan identify the same current drawing revision." : knownBaselineRejection ? "The identified baseline plan revision is confirmed not approved." : "The approved drawing approval, source revision, and baseline plan drawing must be confirmed and linked before comparison.",
    [input.id, input.baseline.id], SOURCES.plans, [...approvedDoc.evidenceIds, ...approvedState.evidenceIds, ...baselineDrawing.evidenceIds], [...approvedDoc.issues, ...approvedState.issues, ...baselineDrawing.issues, ...(!baselineMatchesApproval ? ["baseline.sourceDrawing:approvedDrawing.document"] : [])]));
  return rules[0]!;
}

function drawingLineageCheck(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput, context: ReturnType<typeof proposedDrawingContext>) {
  const rules: ProjectRuleResult[] = [];
  const { proposedDrawing, revisedDoc, sameAsBaseline, revisedMatches, lineageOk } = context;
  rules.push(result(request, "SFFD_LOCAL_CHANGE_DRAWING_LINEAGE_V1", "Proposed plan drawing revision is identified", lineageOk ? "pass" : "unknown", lineageOk ? "verified" : "input_missing",
    lineageOk ? "The proposed plan is linked to its named drawing revision." : "A proposal must identify a current drawing revision; a changed revision also needs its matching revised-drawing record.",
    [input.id, input.proposed.id], SOURCES.plans, [...proposedDrawing.evidenceIds, ...revisedDoc.evidenceIds], [...proposedDrawing.issues, ...(!sameAsBaseline && !revisedMatches ? [...revisedDoc.issues, "revisedDrawing.document:proposed.sourceDrawing"] : [])]));
  return rules[0]!;
}

function routeGeometryCheck(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput, context: ReturnType<typeof localGeometryContext>) {
  const rules: ProjectRuleResult[] = [];
  const { baseline, proposed, baseEvidence, proposedEvidence, delta, stable, hasRouteParts } = context;
  rules.push(result(request, "SFFD_LOCAL_CHANGE_ROUTE_GEOMETRY_V1", "Confirmed straight-pipe route, cut lengths, and geometry delta", delta.state === "verified" && stable.state === "verified" && hasRouteParts ? "pass" : "unknown",
    delta.state === "unsupported" ? "unsupported" : delta.state === "input_missing" || stable.state !== "verified" || !hasRouteParts ? "input_missing" : "verified",
    "The deterministic calculation covers straight axis-parallel pipe centerlines, explicit fitting/tie-in takeouts, and route quantity deltas only; it does not model full fitting bodies, hydraulic loss, or design tolerances.",
    [input.id, input.baseline.id, input.proposed.id, ...stable.changedIds], SOURCES.geometry,
    [...baseEvidence.evidenceIds, ...proposedEvidence.evidenceIds, ...stable.evidence], [...baseline.missingInputs, ...proposed.missingInputs, ...stable.missing]));
  return rules[0]!;
}

function ductEnvelopeCheck(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput, context: ReturnType<typeof localGeometryContext>) {
  const rules: ProjectRuleResult[] = [];
  const { baseline, proposed, proposedEvidence, stable } = context;
  const clearances = proposed.ductClearances;
  const clearanceNeighborhood = impactNeighborhoodCheck(request, input);
  const expectedClearanceCount = input.proposed.segments.length * input.proposed.ducts.length;
  const collision = clearances.some(item => item.state === "collision");
  const unsupportedClearance = clearances.some(item => item.state === "unsupported");
  const missingClearance = clearances.some(item => item.state === "input_missing");
  const clearancePairsComplete = expectedClearanceCount > 0 && clearances.length === expectedClearanceCount;
  const allDuctsCovered = input.proposed.ducts.length > 0 && [...new Set([...input.baseline.ducts, ...input.proposed.ducts].map(duct => duct.id))].every(id => clearanceNeighborhood.value?.ductIds.includes(id));
  const clearanceState: LocalChangeVerificationState = unsupportedClearance || proposed.state === "unsupported" || baseline.state === "unsupported" ? "unsupported" : missingClearance || baseline.state !== "verified" || proposed.state !== "verified" || stable.state !== "verified" || clearanceNeighborhood.issues.length > 0 || !clearancePairsComplete || !allDuctsCovered ? "input_missing" : "verified";
  const clearanceStatus: RuleStatus = collision ? "fail" : clearanceState === "verified" ? "pass" : "unknown";
  rules.push(result(request, "LOCAL_CHANGE_STRAIGHT_PIPE_DUCT_ENVELOPE_V1", "Straight pipe envelope versus modeled ducts", clearanceStatus, clearanceState,
    collision ? "At least one modeled straight-pipe radius envelope intersects a modeled duct box." : "This result describes only modeled straight-pipe-to-duct geometry; it does not determine sprinkler-discharge obstruction compliance or fitting-body clearance.",
    [input.proposed.id, ...clearances.flatMap(item => [item.segmentId, item.ductId])], SOURCES.pending,
    [...proposedEvidence.evidenceIds, ...stable.evidence, ...clearanceNeighborhood.evidenceIds], [...proposed.missingInputs, ...stable.missing, ...clearanceNeighborhood.issues, ...(!clearancePairsComplete ? ["proposed.ductClearances.completeComparisonSet"] : []), ...(!allDuctsCovered ? ["changeRequest.impactNeighborhood.ductIds:allProposedDucts"] : [])]));
  return rules[0]!;
}

function bomAccountingCheck(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput, bomResult: ReturnType<typeof bomDeltas>) {
  const rules: ProjectRuleResult[] = [];
  const bom = bomResult.output;
  rules.push(result(request, "LOCAL_CHANGE_BOM_ACCOUNTING_V1", "Derived plan bill of material reconciled with supplied rows", bomResult.status, bomResult.verificationState,
    bomResult.reason,
    [input.id, ...bom.map(line => line.itemId)], SOURCES.pending, bomResult.evidence, bomResult.missing));
  return rules[0]!;
}

function headNeighborhoodCheck(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput, context: ReturnType<typeof localHeadContext>) {
  const rules: ProjectRuleResult[] = [];
  const { heads, neighborhood, listedHeads, neighborMissing, headStatus, headState } = context;
  rules.push(result(request, "LOCAL_CHANGE_HEAD_NEIGHBORHOOD_V1", "Head positions and local impact neighborhood recorded", headStatus, headState,
    neighborMissing.length ? "Head/neighbor impact is not assessed because the changed route or affected-neighborhood evidence is incomplete." : heads.moved.length ? "Moved head IDs and measured locations are reported for human review; no NFPA spacing or discharge-compliance result is inferred." : "No head displacement was found in the represented plan set; this does not establish spacing or obstruction compliance.",
    [input.id, ...heads.deltas.map(item => item.headId), ...listedHeads], SOURCES.pending, [...heads.evidence, ...neighborhood.evidenceIds], neighborMissing));
  return rules[0]!;
}

function headRelocationCheck(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput, heads: ReturnType<typeof headChanges>, drawing: ReturnType<typeof proposedDrawingContext>) {
  const rules: ProjectRuleResult[] = [];
  const requiredArtifacts: ProjectLocalChangeReport["requiredArtifacts"] = [];
  const { revisedDoc, revisedApproval, revisedMatches } = drawing;
  for (const headId of heads.moved) {
    const sources = [...SOURCES.plans];
    let status: RuleStatus = "unknown";
    let state: LocalChangeVerificationState = "input_missing";
    let reason = "A moved head needs a revised approved plan linked to the proposed drawing revision.";
    const missing: string[] = [];
    const evidence = [...heads.evidence];
    if (revisedDoc.issues.length || !revisedDoc.value || !revisedMatches || revisedApproval.issues.length || !revisedApproval.value) {
      missing.push(...revisedDoc.issues, ...revisedApproval.issues, ...(!revisedDoc.value ? ["revisedDrawing.document"] : []), ...(!revisedApproval.value ? ["revisedDrawing.approval"] : []), ...(!revisedMatches ? ["revisedDrawing.document:proposed.sourceDrawing"] : []));
    } else if (revisedApproval.value === "approved") {
      status = "pass"; state = "verified"; reason = "The proposed head relocation is shown on a revision-matched drawing confirmed approved; this checks plan representation only.";
    } else {
      status = "fail"; state = "verified"; reason = "The proposed head relocation is shown only on a revision confirmed not approved; AB 2.04 I.14(C) requires relocations to follow an approved plan.";
    }
    evidence.push(...revisedDoc.evidenceIds, ...revisedApproval.evidenceIds);
    rules.push(result(request, "SFFD_AB204_HEAD_RELOCATION_I14C_V1", "Moved head represented on a revised approved plan", status, state, reason, [input.id, headId], sources, evidence, missing));
    if (status !== "pass") requiredArtifacts.push({ id: `SFFD_AB204_REVISED_APPROVED_PLAN_I14C_${headId}`, title: `Approved revised plan for relocated head ${headId}`, state: "required", reason: "AB 2.04 I.14(C) requires a sprinkler relocation to follow an approved plan.", subjectIds: [input.id, headId], sourceRefs: SOURCES.plans });
  }
  return { rules, requiredArtifacts };
}

function fieldDeviationCheck(request: ProjectEvaluationRequest, input: ProjectLocalChangeInput) {
  const rules: ProjectRuleResult[] = [];
  const requiredArtifacts: ProjectLocalChangeReport["requiredArtifacts"] = [];
  const fieldDeviation = input.changeRequest.fieldInstallationDeviationFromApprovedPlan;
  if (!fieldDeviation) {
    rules.push(unknownResult(request, "SFFD_AB204_FIELD_DEVIATION_I14E_V1", "Actual field deviation from approved plan", "input_missing", "This is a field-history condition and cannot be inferred from a proposed geometry difference. Confirm whether as-built work differs from the approved plan.", [input.id], SOURCES.fieldDeviation, ["fieldInstallationDeviationFromApprovedPlan"]));
  } else {
    const check = checkFact(request, fieldDeviation, "changeRequest.fieldInstallationDeviationFromApprovedPlan", [input.changeRequest.id], ["installation", "inspection"]);
    if (check.issues.length) rules.push(unknownResult(request, "SFFD_AB204_FIELD_DEVIATION_I14E_V1", "Actual field deviation from approved plan", "input_missing", "The actual field-deviation fact lacks current installation/inspection evidence. A plan proposal cannot establish field history.", [input.id], SOURCES.fieldDeviation, check.issues, check.evidenceIds));
    else if (check.value === "yes") {
      rules.push(unknownResult(request, "SFFD_AB204_FIELD_DEVIATION_I14E_V1", "Actual field deviation from approved plan", "unimplemented", "AB 2.04 I.14(E) says a field deviation may require recalculation. This deviation needs project-specific review; it is not an automatic failure or a confirmed recalculation trigger.", [input.id], SOURCES.fieldDeviation, ["projectSpecificI14EReview"], check.evidenceIds));
      requiredArtifacts.push({ id: "SFFD_AB204_FIELD_DEVIATION_REVIEW_I14E", title: "Review field deviation and decide whether recalculation is required", state: "may_be_required", reason: "AB 2.04 I.14(E) says a deviation may require recalculation, considering new pipe/fittings.", subjectIds: [input.id], sourceRefs: SOURCES.fieldDeviation });
    } else rules.push(result(request, "SFFD_AB204_FIELD_DEVIATION_I14E_V1", "Actual field deviation from approved plan", "not_applicable", "verified", "Current installation/inspection evidence confirms no field deviation from the approved plan.", [input.id], SOURCES.fieldDeviation, check.evidenceIds));
  }
  return { rules, requiredArtifacts };
}
