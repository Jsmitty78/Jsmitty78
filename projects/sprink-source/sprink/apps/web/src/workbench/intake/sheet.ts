import type { DrawingView, PackageInputs, PackagePlan } from "@sprink/core";

/**
 * Drawing intake geometry, kept pure so it can be tested without a browser.
 *
 * Sheet coordinates are what the user clicks: PDF points of the page at 1x, or image pixels, with Y down.
 * Plan coordinates are millimetres in a right-handed frame with Z up. The only mapping between them is
 * the explicit view transform saved with the drawing:
 *   plan = rotate(rotationDeg) * ((sx - origin.x) * scale, -(sy - origin.y) * scale)
 * Nothing here recognises drawing content; every point comes from the user.
 */
export interface SheetPoint { x: number; y: number }
export interface ViewTransform { scale: number; origin: SheetPoint; rotationDeg: number }
export type LengthUnit = "mm" | "m" | "in" | "ft";
export const MM: Record<LengthUnit, number> = { mm: 1, m: 1000, in: 25.4, ft: 304.8 };

export function sheetToPlan(p: SheetPoint, t: ViewTransform): { x: number; y: number; z: number } {
  const dx = (p.x - t.origin.x) * t.scale, dy = -(p.y - t.origin.y) * t.scale;
  const r = (t.rotationDeg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: clean(dx * c - dy * s), y: clean(dx * s + dy * c), z: 0 };
}

export function planToSheet(p: { x: number; y: number }, t: ViewTransform): SheetPoint {
  const r = (-t.rotationDeg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = p.x * c - p.y * s, dy = p.x * s + p.y * c;
  return { x: clean(dx / t.scale + t.origin.x), y: clean(-dy / t.scale + t.origin.y) };
}

/** Removes binary noise below a nanometre so saved coordinates read as entered. */
const clean = (n: number) => Math.round(n * 1e6) / 1e6;

export function sheetDistance(a: SheetPoint, b: SheetPoint) { return Math.hypot(b.x - a.x, b.y - a.y); }

/** Millimetres per sheet unit from two picked points and the real distance between them. */
export function scaleFromTwoPoints(a: SheetPoint, b: SheetPoint, value: number, unit: LengthUnit): number | null {
  const d = sheetDistance(a, b);
  if (!(d > 0) || !(value > 0)) return null;
  return (value * MM[unit]) / d;
}

/**
 * Millimetres per PDF point from a printed ratio such as 1/8 in = 1 ft. PDF points are 1/72 in of paper,
 * so this only applies to PDF pages printed at their original size. Raster images need two points.
 */
export function scaleFromPrinted(paper: { value: number; unit: LengthUnit }, real: { value: number; unit: LengthUnit }): number | null {
  if (!(paper.value > 0) || !(real.value > 0)) return null;
  return (25.4 / 72) * (real.value * MM[real.unit]) / (paper.value * MM[paper.unit]);
}

/** Parses "1/8" or "0.125" or "3" (a positive number or simple fraction); null otherwise. */
export function parseRatioNumber(text: string): number | null {
  const t = text.trim();
  const frac = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (frac) { const v = Number(frac[1]) / Number(frac[2]); return Number.isFinite(v) && v > 0 ? v : null; }
  const whole = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (whole) { const v = Number(whole[1]) + Number(whole[2]) / Number(whole[3]); return Number.isFinite(v) && v > 0 ? v : null; }
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** The rotation that makes the direction from a to b the plan's +X axis. */
export function rotationToAxis(a: SheetPoint, b: SheetPoint): number | null {
  const dx = b.x - a.x, dy = -(b.y - a.y);
  if (dx === 0 && dy === 0) return null;
  return clean((-Math.atan2(dy, dx) * 180) / Math.PI);
}

export function transformOf(view: DrawingView | undefined, scale: number | null): ViewTransform | null {
  if (!view || scale === null || !(scale > 0)) return null;
  return { scale, origin: view.frame.origin, rotationDeg: view.frame.rotationDeg };
}

// ---------------------------------------------------------------- trace

/**
 * One open run in the order the user clicked. An interface is where this work meets something outside
 * it (a head station, a tee, an existing pipe): it is a scope boundary, not a physical pipe end or a
 * confirmed joint. A retained head at a station stays context: drawn and listed, never connected or bought.
 */
export type TraceNodeKind = "interface" | "elbow" | "open_end";
export interface TraceNode { kind: TraceNodeKind; at: SheetPoint; head: boolean; label: string }
export interface TraceContext { kind: "head" | "pipe"; points: SheetPoint[]; label: string }
export interface Trace { nodes: TraceNode[]; context: TraceContext[]; pipeLabels: string[] }
export interface TraceProducts { pipe: string | null; elbow: string | null }

export const emptyTrace = (): Trace => ({ nodes: [], context: [], pipeLabels: [] });

type Plan = PackagePlan;
type Scope = NonNullable<PackageInputs["scope"]>;
export interface LabelFact { subjectId: string; label: string }
export interface BuiltTrace { plan: Plan; scope: Scope; labels: LabelFact[] }

export const FRAME_ID = "drawing-plan";
const frame = { id: FRAME_ID, lengthUnit: "mm" as const, axes: "right_handed_z_up" as const };

export function traceProblems(trace: Trace): string[] {
  const out: string[] = [];
  const n = trace.nodes;
  if (n.length < 2) out.push("Trace at least two points along the run: where it starts and where it ends.");
  n.forEach((node, i) => {
    const interior = i > 0 && i < n.length - 1;
    if (interior && node.kind !== "elbow") out.push(`Point ${i + 1} is between two spans, so it must be a change of direction (elbow).`);
    if (!interior && node.kind === "elbow") out.push(`Point ${i + 1} ends the run, so it must be an interface or an open end.`);
    if (node.head && node.kind === "elbow") out.push(`Point ${i + 1}: a retained head can only sit at an end station in this editor.`);
  });
  for (let i = 1; i < n.length; i++) if (sheetDistance(n[i - 1].at, n[i].at) === 0) out.push(`Points ${i} and ${i + 1} are at the same place.`);
  trace.context.forEach((c, i) => {
    if (c.kind === "pipe" && (c.points.length !== 2 || sheetDistance(c.points[0], c.points[1]) === 0)) out.push(`Context pipe ${i + 1} needs two different points.`);
    if (c.kind === "head" && c.points.length !== 1) out.push(`Context head ${i + 1} needs one point.`);
  });
  return out;
}

/**
 * Turns the trace into the work-package plan. Spans connect only through the elbows and interfaces the
 * user placed; retained heads and context pipes are separate, unconnected entities outside the scope,
 * so a crossing or a shared station never becomes a connection. No lengths or cuts are calculated here.
 */
export function buildTracePlan(trace: Trace, t: ViewTransform, products: TraceProducts, planId = "baseline"): BuiltTrace | { problems: string[] } {
  const problems = traceProblems(trace);
  if (problems.length) return { problems };
  const pos = (p: SheetPoint) => sheetToPlan(p, t);
  const port = (id: string, p: SheetPoint) => ({ id, position: pos(p), unknownReason: null });
  const entities: Plan["entities"] = [], connections: Plan["connections"] = [], labels: LabelFact[] = [];
  const included: string[] = [], excluded: string[] = [], interfaces: string[] = [];
  const pipeId = (i: number) => `p${i + 1}`;
  const n = trace.nodes;
  for (let i = 0; i < n.length - 1; i++) {
    entities.push({ id: pipeId(i), kind: "pipe", productId: products.pipe, ports: [port("start", n[i].at), port("end", n[i + 1].at)] });
    included.push(pipeId(i));
    if (trace.pipeLabels[i]?.trim()) labels.push({ subjectId: pipeId(i), label: trace.pipeLabels[i].trim() });
  }
  let elbow = 0, face = 0, head = 0;
  n.forEach((node, i) => {
    if (node.kind === "elbow") {
      const id = `f${++elbow}`;
      entities.push({ id, kind: "fitting", productId: products.elbow, ports: [port("in", node.at), port("out", node.at)] });
      connections.push({ id: `${id}-in`, from: { entityId: pipeId(i - 1), portId: "end" }, to: { entityId: id, portId: "in" } });
      connections.push({ id: `${id}-out`, from: { entityId: pipeId(i), portId: "start" }, to: { entityId: id, portId: "out" } });
      included.push(id);
      if (node.label.trim()) labels.push({ subjectId: id, label: node.label.trim() });
    } else if (node.kind === "interface") {
      const id = `t${++face}`;
      entities.push({ id, kind: "tie_in", productId: null, ports: [port("socket", node.at)] });
      const first = i === 0;
      connections.push({ id: `${id}-joint`, from: { entityId: pipeId(first ? 0 : i - 1), portId: first ? "start" : "end" }, to: { entityId: id, portId: "socket" } });
      included.push(id); interfaces.push(id);
      if (node.label.trim() && !node.head) labels.push({ subjectId: id, label: node.label.trim() });
    }
    if (node.head) {
      const id = `h${++head}`;
      entities.push({ id, kind: "head", productId: null, ports: [port("center", node.at)] });
      excluded.push(id);
      if (node.label.trim()) labels.push({ subjectId: id, label: node.label.trim() });
    }
  });
  let ctx = 0;
  for (const c of trace.context) {
    const id = c.kind === "head" ? `h${++head}` : `c${++ctx}`;
    entities.push(c.kind === "head"
      ? { id, kind: "head", productId: null, ports: [port("center", c.points[0])] }
      : { id, kind: "pipe", productId: null, ports: [port("start", c.points[0]), port("end", c.points[1])] });
    excluded.push(id);
    if (c.label.trim()) labels.push({ subjectId: id, label: c.label.trim() });
  }
  return {
    plan: { id: planId, coordinateFrame: frame, confirmation: "proposed", entities, connections },
    scope: { coordinateFrame: frame, includedEntityIds: included, excludedEntityIds: excluded, tieInEntityIds: interfaces },
    labels,
  };
}

/** Reads a saved traced plan back into sheet points. Null when the plan was not made by this editor. */
export function traceFromPlan(plan: Plan | null | undefined, scope: Scope | null | undefined, t: ViewTransform, labelOf: (id: string) => string = () => ""): Trace | null {
  if (!plan || !scope || plan.coordinateFrame.id !== FRAME_ID) return null;
  const byId = new Map(plan.entities.map(e => [e.id, e]));
  const at = (id: string, port: string) => byId.get(id)?.ports.find(p => p.id === port)?.position ?? null;
  const pipes = plan.entities.filter(e => e.kind === "pipe" && scope.includedEntityIds.includes(e.id)).sort((a, b) => num(a.id) - num(b.id));
  if (!pipes.length || pipes.some((p, i) => p.id !== `p${i + 1}`)) return null;
  const endKind = (pipe: string, port: "start" | "end"): TraceNodeKind => {
    const c = plan.connections.find(c => [c.from, c.to].some(e => e.entityId === pipe && e.portId === port));
    if (!c) return "open_end";
    const other = byId.get(c.from.entityId === pipe ? c.to.entityId : c.from.entityId);
    return other?.kind === "fitting" ? "elbow" : other?.kind === "tie_in" ? "interface" : "open_end";
  };
  const nodes: TraceNode[] = [];
  const nodeLabel = (pipe: string, port: "start" | "end") => {
    const c = plan.connections.find(c => [c.from, c.to].some(e => e.entityId === pipe && e.portId === port));
    return c ? labelOf(c.from.entityId === pipe ? c.to.entityId : c.from.entityId) : "";
  };
  for (let i = 0; i < pipes.length; i++) {
    const p = at(pipes[i].id, "start");
    if (!p) return null;
    nodes.push({ kind: i === 0 ? endKind(pipes[i].id, "start") : "elbow", at: planToSheet(p, t), head: false, label: nodeLabel(pipes[i].id, "start") });
  }
  const last = pipes[pipes.length - 1], e = at(last.id, "end");
  if (!e) return null;
  nodes.push({ kind: endKind(last.id, "end"), at: planToSheet(e, t), head: false, label: nodeLabel(last.id, "end") });
  const context: TraceContext[] = [];
  for (const entity of plan.entities.filter(x => scope.excludedEntityIds.includes(x.id))) {
    const pts = entity.ports.map(p => p.position).filter((p): p is NonNullable<typeof p> => !!p);
    if (entity.kind === "head" && pts.length === 1) {
      const station = nodes.findIndex((nd, i) => (i === 0 || i === nodes.length - 1) && !nd.head && near(planToSheet(pts[0], t), nd.at));
      if (station >= 0) { nodes[station].head = true; nodes[station].label = labelOf(entity.id) || nodes[station].label; }
      else context.push({ kind: "head", points: [planToSheet(pts[0], t)], label: labelOf(entity.id) });
    } else if (entity.kind === "pipe" && pts.length === 2) context.push({ kind: "pipe", points: pts.map(p => planToSheet(p, t)), label: labelOf(entity.id) });
    else return null;
  }
  return { nodes, context, pipeLabels: pipes.map(p => labelOf(p.id)) };
}
const num = (id: string) => Number(id.replace(/\D/g, "")) || 0;
const near = (a: SheetPoint, b: SheetPoint) => sheetDistance(a, b) < 1e-6;

/** Projected (plan) length of each traced span in mm, from the saved transform. Not a cut or stock length. */
export function spanLengths(trace: Trace, t: ViewTransform): number[] {
  const out: number[] = [];
  for (let i = 1; i < trace.nodes.length; i++) {
    const a = sheetToPlan(trace.nodes[i - 1].at, t), b = sheetToPlan(trace.nodes[i].at, t);
    out.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  return out;
}
