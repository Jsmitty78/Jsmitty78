import type { PackagePlan, WorkPackageSnapshot } from "./work-package.js";

type Inputs = Pick<WorkPackageSnapshot, "baselinePlan" | "scope" | "changeRequest" | "siteFacts" | "detailing">;
type Point = { x: number; y: number; z: number };
type PackageFact = Inputs["detailing"][number];
/** Legacy SAMPLE records remain test assumptions even if older clients marked them confirmed. */
export function isSyntheticPackageFact(f: PackageFact | undefined): boolean {
  return !!f && (f.provenance === "synthetic_assumption" || (!f.provenance && /SAMPLE|SYNTHETIC|FICTIONAL|ASSUMPTION:|not measured on site/i.test(f.source.description)));
}
export function confirmedPackageEvidence(f: PackageFact | undefined): boolean {
  return !!f && !isSyntheticPackageFact(f) && (!f.provenance || f.provenance === "confirmed_evidence") && f.confirmation === "confirmed" && f.value !== null;
}
/** Only route geometry may consume labeled test assumptions; this is not physical confirmation. */
export function geometryFactUsable(f: PackageFact | undefined): boolean {
  return !!f && f.value !== null && !!f.source.description.trim() && (confirmedPackageEvidence(f) || isSyntheticPackageFact(f));
}

const scales: Record<string, number> = { mm: 1, m: 1000, in: 25.4, ft: 304.8 };
export function adaptationMillimetres(value: number, unit: string | null): number {
  const n = value * (scales[unit ?? ""] ?? NaN);
  if (!Number.isFinite(n)) throw new Error("A finite length in mm, m, ft or in is required");
  return n;
}

/** Optional explicit local-to-drawing transform. No transform means boxes use the saved drawing frame.
 * A partial/unconfirmed transform is never silently replaced by identity. Z is up in both frames.
 */
export function adaptationFrame(s: Pick<Inputs, "siteFacts" | "detailing">) {
  const names = ["origin.x", "origin.y", "origin.z", "yaw"];
  const facts = names.map(n => [...s.siteFacts, ...s.detailing].filter(f => f.field === `adaptationFrame.${n}` && !f.subjectIds.length));
  if (facts.every(f => !f.length)) return { toLocal: (p: Point) => ({ ...p }), toDrawing: (p: Point) => ({ ...p }), explicit: false };
  if (facts.some(f => f.length !== 1 || !geometryFactUsable(f[0]) || typeof f[0].value !== "number"))
    throw new Error("Confirm all adaptation frame origin coordinates and yaw, or label each as a synthetic test assumption, with source descriptions");
  const origin = facts.slice(0, 3).map(([f]) => adaptationMillimetres(f.value as number, f.unit));
  const yaw = facts[3][0];
  if (yaw.unit !== "deg" || !Number.isFinite(yaw.value)) throw new Error("Adaptation frame yaw requires finite degrees");
  const radians = (yaw.value as number) * Math.PI / 180, c = Math.cos(radians), sn = Math.sin(radians);
  // Remove floating-point rotation noise only (1e-8 mm), never a construction tolerance.
  const clean = (v: number) => Math.round(v * 1e8) / 1e8;
  return {
    explicit: true,
    toLocal: (p: Point): Point => ({ x: clean((p.x - origin[0]) * c + (p.y - origin[1]) * sn), y: clean(-(p.x - origin[0]) * sn + (p.y - origin[1]) * c), z: clean(p.z - origin[2]) }),
    toDrawing: (p: Point): Point => ({ x: p.x * c - p.y * sn + origin[0], y: p.x * sn + p.y * c + origin[1], z: p.z + origin[2] }),
  };
}

/** Active interval only. Everything else stays in the saved baseline as protected context.
 * Scope interfaces are NOT assertions about physical pipe ends, head products or field joints.
 */
export function adaptationInterval(s: Inputs) {
  const baseline = s.baselinePlan;
  if (!baseline || !s.scope) throw new Error("Save the drawing and work scope first");
  if (s.scope.coordinateFrame.id !== baseline.coordinateFrame.id) throw new Error("Scope and drawing frames must match");
  const ids = s.changeRequest?.affectedEntityIds;
  if (ids?.length !== 1) throw new Error("Choose exactly one straight pipe interval; interior branches and compound changes are unsupported");
  const target = baseline.entities.find(e => e.id === ids[0]);
  if (!target || target.kind !== "pipe" || target.ports.length !== 2) throw new Error("The active interval must be a pipe with exactly two endpoint ports");
  if (!s.scope.includedEntityIds.includes(target.id) || s.scope.excludedEntityIds.includes(target.id)) throw new Error("The active interval is outside the confirmed work scope");
  const transform = adaptationFrame(s);
  const ends = target.ports.map(port => {
    if (!port.position) throw new Error(`Missing endpoint position for ${target.id}/${port.id}`);
    const matches = baseline.connections.filter(c => [c.from, c.to].some(p => p.entityId === target.id && p.portId === port.id));
    if (matches.length !== 1) throw new Error("Each interval endpoint requires one explicit protected connection; ambiguous branches are unsupported");
    const connection = matches[0];
    const other = connection.from.entityId === target.id ? connection.to : connection.from;
    const entity = baseline.entities.find(e => e.id === other.entityId);
    const otherPort = entity?.ports.find(p => p.id === other.portId);
    if (!entity || !otherPort?.position || ["x", "y", "z"].some(k => otherPort.position![k as keyof Point] !== port.position![k as keyof Point]))
      throw new Error("Protected endpoint connection and pipe position disagree");
    return { connection, entity, port: otherPort, position: transform.toLocal(port.position) };
  });
  if (ends[0].entity.id === ends[1].entity.id) throw new Error("Closed interval is unsupported");
  const a = ends[0].position, b = ends[1].position;
  const axes = (["x", "y", "z"] as const).filter(k => a[k] !== b[k]);
  if (axes.length !== 1) throw new Error("Choose a nonzero axis-parallel straight interval in the explicit local frame");
  const along = axes[0];
  for (const entity of baseline.entities.filter(e => e.id !== target.id)) {
    for (const port of entity.ports) {
      if (!port.position) continue;
      const p = transform.toLocal(port.position);
      if (["x", "y", "z"].filter(k => k !== along).every(k => p[k as keyof Point] === a[k as keyof Point]) && p[along] > Math.min(a[along], b[along]) && p[along] < Math.max(a[along], b[along]))
        throw new Error(`Interior protected context ${entity.id} touches the active interval; split or detail the branch/support explicitly`);
    }
  }
  const plan: PackagePlan = {
    ...structuredClone(baseline),
    coordinateFrame: { ...baseline.coordinateFrame, id: transform.explicit ? `${baseline.coordinateFrame.id.slice(0, 100)}-adapt` : baseline.coordinateFrame.id },
    entities: [
      { ...structuredClone(target), ports: target.ports.map((p, i) => ({ ...p, position: ends[i].position })) },
      ...ends.map(e => ({ ...structuredClone(e.entity), kind: "tie_in" as const, ports: [{ ...e.port, position: e.position }] })),
    ],
    connections: ends.map(e => structuredClone(e.connection)),
  };
  return { plan, target, ends, transform };
}

/** Reinsert generated geometry into the source view, retaining every outside entity and connection. */
export function restoreAdaptation(candidate: PackagePlan, s: Inputs): PackagePlan {
  const { target, ends, transform } = adaptationInterval(s), baseline = s.baselinePlan!;
  const boundaryIds = new Set(ends.map(e => e.entity.id));
  const generated = candidate.entities.filter(e => !boundaryIds.has(e.id));
  const context = baseline.entities.filter(e => e.id !== target.id);
  if (generated.some(e => context.some(p => p.id === e.id))) throw new Error("Generated identity collides with protected context");
  const boundaryConnections = ends.map((e, i) => {
    const c = candidate.connections.find(c => c.from.entityId === e.entity.id || c.to.entityId === e.entity.id);
    if (!c) throw new Error("Generated route lost a protected endpoint");
    const endpoint = c.from.entityId === e.entity.id ? c.to : c.from;
    const pipe = generated.find(p => p.id === endpoint.entityId);
    const port = pipe?.ports.find(p => p.id === endpoint.portId);
    if (!port?.position || ["x", "y", "z"].some(k => Math.abs(port.position![k as keyof Point] - e.position[k as keyof Point]) > 1e-8))
      throw new Error("Generated route moved a protected endpoint");
    return { ...structuredClone(e.connection), from: e.connection.from.entityId === target.id ? endpoint : e.connection.from, to: e.connection.to.entityId === target.id ? endpoint : e.connection.to, original: target.ports[i].position! };
  });
  const entities = generated.map(e => ({ ...structuredClone(e), ports: e.ports.map(p => {
    const fixed = boundaryConnections.find(c => [c.from, c.to].some(ep => ep.entityId === e.id && ep.portId === p.id));
    return { ...p, position: fixed ? { ...fixed.original } : p.position ? transform.toDrawing(p.position) : null };
  }) }));
  return {
    ...candidate, coordinateFrame: baseline.coordinateFrame,
    entities: [...entities, ...structuredClone(context)],
    connections: [
      ...candidate.connections.filter(c => !boundaryIds.has(c.from.entityId) && !boundaryIds.has(c.to.entityId)),
      ...baseline.connections.filter(c => c.from.entityId !== target.id && c.to.entityId !== target.id),
      ...boundaryConnections.map(({ original: _, ...c }) => c),
    ],
  };
}
