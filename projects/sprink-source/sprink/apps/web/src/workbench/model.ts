import { tr } from "./locale.js";
import { adaptationFrame, adaptationInterval, confirmedPackageEvidence, geometryFactUsable, isSyntheticPackageFact } from "@sprink/core";
import type { PackageInputs, PackagePlan, PackageResult, WorkPackageSnapshot } from "@sprink/core";
import { lengthInput, parseLength } from "./format.js";

/**
 * Pure helpers between the work-package contract and the screen. Nothing here calculates cuts,
 * quantities, routes or rule outcomes: those come from the server. The helpers read facts,
 * turn a run the user typed into the plan contract, and list which inputs are still missing.
 */
export type Fact = PackageInputs["detailing"][number];
export type Plan = PackagePlan;
export type Entity = Plan["entities"][number];
export interface Point { x: number; y: number; z?: number }

export const PIPE = "spears/CP-010";
export const ELBOW = "spears/4206-010S";

// ---------------------------------------------------------------- facts

/** Same lookup rule as the server (apps/server/src/integration/model.ts savedFact). */
export function findFact(s: Pick<WorkPackageSnapshot, "detailing" | "siteFacts">, field: string, subject?: string): Fact | undefined {
  return [...s.detailing, ...s.siteFacts].find(f => f.field === field && (subject ? f.subjectIds.includes(subject) : f.subjectIds.length === 0));
}
export const isConfirmed = confirmedPackageEvidence;

export interface FactSpec {
  field: string; value: Fact["value"]; subjectIds?: string[]; unit?: string | null;
  confirmation: Fact["confirmation"]; context: Fact["context"];
  provenance?: Fact["provenance"];
  source: string; assetId?: string | null; page?: number | null; unknownReason?: string | null;
}

export type Provenance = NonNullable<Fact["provenance"]>;
export const PROVENANCE_LABELS: Record<Provenance, string> = {
  machine_proposal: "Machine proposal", user_entered: "Entered measurement (unverified)",
  confirmed_evidence: "Confirmed evidence", synthetic_assumption: "Synthetic test assumption",
};
export function factProvenance(f: Fact | undefined): Provenance {
  if (f?.provenance) return f.provenance;
  if (/SAMPLE|SYNTHETIC|FICTIONAL|ASSUMPTION:|not measured on site/i.test(f?.source.description ?? "")) return "synthetic_assumption";
  return f?.confirmation === "confirmed" ? "confirmed_evidence" : "user_entered";
}
/** Editing or confirming a test assumption must not turn it into field evidence. */
export function evidenceSpec(previous: Fact | undefined, provenance: Provenance, source: string): Pick<FactSpec, "provenance" | "confirmation" | "source"> {
  const effective = previous && factProvenance(previous) === "synthetic_assumption" ? "synthetic_assumption" : provenance;
  return { provenance: effective, confirmation: effective === "confirmed_evidence" ? "confirmed" : "proposed", source: source.trim() };
}

/**
 * Replace or add facts. A fact with the same field and subject is removed from both lists first,
 * because the server rejects a field it finds twice ("Ambiguous fact").
 */
export function upsertFacts(s: Pick<WorkPackageSnapshot, "detailing" | "siteFacts">, specs: FactSpec[]): Pick<PackageInputs, "detailing" | "siteFacts"> {
  const same = (f: Fact, spec: FactSpec) => {
    const subjects = spec.subjectIds ?? [];
    return f.field === spec.field && (subjects.length ? subjects.some(id => f.subjectIds.includes(id)) : f.subjectIds.length === 0);
  };
  let detailing = s.detailing.filter(f => !specs.some(spec => same(f, spec)));
  let siteFacts = s.siteFacts.filter(f => !specs.some(spec => same(f, spec)));
  const used = new Set([...detailing, ...siteFacts].map(f => f.id));
  const nextId = (field: string) => {
    const base = `ui-${field.replace(/[^a-zA-Z0-9_.-]/g, "-")}`.slice(0, 100);
    let id = base, n = 1;
    while (used.has(id)) id = `${base}-${++n}`;
    used.add(id);
    return id;
  };
  for (const requested of specs) {
    const previous = [...s.detailing, ...s.siteFacts].find(f => same(f, requested));
    const spec = previous && factProvenance(previous) === "synthetic_assumption"
      ? { ...requested, provenance: "synthetic_assumption" as const, confirmation: "proposed" as const, context: "detailing" as const }
      : requested;
    const fact: Fact = {
      id: nextId(`${spec.field}${spec.subjectIds?.length ? `.${spec.subjectIds.join(".")}` : ""}`),
      field: spec.field, value: spec.value, subjectIds: spec.subjectIds ?? [], unit: spec.unit ?? null,
      unknownReason: spec.value === null ? spec.unknownReason ?? "Not measured yet" : null,
      confirmation: spec.value === null ? "proposed" : spec.confirmation, context: spec.context,
      ...(spec.provenance ? { provenance: spec.provenance } : {}),
      source: { description: spec.source, assetId: spec.assetId ?? null, page: spec.page ?? null },
    };
    if (spec.context === "detailing") detailing = [...detailing, fact];
    else siteFacts = [...siteFacts, fact];
  }
  return { detailing, siteFacts };
}

/** Drops facts tied to entities that are no longer in the plan, so a shortened run does not leave facts the server rejects as unknown_subject. */
export function dropOrphanFacts<T extends Pick<PackageInputs, "detailing" | "siteFacts">>(facts: T, plan: Pick<Plan, "entities">): T {
  const ids = new Set(plan.entities.map(e => e.id));
  const live = (f: Fact) => f.subjectIds.every(id => ids.has(id));
  return { ...facts, detailing: facts.detailing.filter(live), siteFacts: facts.siteFacts.filter(live) };
}

/** True when the run's shape (point count or point types) differs, which renumbers its entity ids. */
export function topologyChanged(a: RunNode[], b: RunNode[] | null): boolean {
  return !b || a.length !== b.length || a.some((n, i) => n.kind !== b[i].kind);
}

/** Drops every fact tied to a plan entity, for when entity ids no longer name the same thing. */
export function dropSubjectFacts<T extends Pick<PackageInputs, "detailing" | "siteFacts">>(facts: T): T {
  return { ...facts, detailing: facts.detailing.filter(f => !f.subjectIds.length), siteFacts: facts.siteFacts.filter(f => !f.subjectIds.length) };
}

/** Compare edits with the saved run as displayed in the editor, without tolerating small user changes. */
export function runChanged(a: RunNode[], b: RunNode[] | null, unit: "mm" | "in"): boolean {
  if (!b || a.length !== b.length) return true;
  const off = (p: number | null, q: number | null) => p !== parseLength(lengthInput(q, unit), unit);
  return a.some((n, i) => n.kind !== b[i].kind || off(n.x, b[i].x) || off(n.y, b[i].y));
}

/** A 6-number box fact (duct.min.x … duct.max.z) in mm, or null for each missing coordinate. */
export const BOX_KEYS = ["min.x", "min.y", "min.z", "max.x", "max.y", "max.z"] as const;
export interface Box { min: Point & { z: number }; max: Point & { z: number } }
export function readBox(s: Pick<WorkPackageSnapshot, "detailing" | "siteFacts">, prefix: string): { values: Array<number | null>; confirmed: boolean; box: Box | null } {
  const facts = BOX_KEYS.map(k => findFact(s, `${prefix}.${k}`));
  const values = facts.map(f => typeof f?.value === "number" ? toMm(f.value, f.unit) : null);
  const complete = values.every((v): v is number => v !== null);
  return {
    values,
    confirmed: facts.every(isConfirmed),
    box: complete ? { min: { x: values[0]!, y: values[1]!, z: values[2]! }, max: { x: values[3]!, y: values[4]!, z: values[5]! } } : null,
  };
}
/** Source prefix for fictional values entered to exercise the software. Confirming never removes it. */
export const ASSUMPTION_PREFIX = "ASSUMPTION:";
export const FRAME_FIELDS = ["origin.x", "origin.y", "origin.z", "yaw"].map(k => `adaptationFrame.${k}`);
/**
 * The explicit local frame (docs/contracts/adaptation-interval.md), or null when boxes are in the
 * drawing frame. `reason` is set when the saved facts are partial or unconfirmed.
 */
export function siteFrameOf(s: Pick<WorkPackageSnapshot, "detailing" | "siteFacts">) {
  const facts = FRAME_FIELDS.map(f => findFact(s, f));
  if (facts.every(f => !f)) return null;
  try {
    const t = adaptationFrame(s);
    const yaw = facts[3]!.value as number;
    return { facts, yaw, origin: { x: t.toDrawing({ x: 0, y: 0, z: 0 }).x, y: t.toDrawing({ x: 0, y: 0, z: 0 }).y, z: t.toDrawing({ x: 0, y: 0, z: 0 }).z }, toLocal: t.toLocal, toDrawing: t.toDrawing, reason: null as string | null };
  } catch (e) {
    return { facts, yaw: null, origin: null, toLocal: null, toDrawing: null, reason: e instanceof Error ? e.message : String(e) };
  }
}
/**
 * Reopens measured inputs and clears synthetic values (which remain usable while proposed): they were read along a
 * span that is no longer the affected one, so they must be confirmed again before routing.
 */
export function reopenSiteGeometry(cur: Pick<WorkPackageSnapshot, "detailing" | "siteFacts">) {
  const reopen = (f: Fact): Fact => /^(adaptationFrame|duct|workEnvelope)\./.test(f.field)
    ? isSyntheticPackageFact(f) ? { ...f, value: null, confirmation: "proposed", unknownReason: "Re-enter geometry for the changed span" } : { ...f, confirmation: "proposed" }
    : f;
  return { detailing: cur.detailing.map(reopen), siteFacts: cur.siteFacts.map(reopen) };
}
/** Which faces a box still needs, in words a fitter would use. */
export function boxGaps(s: Pick<WorkPackageSnapshot, "detailing" | "siteFacts">, prefix: string, local: boolean): string[] {
  const v = readBox(s, prefix).values;
  const names = local ? ["along the span (X)", "across the span (Y)", "height (Z)"] : ["east-west (X)", "north-south (Y)", "height (Z)"];
  const out: string[] = [];
  names.forEach((n, i) => {
    if (v[i] === null || v[i + 3] === null) out.push(`${n}: ${v[i] === null && v[i + 3] === null ? "both faces" : v[i] === null ? "the low face" : "the high face"} missing`);
    else if (v[i]! >= v[i + 3]!) out.push(`${n}: the low face must be less than the high face`);
  });
  return out;
}
export const isTestAssumption = isSyntheticPackageFact;
export function toMm(value: number, unit: string | null): number | null {
  const factor: Record<string, number> = { mm: 1, m: 1000, cm: 10, in: 25.4, ft: 304.8 };
  const f = factor[unit ?? "mm"];
  return f === undefined ? null : value * f;
}

/** Preserve derived frame coordinates across save/reload without display rounding. */
export function exactFrameLengthInput(mm: number, unit: "mm" | "in"): string {
  const text = String(unit === "mm" ? mm : mm / 25.4);
  return parseLength(text, unit) === mm ? text : `${mm} mm`;
}
export function alignedFrameInputs(s: WorkPackageSnapshot, unit: "mm" | "in"): string[] | null {
  const pipe = s.baselinePlan?.entities.find(e => e.kind === "pipe" && s.changeRequest?.affectedEntityIds.includes(e.id));
  const a = pipe?.ports[0]?.position, b = pipe?.ports[1]?.position;
  if (!a || !b || (a.x === b.x && a.y === b.y)) return null;
  return [a.x, a.y, a.z].map(n => exactFrameLengthInput(toMm(n, s.baselinePlan!.coordinateFrame.lengthUnit)!, unit))
    .concat(String(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI));
}

// ---------------------------------------------------------------- plan geometry for drawing

export interface Segment { id: string; a: Point; b: Point; productId: string | null; context?: boolean }
export interface Marker { id: string; kind: Entity["kind"]; at: Point; productId: string | null; context?: boolean }
export interface PlanShape { segments: Segment[]; markers: Marker[]; undrawable: Array<{ id: string; reason: string }> }

/**
 * Where the plan puts each entity. Positions are drawn as given; nothing is inferred. Entities in
 * `context` (outside the package scope) are flagged so they are drawn as retained context, not work.
 */
export function planShape(plan: Plan | null | undefined, context: ReadonlySet<string> = new Set()): PlanShape {
  const shape: PlanShape = { segments: [], markers: [], undrawable: [] };
  if (!plan) return shape;
  for (const e of plan.entities) {
    const known = e.ports.filter(p => p.position);
    if (e.kind === "pipe") {
      const a = e.ports.find(p => p.id === "start")?.position ?? (e.ports.length === 2 ? e.ports[0].position : null);
      const b = e.ports.find(p => p.id === "end")?.position ?? (e.ports.length === 2 ? e.ports[1].position : null);
      if (a && b) shape.segments.push({ id: e.id, a, b, productId: e.productId, ...(context.has(e.id) ? { context: true } : {}) });
      else shape.undrawable.push({ id: e.id, reason: e.ports.find(p => !p.position)?.unknownReason ?? "Pipe end position unknown" });
    } else if (known.length) {
      const at = { x: avg(known.map(p => p.position!.x)), y: avg(known.map(p => p.position!.y)), z: avg(known.map(p => p.position!.z)) };
      shape.markers.push({ id: e.id, kind: e.kind, at, productId: e.productId, ...(context.has(e.id) ? { context: true } : {}) });
    } else shape.undrawable.push({ id: e.id, reason: e.ports[0]?.unknownReason ?? "Position unknown" });
  }
  return shape;
}
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---------------------------------------------------------------- callouts

export interface Callouts { piece: Map<string, string>; fitting: Map<string, string>; tieIn: Map<string, string> }
/**
 * Labels shown on the plan and in tables. The fabrication detail's own callouts win when the server
 * returned them; otherwise pieces are numbered in plan order (a label, not a calculation).
 */
export function callouts(plan: Plan | null | undefined, detail?: { cuts?: Array<{ pieceId: string; callout: number }>; fittings?: Array<{ id: string; callout: string }> }, context: ReadonlySet<string> = new Set()): Callouts {
  const out: Callouts = { piece: new Map(), fitting: new Map(), tieIn: new Map() };
  if (!plan) return out;
  let p = 0, f = 0, t = 0;
  for (const e of plan.entities) {
    if (context.has(e.id)) continue;
    if (e.kind === "pipe") out.piece.set(e.id, String(++p));
    else if (e.kind === "fitting") out.fitting.set(e.id, `F${++f}`);
    else if (e.kind === "tie_in") out.tieIn.set(e.id, `TI-${++t}`);
  }
  for (const c of detail?.cuts ?? []) if (out.piece.has(c.pieceId)) out.piece.set(c.pieceId, String(c.callout));
  for (const c of detail?.fittings ?? []) if (out.fitting.has(c.id)) out.fitting.set(c.id, c.callout);
  return out;
}
export function labelFor(c: Callouts, id: string): string {
  return c.piece.has(id) ? `Piece ${c.piece.get(id)}` : c.fitting.get(id) ?? c.tieIn.get(id) ?? id;
}

// ---------------------------------------------------------------- run editor <-> plan contract

export type RunNodeKind = "tie_in" | "open_end" | "elbow";
export interface RunNode { kind: RunNodeKind; x: number | null; y: number | null }
export interface BuiltRun { plan: Plan; scope: NonNullable<PackageInputs["scope"]>; datums: FactSpec[] }

const frame = { id: "room", lengthUnit: "mm" as const, axes: "right_handed_z_up" as const };

/**
 * Turn the nodes the user entered (mm, in order along one open run) into the plan contract:
 * pipes between consecutive nodes, a 90° elbow at every interior node, and a tie-in or open end at
 * each end. Same structure as the server's integration fixture. Positions are the user's; no
 * routing or length is calculated here. Returns the problems instead when the run is incomplete.
 */
export function buildRun(nodes: RunNode[], planId = "baseline", source = "Entered by you in Sprink", products: { pipe: string | null; elbow: string | null } = { pipe: PIPE, elbow: ELBOW }): BuiltRun | { problems: string[] } {
  const problems: string[] = [];
  if (nodes.length < 2) problems.push("Add at least two points: a start and an end.");
  nodes.forEach((n, i) => {
    if (n.x === null || n.y === null) problems.push(`Point ${i + 1} needs both X and Y.`);
    const interior = i > 0 && i < nodes.length - 1;
    if (interior && n.kind !== "elbow") problems.push(`Point ${i + 1} is between two pipes, so it must be an elbow.`);
    if (!interior && n.kind === "elbow") problems.push(`Point ${i + 1} is an end, so it must be a tie-in or an open end.`);
  });
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1], b = nodes[i];
    if (a.x !== null && a.y !== null && a.x === b.x && a.y === b.y) problems.push(`Points ${i} and ${i + 1} are at the same position.`);
  }
  if (problems.length) return { problems };
  const pt = (n: RunNode) => ({ x: n.x!, y: n.y!, z: 0 });
  const port = (id: string, n: RunNode) => ({ id, position: pt(n), unknownReason: null });
  const entities: Plan["entities"] = [], connections: Plan["connections"] = [], datums: FactSpec[] = [], tieIns: string[] = [];
  const pipeId = (i: number) => `p${i + 1}`;
  let elbow = 0, tie = 0;
  for (let i = 0; i < nodes.length - 1; i++)
    entities.push({ id: pipeId(i), kind: "pipe", productId: products.pipe, ports: [port("start", nodes[i]), port("end", nodes[i + 1])] });
  nodes.forEach((n, i) => {
    if (n.kind === "elbow") {
      const id = `f${++elbow}`;
      entities.push({ id, kind: "fitting", productId: products.elbow, ports: [port("in", n), port("out", n)] });
      connections.push({ id: `${id}-in`, from: { entityId: pipeId(i - 1), portId: "end" }, to: { entityId: id, portId: "in" } });
      connections.push({ id: `${id}-out`, from: { entityId: pipeId(i), portId: "start" }, to: { entityId: id, portId: "out" } });
    } else if (n.kind === "tie_in") {
      const id = `t${++tie}`;
      tieIns.push(id);
      entities.push({ id, kind: "tie_in", productId: null, ports: [port("socket", n)] });
      const first = i === 0;
      connections.push({ id: `${id}-joint`, from: { entityId: pipeId(first ? 0 : i - 1), portId: first ? "start" : "end" }, to: { entityId: id, portId: "socket" } });
    }
  });
  nodes.forEach((n, i) => {
    const datum = n.kind === "open_end" ? "physical_pipe_end" : "center_to_center";
    const spec = (field: string, pipe: string): FactSpec => ({ field, value: datum, subjectIds: [pipe], confirmation: "proposed", context: "detailing", source });
    if (i > 0) datums.push(spec("datum.end", pipeId(i - 1)));
    if (i < nodes.length - 1) datums.push(spec("datum.start", pipeId(i)));
  });
  return {
    plan: { id: planId, coordinateFrame: frame, confirmation: "proposed", entities, connections },
    scope: { coordinateFrame: frame, includedEntityIds: entities.map(e => e.id), excludedEntityIds: [], tieInEntityIds: tieIns },
    datums,
  };
}

/** Read a saved single open run back into editor nodes; null when the plan has another shape. */
export function runNodes(plan: Plan | null | undefined): RunNode[] | null {
  if (!plan) return null;
  const pipes = plan.entities.filter(e => e.kind === "pipe");
  if (!pipes.length || plan.entities.some(e => !["pipe", "fitting", "tie_in"].includes(e.kind))) return null;
  const at = (e: Entity, port: string) => e.ports.find(p => p.id === port)?.position ?? null;
  const connectedTo = (pipe: string, port: string) => {
    const c = plan.connections.find(c => (c.from.entityId === pipe && c.from.portId === port) || (c.to.entityId === pipe && c.to.portId === port));
    if (!c) return null;
    const other = c.from.entityId === pipe ? c.to.entityId : c.from.entityId;
    return plan.entities.find(e => e.id === other) ?? null;
  };
  // Walk the connections from the pipe whose start is not an elbow, never the array order.
  const first = pipes.find(p => connectedTo(p.id, "start")?.kind !== "fitting");
  if (!first) return null;
  const ordered = [first];
  for (;;) {
    const cur = ordered[ordered.length - 1];
    const fit = connectedTo(cur.id, "end");
    if (fit?.kind !== "fitting") break;
    const next = pipes.find(p => !ordered.includes(p) && connectedTo(p.id, "start")?.id === fit.id);
    if (!next) return null;
    ordered.push(next);
  }
  if (ordered.length !== pipes.length) return null;
  const nodes: RunNode[] = [];
  const endKind = (pipe: Entity, port: string): RunNodeKind => connectedTo(pipe.id, port)?.kind === "tie_in" ? "tie_in" : connectedTo(pipe.id, port)?.kind === "fitting" ? "elbow" : "open_end";
  ordered.forEach((p, i) => {
    const s = at(p, "start");
    nodes.push({ kind: i === 0 ? endKind(p, "start") : "elbow", x: s?.x ?? null, y: s?.y ?? null });
  });
  const last = ordered[ordered.length - 1], e = at(last, "end");
  nodes.push({ kind: endKind(last, "end"), x: e?.x ?? null, y: e?.y ?? null });
  const rebuilt = buildRun(nodes, plan.id);
  if ("problems" in rebuilt) return nodes;
  // Only hand the run to the editor if saving it would reproduce the same connections.
  return topologySignature(rebuilt.plan) === topologySignature(plan) ? nodes : null;
}

/** Entity kinds plus each connection as the kinds, ports and positions it joins, independent of ids and array order. */
function topologySignature(plan: Plan): string {
  const byId = new Map(plan.entities.map(e => [e.id, e]));
  const side = (ref: { entityId: string; portId: string }) => {
    const e = byId.get(ref.entityId);
    const pos = e?.ports.find(p => p.id === ref.portId)?.position;
    return `${e?.kind}:${ref.portId}@${pos ? `${pos.x.toFixed(2)},${pos.y.toFixed(2)}` : "?"}`;
  };
  const kinds = plan.entities.map(e => e.kind).sort().join(",");
  const joins = plan.connections.map(c => [side(c.from), side(c.to)].sort().join("|")).sort().join(";");
  return `${kinds}#${joins}`;
}

// ---------------------------------------------------------------- missing inputs

export interface Requirement { id: string; group: "Drawing" | "Run" | "Dimensions" | "Assembly" | "Project" | "Site"; label: string; done: boolean; hint?: string }

export const PROJECT_BASIS: Array<{ field: string; label: string; options: Array<[string, string]> }> = [
  { field: "jurisdiction", label: "Jurisdiction", options: [["san_francisco", "San Francisco (SFFD)"], ["other", "Another jurisdiction (no rule pack in Sprink)"]] },
  { field: "standard", label: "Standard", options: [["nfpa13", "NFPA 13"]] },
  { field: "permitKind", label: "Permit kind", options: [["revision", "Revision"], ["new", "New"]] },
  { field: "originalNfpa13Edition", label: "NFPA 13 edition of the original permit", options: [["2025", "2025"], ["2022", "2022"], ["2019", "2019"]] },
  { field: "originalFirePermitNumber", label: "Original fire permit number", options: [] },
  { field: "systemType", label: "System type", options: [["wet", "Wet"], ["dry", "Dry"]] },
  { field: "sprinklerType", label: "Sprinkler type", options: [["standard_spray", "Standard spray"]] },
  { field: "storage", label: "Occupancy storage", options: [["non_storage", "Non-storage"], ["storage", "Storage"]] },
];

/** The basis questions still asked: after "another jurisdiction", the San Francisco questions do not apply. */
export function projectBasis(s: WorkPackageSnapshot) {
  if (!showSfInputs(s)) return [];
  const j = findFact(s, "jurisdiction");
  return isConfirmed(j) && j!.value !== "san_francisco" ? PROJECT_BASIS.slice(0, 1) : PROJECT_BASIS;
}
/** Sheet label (P27, H1) when the intake saved one. */
export function sourceLabel(s: Pick<WorkPackageSnapshot, "detailing" | "siteFacts">, id: string): string | null {
  const v = findFact(s, "sourceLabel", id)?.value;
  return typeof v === "string" && v ? v : null;
}
/** Entities outside the scope are retained context: shown, never part of the work. */
export const contextIds = (s: Pick<WorkPackageSnapshot, "scope">): Set<string> => new Set(s.scope?.excludedEntityIds ?? []);
export const inScope = (s: Pick<WorkPackageSnapshot, "scope">) => { const c = contextIds(s); return (id: string) => !c.has(id); };
/** Only request detailing for the active interval; retained context is not a new-work item. */
export function activeDetailingPlan(s: WorkPackageSnapshot): Plan | null {
  if (s.intent !== "adapt_to_site" || !s.baselinePlan) return s.baselinePlan;
  const ids = s.changeRequest?.affectedEntityIds ?? [];
  const adjacent = s.baselinePlan.connections.flatMap(c => ids.includes(c.from.entityId) ? [c.to.entityId] : ids.includes(c.to.entityId) ? [c.from.entityId] : []);
  return { ...s.baselinePlan, entities: s.baselinePlan.entities.filter(e => ids.includes(e.id) || (e.kind === "tie_in" && adjacent.includes(e.id))) };
}

export const showCpvcInputs = (s: WorkPackageSnapshot) => activeDetailingPlan(s)?.entities.some(e => e.kind === "pipe" && e.productId === PIPE) ?? false;
export const showSfInputs = (s: WorkPackageSnapshot) => s.intent !== "adapt_to_site" || findFact(s, "jurisdiction")?.value === "san_francisco";

/** Presence checks only; the server decides whether the inputs are sufficient. */
export function requirements(s: WorkPackageSnapshot): Requirement[] {
  const out: Requirement[] = [];
  const add = (r: Requirement) => out.push(r);
  const d = s.sourceDrawing;
  add({ id: "drawing", group: "Drawing", label: "Source drawing uploaded", done: !!d?.assetId });
  if (d?.view) add({ id: "workArea", group: "Drawing", label: "Work area selected on the sheet", done: !!d.view.workArea });
  add({ id: "scale", group: "Drawing", label: "Drawing scale confirmed", done: d?.scale.basis === "confirmed_inputs", hint: d?.scale.reason ?? undefined });
  const plan = activeDetailingPlan(s);
  const work = inScope(s);
  add({ id: "run", group: "Run", label: "Run traced or entered (points, turns, ends)", done: !!s.baselinePlan?.entities.some(e => e.kind === "pipe") && !!s.scope });
  add({ id: "run-confirmed", group: "Run", label: "Run confirmed against the drawing", done: s.baselinePlan?.confirmation === "confirmed" });
  if (plan) {
    for (const pipe of plan.entities.filter(e => e.kind === "pipe" && work(e.id)))
      for (const end of ["start", "end"])
        add({ id: `datum.${end}.${pipe.id}`, group: "Dimensions", label: tr("How the {end} of {part} is dimensioned", { end: tr(end), part: pipe.id }), done: isConfirmed(findFact(s, `datum.${end}`, pipe.id)) });
    for (const tie of plan.entities.filter(e => e.kind === "tie_in" && work(e.id)))
      add({ id: `netCutOffset.${tie.id}`, group: "Dimensions", label: tr("Net cut offset at tie-in {part}", { part: tie.id }), done: isConfirmed(findFact(s, "netCutOffset", tie.id)) });
    for (const fit of plan.entities.filter(e => e.kind === "fitting" && work(e.id) && e.productId === ELBOW))
      for (const port of fit.ports)
        add({ id: `movement.${port.id}.${fit.id}`, group: "Assembly", label: tr("Joint movement at {part} can be made", { part: `${fit.id}/${port.id}` }), done: isConfirmed(findFact(s, `movement.${port.id}`, fit.id)) });
  }
  add({ id: "workAreaAccess", group: "Assembly", label: "Work-area access confirmed", done: isConfirmed(findFact(s, "workAreaAccess")) });
  if (showCpvcInputs(s)) add({ id: "curePlan", group: "Assembly", label: "Cement set and cure plan", done: isConfirmed(findFact(s, "curePlan")) });
  for (const b of projectBasis(s)) add({ id: b.field, group: "Project", label: b.label, done: isConfirmed(findFact(s, b.field)) });
  if (s.intent === "adapt_to_site") {
    add({ id: "change", group: "Site", label: "Affected pipe chosen", done: !!s.changeRequest?.affectedEntityIds.length });
    const site = siteFrameOf(s);
    if (site) add({ id: "siteFrame", group: "Site", label: "Local frame along the span confirmed", done: !site.reason, hint: site.reason ?? undefined });
    for (const [id, label, fields] of [
      ["duct", "Obstacle geometry (all six faces)", BOX_KEYS.map(k => `duct.${k}`)],
      ["workEnvelope", "Work boundary geometry", BOX_KEYS.map(k => `workEnvelope.${k}`)],
      ["requiredPipeClearance", "Required pipe clearance", ["requiredPipeClearance"]],
    ] as const) {
      const facts = fields.map(field => findFact(s, field));
      const gaps = id === "duct" || id === "workEnvelope" ? boxGaps(s, id, !!site) : [];
      for (const gap of gaps) add({ id: `${id}.${gap}`, group: "Site", label: `${id === "duct" ? "Obstacle" : "Work boundary"} ${gap}`, done: false });
      const synthetic = facts.some(isSyntheticPackageFact);
      add({ id, group: "Site", label: `${label}${synthetic ? " — synthetic test input" : ""}`, done: facts.every(f => geometryFactUsable(f) && typeof f?.value === "number"), hint: synthetic ? "Usable for software route testing; field measurement remains unverified." : undefined });
    }
  }
  return out;
}

// ---------------------------------------------------------------- candidates

type CandidateSet = NonNullable<WorkPackageSnapshot["outputs"]["candidates"]>;
export interface RouteOption { letter: string; plan: Plan; fittings: number; centerlineDeltaM: number | null; unknownReason: string | null; result: PackageResult | undefined }

/**
 * Candidates in display order: fewest fittings in the generated plan, then smallest centerline delta
 * reported by the planner, unknown deltas last. Letters follow that order.
 */
export function routeOptions(set: CandidateSet | null | undefined, results: PackageResult[]): RouteOption[] {
  if (!set) return [];
  const rows = set.candidates.map(c => {
    const metric = c.metrics.find(m => m.name === "centerline_delta")?.quantity;
    const factor = metric ? ({ m: 1, mm: 0.001 } as Record<string, number>)[metric.unit] : undefined;
    const metres = metric && metric.value !== null && factor !== undefined ? metric.value * factor : null;
    return {
      plan: c.plan,
      fittings: c.plan.entities.filter(e => e.kind === "fitting").length,
      centerlineDeltaM: metres,
      unknownReason: metric?.value === null ? metric.reason : metric ? null : "The planner did not report a length change",
      result: results.find(r => r.planId === c.plan.id),
    };
  });
  rows.sort((a, b) => a.fittings - b.fittings || (a.centerlineDeltaM ?? Infinity) - (b.centerlineDeltaM ?? Infinity));
  return rows.map((r, i) => ({ ...r, letter: String.fromCharCode(65 + i) }));
}
export const ROUTE_ORDER_NOTE = "Ordered by fewest fittings, then the smallest added centerline the planner reported. Routes with an unknown length are listed last.";

// ---------------------------------------------------------------- checks

export type Evaluation = PackageResult["evaluations"][number];
export interface CheckGroup { status: Evaluation["status"]; reason: string; sourceRefs: string[]; subjectIds: string[]; count: number }

/** Merge identical findings so the panel shows each distinct reason once, with its sources. */
export function groupChecks(evaluations: Evaluation[], subject?: string): CheckGroup[] {
  const map = new Map<string, CheckGroup>();
  for (const e of evaluations) {
    if (subject !== undefined && !(subject ? e.subjectIds.includes(subject) : e.subjectIds.length === 0)) continue;
    const key = `${e.status}|${e.reason}`;
    const g = map.get(key);
    if (g) { g.count++; g.sourceRefs = [...new Set([...g.sourceRefs, ...e.sourceRefs])]; g.subjectIds = [...new Set([...g.subjectIds, ...e.subjectIds])]; }
    else map.set(key, { status: e.status, reason: e.reason, sourceRefs: [...new Set(e.sourceRefs)], subjectIds: [...e.subjectIds], count: 1 });
  }
  const rank = { fail: 0, unknown: 1, pass: 2, not_applicable: 3 } as const;
  return [...map.values()].sort((a, b) => rank[a.status] - rank[b.status]);
}
export function checkCounts(evaluations: Evaluation[]) {
  return evaluations.reduce((c, e) => ({ ...c, [e.status]: c[e.status] + 1 }), { pass: 0, fail: 0, unknown: 0, not_applicable: 0 });
}

const SOURCE_TITLES: Record<string, string> = {
  "spears-fg3": "Spears FG-3 installation instructions",
  "spears-fg90s": "Spears FG90S sweep 90 elbow data",
  "spears-fg-dimensions": "Spears FlameGuard dimensions",
  "https://sf-fire.org/media/4169": "SFFD Administrative Bulletin",
};
export function sourceTitle(ref: string, sources?: Array<{ id: string; document?: string; title?: string }>): string {
  const s = sources?.find(x => x.id === ref);
  return s?.document ?? s?.title ?? SOURCE_TITLES[ref] ?? ref;
}
export function sourceUrl(ref: string, sources?: Array<{ id: string; url?: string }>): string | null {
  const s = sources?.find(x => x.id === ref);
  if (s?.url) return s.url;
  return /^https?:\/\//.test(ref) ? ref : null;
}

// ---------------------------------------------------------------- freshness

export function resultFor(s: WorkPackageSnapshot & { freshness?: { results: Array<{ id: string; current: boolean }> } }, planId: string | undefined) {
  const r = planId ? s.outputs.results.find(x => x.planId === planId) : undefined;
  const current = r ? s.freshness?.results.find(f => f.id === r.id)?.current ?? r.inputRevision === s.inputRevision : false;
  return { result: r, current };
}

// ---------------------------------------------------------------- run preconditions

/**
 * Inputs without which the server's runner stops with a bare "runner_failed" instead of asking
 * (apps/server/src/integration/model.ts fabricationInput). Checked here only so the button can say why.
 */
export function runBlockers(s: WorkPackageSnapshot): string[] {
  const out: string[] = [];
  if (!s.sourceDrawing) out.push("Upload the source drawing.");
  if (!s.baselinePlan || !s.scope) out.push("Enter and save the run.");
  const plan = s.baselinePlan;
  if (plan && s.intent === "adapt_to_site" && s.scope) {
    try { adaptationInterval(s); } catch (e) { out.push(e instanceof Error ? e.message : String(e)); }
    return out;
  }
  if (plan) {
    const connected = new Set(plan.connections.flatMap(c => [`${c.from.entityId}/${c.from.portId}`, `${c.to.entityId}/${c.to.portId}`]));
    for (const pipe of plan.entities.filter(e => e.kind === "pipe" && inScope(s)(e.id)))
      pipe.ports.forEach((port, i) => {
        const end = i === 0 ? "start" : "end";
        const f = findFact(s, `datum.${end}`, pipe.id);
        if (!connected.has(`${pipe.id}/${port.id}`) && !(isConfirmed(f) && f!.value === "physical_pipe_end"))
          out.push(`Confirm that the ${end} of ${pipe.id} is a physical pipe end (Confirm dimensions).`);
      });
  }
  return out;
}


interface RunDraft {
  geometry: string;
  unit: "mm" | "in";
  rows: Array<{ kind: RunNodeKind; x: string; y: string }>;
}

/** Refresh only changed geometry; unit switches preserve exact draft values, including incomplete text. */
export function syncRunDraft(draft: RunDraft | null, saved: RunNode[], unit: "mm" | "in"): RunDraft {
  const geometry = JSON.stringify(saved);
  if (!draft || draft.geometry !== geometry) return {
    geometry, unit, rows: saved.map(n => ({ kind: n.kind, x: lengthInput(n.x, unit), y: lengthInput(n.y, unit) })),
  };
  if (draft.unit === unit) return draft;
  const nodes = draft.rows.map(r => ({ kind: r.kind, x: parseLength(r.x, draft.unit), y: parseLength(r.y, draft.unit) }));
  if (!runChanged(nodes, saved, draft.unit)) return syncRunDraft(null, saved, unit);
  const convert = (text: string) => {
    const mm = parseLength(text, draft.unit);
    return mm === null ? text : `${mm} mm`;
  };
  return { geometry, unit, rows: draft.rows.map(r => ({ kind: r.kind, x: convert(r.x), y: convert(r.y) })) };
}


export function runEditPatch(cur: WorkPackageSnapshot, nodes: RunNode[], built: Extract<ReturnType<typeof buildRun>, { plan: Plan }>): Partial<PackageInputs> {
  const reshaped = topologyChanged(nodes, runNodes(cur.baselinePlan));
  const base = reshaped ? dropSubjectFacts(cur) : cur;
  const keep = built.datums.filter(d => findFact(base, d.field, d.subjectIds![0])?.value !== d.value);
  return {
    baselinePlan: built.plan, scope: built.scope,
    ...(reshaped ? { changeRequest: null } : {}),
    ...dropOrphanFacts(upsertFacts(base, keep), built.plan),
  };
}
