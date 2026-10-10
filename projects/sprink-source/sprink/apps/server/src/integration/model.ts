import { createHash } from "node:crypto";
import { adaptationInterval, adaptationMillimetres, confirmedPackageEvidence, geometryFactUsable, restoreAdaptation, type PackagePlan, type WorkPackageSnapshot } from "@sprink/core";
import {
  fabricationCatalog,
  toLocalPlanGeometry,
  toPlanningProduct,
  UNSELECTED_PRODUCT,
  type FabricationInput,
  type Value,
  type Length,
  type Point3,
} from "@sprink/fabrication";
import {
  type Plan,
  type GenerateInput,
  type Fact,
  type Box,
} from "@sprink/planning";

export const safe = (id: string) =>
  "i-" + createHash("sha256").update(id).digest("hex").slice(0, 24);
export const known = <T>(
  value: T,
  evidenceIds: string[] = ["catalog"],
): Fact<T> => ({ value, confirmed: true, source: "manual", evidenceIds });
export const unknown = <T>(): Fact<T> => ({
  value: null,
  confirmed: false,
  source: "manual",
  evidenceIds: [],
});
export function savedFact(
  s: WorkPackageSnapshot,
  field: string,
  subject?: string,
) {
  const matches = [...s.detailing, ...s.siteFacts].filter(
    (f) =>
      f.field === field &&
      (subject ? f.subjectIds.includes(subject) : f.subjectIds.length === 0),
  );
  if (matches.length > 1) throw new Error(`Ambiguous fact: ${field}`);
  return matches[0];
}
/** How a missing input reads in a reason; other fields keep their name. */
const FIELD_TEXT: Record<string, string> = {
  netCutOffset: "the net cut offset at the tie-in",
  workAreaAccess: "work-area access",
  curePlan: "the set and cure plan",
};
export function value<T extends string | number | boolean>(
  s: WorkPackageSnapshot,
  field: string,
  subject?: string,
): Value<T> {
  const f = savedFact(s, field, subject);
  return {
    value: (f?.value ?? null) as T | null,
    status:
      confirmedPackageEvidence(f)
        ? "confirmed"
        : "unknown",
    evidenceIds: f ? [f.id] : [],
    reason: f?.unknownReason ?? `Confirm ${FIELD_TEXT[field] ?? field}`,
  };
}
export function fact<T extends string | number | boolean>(
  s: WorkPackageSnapshot,
  field: string,
  subject?: string,
): Fact<T> {
  const v = value<T>(s, field, subject);
  return {
    value: v.value,
    confirmed: v.status === "confirmed",
    evidenceIds: v.evidenceIds,
    source: "manual",
  };
}
function lengthValue(
  s: WorkPackageSnapshot,
  field: string,
  subject: string,
): Value<Length> {
  const v = value<number>(s, field, subject),
    f = savedFact(s, field, subject);
  const units = ["m", "mm", "ft", "in"];
  return {
    ...v,
    value:
      typeof v.value === "number" && units.includes(f?.unit ?? "")
        ? { value: v.value, unit: f!.unit as Length["unit"] }
        : null,
  };
}

function confirmedProductBinding(s: WorkPackageSnapshot, field: string, subject: string): string {
  const binding = value<string>(s, field, subject);
  return binding.status === "confirmed" && typeof binding.value === "string" ? binding.value : "";
}

/** The saved graph owns connectivity. Coordinates alone never join two parts. */
export function fabricationInput(
  s: WorkPackageSnapshot,
  plan: PackagePlan,
): FabricationInput {
  const interval = s.intent === "adapt_to_site" && plan.id === s.baselinePlan?.id ? adaptationInterval(s) : null;
  if (interval) plan = interval.plan;
  if (!s.sourceDrawing || !s.scope || !s.baselinePlan)
    throw new Error("Drawing, scope and baseline are required");
  // Entities outside the scope are retained context (heads, adjacent pipe): kept in the plan and
  // shown, never detailed, counted or connected. A connection into the context would be a guess.
  // The interval adapter validates explicit endpoint connections and retains their
  // stations as calculation boundaries, even when the source heads are excluded.
  const context = new Set(s.scope.excludedEntityIds.filter(id => !interval?.ends.some(end => end.entity.id === id)));
  if (
    plan.connections.some((c) =>
      [c.from, c.to].some((e) => context.has(e.entityId)),
    )
  )
    throw new Error(
      "Retained context is connected to the work; include it in the scope or disconnect it",
    );
  const pipes = plan.entities.filter(
    (e) => e.kind === "pipe" && !context.has(e.id),
  );
  if (!pipes.length)
    throw new Error("An empty pipe scope is not a work package");
  const evidence = [...s.detailing, ...s.siteFacts].map((f) => ({
    id: f.id,
    subjectIds: [...f.subjectIds, ...(f.subjectIds.length ? [] : [plan.id])],
    description: f.source.description,
  }));
  const drawingEvidence = `drawing-${s.sourceDrawing.assetId}`;
  const nodes: FabricationInput["nodes"] = [],
    pieces: FabricationInput["pieces"] = [],
    fittings: FabricationInput["fittings"] = [];
  const confirmed = plan.confirmation === "confirmed";
  const pos = (
    p: { x: number; y: number; z: number } | null,
    nodeId: string,
  ): Value<Point3> => ({
    value: p ? { ...p, unit: "mm", frameId: plan.coordinateFrame.id } : null,
    status: p ? (confirmed ? "confirmed" : "proposed") : "unknown",
    evidenceIds: p && confirmed ? [drawingEvidence] : [],
    reason: p ? null : `Missing position ${nodeId}`,
  });
  const connected = new Map<string, { entityId: string; portId: string }>();
  for (const c of plan.connections) {
    for (const [a, b] of [
      [c.from, c.to],
      [c.to, c.from],
    ]) {
      const key = `${a.entityId}/${a.portId}`;
      if (connected.has(key)) throw new Error(`Multiple connections at ${key}`);
      connected.set(key, b);
    }
  }
  for (const p of pipes) {
    if (p.ports.length !== 2)
      throw new Error(`Pipe ${p.id} requires two ordered ports`);
    const ends = p.ports.map((port, i) => {
      const end = i === 0 ? "start" : "end";
      const c = connected.get(`${p.id}/${port.id}`),
        other = c && plan.entities.find((e) => e.id === c.entityId);
      const datum = value<string>(s, `datum.${end}`, p.id);
      // Synthetic datums may describe test topology, but value()/cutDatum() keep them unverified for fabrication.
      const topologyUsable = geometryFactUsable(savedFact(s, `datum.${end}`, p.id));
      const scopeInterface = topologyUsable && datum.value === "scope_interface";
      if (other && !["fitting", "tie_in"].includes(other.kind) && !(scopeInterface && other.kind === "head"))
        throw new Error("Pipe endpoints require a fitting or tie-in");
      const otherPort = other?.ports.find((p) => p.id === c!.portId);
      if (
        otherPort?.position &&
        port.position &&
        JSON.stringify(otherPort.position) !== JSON.stringify(port.position)
      )
        throw new Error("Connected ports disagree on the centerline position");
      const nodeId = other ? `node-${other.id}` : `node-${p.id}-${end}`;
      const physical =
        !other &&
        topologyUsable &&
        datum.value === "physical_pipe_end";
      if (!c && !physical && !scopeInterface)
        throw new Error(
          `Unconnected endpoint ${p.id}/${end}; explicitly detail an open end or connection`,
        );
      if (!nodes.some((n) => n.id === nodeId)) {
        const offset = other && (s.intent !== "adapt_to_site" || s.baselinePlan!.entities.find(e => e.id === other.id)?.kind === "tie_in")
          ? lengthValue(s, "netCutOffset", other.id)
          : {
              value: null,
              status: "unknown" as const,
              evidenceIds: [],
              reason: "Unknown endpoint datum",
            };
        nodes.push({
          id: nodeId,
          datum:
            scopeInterface ? "scope_interface" : other?.kind === "fitting"
              ? "fitting_center"
              : physical
                ? "physical_pipe_end"
                : "tie_in",
          position: pos(port.position, nodeId),
          ...(other?.kind === "tie_in" ? { netCutOffset: offset } : {}),
        });
        if (other)
          for (const e of evidence.filter((e) =>
            e.subjectIds.includes(other.id),
          ))
            e.subjectIds.push(nodeId);
      }
      return nodeId;
    });
    pieces.push({
      id: p.id,
      sourceSegmentIds: [p.id],
      productId: p.productId ?? UNSELECTED_PRODUCT,
      startNodeId: ends[0],
      endNodeId: ends[1],
      subassemblyId: "run",
      disposition: "new",
    });
  }
  // Order a single run without guessing connections or reversing physical endpoint labels.
  const degree = (id: string) =>
    pieces.filter((p) => p.startNodeId === id || p.endNodeId === id).length;
  let cursor = nodes.find((n) => degree(n.id) === 1)?.id;
  const ordered: typeof pieces = [],
    remaining = [...pieces];
  while (cursor && remaining.length) {
    const ix = remaining.findIndex(
      (p) => p.startNodeId === cursor || p.endNodeId === cursor,
    );
    if (ix < 0) break;
    const p = remaining.splice(ix, 1)[0];
    ordered.push(p);
    cursor = p.startNodeId === cursor ? p.endNodeId : p.startNodeId;
  }
  if (remaining.length)
    throw new Error("Disconnected or closed route is unsupported");
  const catalog = fabricationCatalog(s.configVersion);
  for (const f of plan.entities.filter((e) => e.kind === "fitting" && !context.has(e.id))) {
    const product = catalog.products.find(p => p.id === f.productId);
    const face = product?.kind === "elbow_90" && product.connection === "steel_threaded" ? product.centerToFace : null;
    const mm = (length: Length) => length.value * { mm: 1, m: 1000, ft: 304.8, in: 25.4 }[length.unit];
    const ports = f.ports.map((port) => {
      const c = connected.get(`${f.id}/${port.id}`),
        piece = pieces.find((p) => p.id === c?.entityId);
      const pipe = pipes.find((p) => p.id === piece?.id);
      if (!piece || !pipe) throw new Error("Unconnected fitting port");
      let axialEngagement = lengthValue(s, `threadMakeup.${port.id}`, f.id);
      if (face && axialEngagement.value) {
        const amount = mm(axialEngagement.value), limit = mm(face);
        if (!Number.isFinite(amount) || amount <= 0 || amount >= limit) axialEngagement = {
          ...axialEngagement, value: null, status: "unknown",
          reason: `${f.id}/${port.id}: final axial engagement must be finite, greater than 0 and less than ${limit} mm (fitting center-to-face). Correct threadMakeup.${port.id} under Steel threaded joints with scoped dimensional evidence.`,
        };
      }
      return {
        id: port.id,
        pieceId: piece.id,
        end:
          pipe.ports[0].id === c!.portId
            ? ("start" as const)
            : ("end" as const),
        location: "field" as const,
        threadMakeup: {
          pipeProductId: confirmedProductBinding(s, `threadMakeup.${port.id}.pipeProductId`, f.id),
          fittingProductId: confirmedProductBinding(s, `threadMakeup.${port.id}.fittingProductId`, f.id),
          axialEngagement,
        },
      };
    });
    fittings.push({
      id: f.id,
      sourceEntityIds: [f.id],
      productId: f.productId ?? UNSELECTED_PRODUCT,
      nodeId: `node-${f.id}`,
      ports,
    });
  }
  evidence.push({
    id: drawingEvidence,
    subjectIds: nodes.map((n) => n.id),
    description: `Explicit ${plan.confirmation} structured drawing dimensions: ${s.sourceDrawing.drawingId} ${s.sourceDrawing.revision}`,
  });
  const jointMovement: Record<string, Value<boolean>> = {};
  const threadedJointPlan: NonNullable<FabricationInput["assemblyConditions"]["threadedJointPlan"]> = {};
  for (const f of fittings)
    for (const port of f.ports) {
      const id = `${f.id}/${port.id}`;
      jointMovement[id] = value<boolean>(s, `movement.${port.id}`, f.id);
      threadedJointPlan[id] = {
        pipeProductId: confirmedProductBinding(s, `threadedJointPlan.${port.id}.pipeProductId`, f.id),
        fittingProductId: confirmedProductBinding(s, `threadedJointPlan.${port.id}.fittingProductId`, f.id),
        plan: value<string>(s, `threadedJointPlan.${port.id}`, f.id),
        movement: value<boolean>(s, `movement.${port.id}`, f.id),
      };
      for (const e of evidence.filter((e) => e.subjectIds.includes(f.id)))
        e.subjectIds.push(id);
    }
  const retainedContext = (entityId: string) => nodes.some(n =>
    n.datum === "scope_interface" && n.id === `node-${entityId}`) || s.scope!.excludedEntityIds.includes(entityId);
  return {
    projectId: s.projectId,
    packageId: s.id,
    planId: plan.id,
    baselinePlanId: s.baselinePlan.id,
    intent: s.intent,
    inputRevision: s.inputRevision,
    configVersion: s.configVersion,
    sourceDrawing: {
      id: s.sourceDrawing.drawingId,
      revision: s.sourceDrawing.revision,
      approval:
        s.sourceDrawing.approval === "approved" ? "approved" : "not_approved",
    },
    planRole: plan.id === s.baselinePlan.id ? "baseline" : "candidate",
    selectedPlanId: s.selectedPlan?.id ?? null,
    siteEvidenceIds: s.siteFacts.map((f) => f.id),
    frame: { id: plan.coordinateFrame.id, lengthUnit: "mm" },
    nodes,
    pieces: ordered,
    fittings,
    evidence,
    accessories: plan.entities
      .filter(
        (e) =>
          ["head", "support", "unsupported"].includes(e.kind) &&
          !context.has(e.id),
      )
      .map((e) => ({
        id: e.id,
        kind:
          e.kind === "head"
            ? "head"
            : e.kind === "support"
              ? "support"
              : "other",
        productId: e.productId,
        quantity: {
          value: retainedContext(e.id) ? null : 1,
          status: retainedContext(e.id) ? "unknown" : "proposed",
          evidenceIds: [],
          reason: retainedContext(e.id) ? "Retained context entity; purchasing quantity is unknown" : "Counted from the saved model",
        },
        attachedPieceIds: [],
        reason: retainedContext(e.id) ? "Retained context; one model reference, not a purchased item" : "Installation outside the supported catalog",
      })),
    assemblyConditions: {
      workAreaAccess: value<boolean>(s, "workAreaAccess"),
      curePlan: value<string>(s, "curePlan"),
      jointMovement,
      threadedJointPlan,
    },
  };
}

function cutDatum(s: WorkPackageSnapshot, field: string, subject: string): Fact<"center_to_center" | "physical_pipe_end"> {
  const datum = fact<"center_to_center" | "physical_pipe_end">(s, field, subject);
  return datum.value === "center_to_center" || datum.value === "physical_pipe_end" ? datum : unknown();
}
export function planningPlan(
  s: WorkPackageSnapshot,
  input: FabricationInput,
): Plan {
  const catalog = fabricationCatalog(s.configVersion),
    geometry = toLocalPlanGeometry(input, catalog);
  return {
    ...geometry,
    segments: geometry.segments.map((seg) => ({
      ...seg,
      productId: input.pieces.find((p) => p.id === seg.id)!.productId,
      cutEndDatumAtStart: cutDatum(s, "datum.start", seg.id),
      cutEndDatumAtEnd: cutDatum(s, "datum.end", seg.id),
    })),
    fittings: geometry.fittings.map((f) => ({
      ...f,
      productId: input.fittings.find((p) => p.id === f.id)!.productId,
    })),
    heads: [],
    ducts: [],
  };
}
function boxFact(s: WorkPackageSnapshot, prefix: string): Fact<Box> {
  const fields = ["min.x", "min.y", "min.z", "max.x", "max.y", "max.z"];
  const fs = fields.map((k) => savedFact(s, `${prefix}.${k}`));
  if (
    fs.some(
      (f) =>
        !f ||
        !geometryFactUsable(f) ||
        typeof f.value !== "number" ||
        !["mm", "m", "in", "ft"].includes(f.unit ?? ""),
    )
  )
    return unknown();
  const point = (offset: number) => ({
    x: adaptationMillimetres(fs[offset]!.value as number, fs[offset]!.unit),
    y: adaptationMillimetres(fs[offset + 1]!.value as number, fs[offset + 1]!.unit),
    z: adaptationMillimetres(fs[offset + 2]!.value as number, fs[offset + 2]!.unit),
    unit: "mm" as const,
    frameId: adaptationInterval(s).plan.coordinateFrame.id,
  });
  return known(
    { kind: "axis_aligned_box", min: point(0), max: point(3) },
    fs.map((f) => f!.id),
  );
}
export function generationInput(s: WorkPackageSnapshot): GenerateInput {
  const input = fabricationInput(s, s.baselinePlan!),
    baseline = planningPlan(s, input);
  baseline.ducts = [
    { id: "site-duct", roomId: "work-area", geometry: boxFact(s, "duct") },
  ];
  const clearance = savedFact(s, "requiredPipeClearance");
  return {
    projectId: s.projectId,
    packageId: s.id,
    inputRevision: s.inputRevision,
    configVersion: s.configVersion,
    intent: "adapt_to_site",
    baseline,
    targetSegmentId: s.changeRequest?.affectedEntityIds[0] ?? "",
    fixedConnectionNodeIds: [
      input.pieces[0].startNodeId,
      input.pieces.at(-1)!.endNodeId,
    ],
    protectedSegmentIds: [],
    workEnvelope: boxFact(s, "workEnvelope"),
    requiredPipeClearance:
      clearance && geometryFactUsable(clearance) &&
      typeof clearance.value === "number" &&
      ["mm", "m", "in", "ft"].includes(clearance.unit ?? "")
        ? known({ value: adaptationMillimetres(clearance.value, clearance.unit), unit: "mm" }, [clearance.id])
        : unknown(),
    product: toPlanningProduct(fabricationCatalog(s.configVersion),
      input.pieces.find(p => p.id === s.changeRequest?.affectedEntityIds[0])?.productId ?? null),
  };
}
/** Stable API-safe identities, with all structural references transformed together. */
export function apiCandidate(plan: Plan): Plan {
  const ids = [
    plan.id,
    ...plan.nodes.map((n) => n.id),
    ...plan.segments.map((p) => p.id),
    ...plan.fittings.map((f) => f.id),
  ];
  const map = new Map(
    ids
      .filter((id) => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id))
      .map((id) => [id, safe(id)]),
  );
  return JSON.parse(
    JSON.stringify(plan, (_key, v) =>
      typeof v === "string" ? (map.get(v) ?? v) : v,
    ),
  );
}
export function packagePlan(plan: Plan, baseline: PackagePlan): PackagePlan {
  const point = (nodeId: string) => {
    const p = plan.nodes.find((n) => n.id === nodeId)!.position.value;
    if (!p) return null;
    const scale = { m: 1000, mm: 1, ft: 304.8, in: 25.4 }[p.unit];
    return { x: p.x * scale, y: p.y * scale, z: p.z * scale };
  };
  const entities: PackagePlan["entities"] = plan.segments.map((p) => ({
    id: p.id,
    kind: "pipe",
    productId: p.productId ?? null,
    ports: [
      { id: "start", position: point(p.startNodeId), unknownReason: null },
      { id: "end", position: point(p.endNodeId), unknownReason: null },
    ],
  }));
  const connections: PackagePlan["connections"] = [];
  for (const f of plan.fittings) {
    entities.push({
      id: f.id,
      kind: "fitting",
      productId: f.productId ?? null,
      ports: f.ports.map((p, i) => ({
        id: `port-${i}`,
        position: point(p.nodeId),
        unknownReason: null,
      })),
    });
    f.ports.forEach((p, i) =>
      connections.push({
        id: safe(`${f.id}/${i}`),
        from: { entityId: f.id, portId: `port-${i}` },
        to: { entityId: p.segmentId, portId: p.endpoint },
      }),
    );
  }
  for (const n of plan.nodes.filter((n) => n.kind === "tie_in")) {
    const entity = baseline.entities.find((e) => `node-${e.id}` === n.id);
    if (!entity) throw new Error("Protected tie-in disappeared");
    entities.push(structuredClone(entity));
    for (const p of plan.segments)
      for (const end of ["start", "end"] as const)
        if (p[`${end}NodeId`] === n.id)
          connections.push({
            id: safe(`${n.id}/${p.id}`),
            from: { entityId: entity.id, portId: entity.ports[0].id },
            to: { entityId: p.id, portId: end },
          });
  }
  entities.push(
    ...baseline.entities
      .filter((e) => ["head", "support", "unsupported"].includes(e.kind))
      .map((e) => structuredClone(e)),
  );
  return {
    id: plan.id,
    confirmation: "proposed",
    coordinateFrame: baseline.coordinateFrame,
    entities,
    connections,
  };
}

/** Public plans preserve source context; internal planning/quantities cover the active interval. */
export function candidatePackage(plan: Plan, s: WorkPackageSnapshot): PackagePlan {
  return restoreAdaptation(packagePlan(plan, adaptationInterval(s).plan), s);
}
