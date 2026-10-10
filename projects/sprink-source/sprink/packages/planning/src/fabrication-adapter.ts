import type { Fact, Length, Point, Unit } from "./geometry-port.js";
import type { DeriveWorkPackage } from "./types.js";

const SCALE: Record<Unit, number> = { m: 1, mm: 0.001, ft: 0.3048, in: 0.0254 };
function metres(value: Length): number {
  const converted = value.value * SCALE[value.unit];
  if (!Number.isFinite(converted) || converted < 0) throw new Error("Invalid length for fabrication adapter.");
  return converted;
}

/** H = center-to-face; G = center-to-socket-bottom. Full socket insertion is H-G.
 * The legacy geometry engine subtracts H-insertion = G, not the nominal pipe size.
 * No tolerance/allowance is added; unavailable or unconfirmed datums remain unknown.
 */
export function socketDatumsToPlanning(centerToFace: Fact<Length>, centerToSocketBottom: Fact<Length>) {
  const readable = (f: Fact<Length>) => f.value !== null && f.confirmed && f.source !== "model" && f.evidenceIds.length > 0;
  let insertion: Length | null = null;
  if (readable(centerToFace) && readable(centerToSocketBottom)) {
    const depth = metres(centerToFace.value!) - metres(centerToSocketBottom.value!);
    if (depth <= 0) throw new Error("Socket face must lie beyond its bottom datum.");
    insertion = { value: depth, unit: "m" };
  }
  return {
    centerToFace: structuredClone(centerToFace),
    insertionOrThreadMakeup: {
      value: insertion, confirmed: insertion !== null,
      source: centerToFace.source === "fixture" && centerToSocketBottom.source === "fixture" ? "fixture" as const : "manual" as const,
      evidenceIds: [...new Set([...centerToFace.evidenceIds, ...centerToSocketBottom.evidenceIds])],
    },
  };
}

export interface FabricationValue<T> {
  value: T | null;
  status: "confirmed" | "proposed" | "unknown";
  evidenceIds: string[];
  reason: string | null;
}
export interface FabricationDetailing {
  baselinePlanId: string;
  sourceDrawing: { id: string; revision: string; approval: "approved" | "not_approved" | "unknown" };
  selectedPlanId: string | null;
  siteEvidenceIds: string[];
  evidence: { id: string; subjectIds: string[]; description: string }[];
  /** Explicit drafting inputs, not inferred assembly feasibility. */
  subassemblyId: string;
  jointLocation: "shop" | "field";
  disposition: "new" | "proposed_reuse";
  assemblyConditions: {
    workAreaAccess: FabricationValue<boolean>;
    jointMovement: Record<string, FabricationValue<boolean>>;
    curePlan: FabricationValue<string>;
  };
}

/** Explicit unit boundary for UI/API and fabrication: output coordinates are always mm. */
export function pointToMillimetres(point: Point): Point {
  const scale = SCALE[point.unit] * 1000;
  const [x, y, z] = [point.x, point.y, point.z].map(v => v * scale);
  if (![x, y, z].every(Number.isFinite)) throw new Error("Invalid coordinate conversion to millimetres.");
  return { x, y, z, unit: "mm", frameId: point.frameId };
}

/** Structural DTO compatible with the fabrication lane; no runtime dependency or copied engine. */
export function toFabricationInput(request: Parameters<DeriveWorkPackage<unknown>>[0], details: FabricationDetailing) {
  const { plan } = request;
  const frame = plan.coordinateFrame.value;
  if (!frame || !plan.coordinateFrame.confirmed || !plan.coordinateFrame.evidenceIds.length || plan.coordinateFrame.source === "model") {
    throw new Error("A confirmed coordinate frame is required.");
  }
  const value = <T, U>(fact: Fact<T> | undefined, convert: (v: T) => U, proposal = false): FabricationValue<U> => {
    const confirmed = fact?.confirmed && fact.source !== "model" && fact.evidenceIds.length > 0;
    const status = fact?.value != null ? proposal ? "proposed" : confirmed ? "confirmed" : "unknown" : "unknown";
    return { value: fact?.value == null ? null : convert(fact.value), status,
      evidenceIds: [...(fact?.evidenceIds ?? [])], reason: status === "unknown" ? "Input is missing or unconfirmed."
        : status === "proposed" ? "Generated plan geometry, not an observed site fact." : null };
  };
  const nodes = plan.nodes.map(node => {
    if (node.kind === "other") throw new Error("Unsupported fabrication node datum.");
    return { id: node.id, datum: node.kind,
      position: value(node.position, pointToMillimetres, request.status === "proposed" && node.kind === "fitting_center"),
      ...(node.kind === "tie_in" ? { netCutOffset: value(node.tieInNetCutOffset, length => ({ value: metres(length) * 1000, unit: "mm" as const })) } : {}) };
  });
  return {
    projectId: request.projectId, packageId: request.packageId, planId: plan.id,
    baselinePlanId: details.baselinePlanId, intent: request.intent,
    inputRevision: request.inputRevision, configVersion: request.configVersion,
    sourceDrawing: structuredClone(details.sourceDrawing), planRole: request.status === "baseline" ? "baseline" as const : "candidate" as const,
    selectedPlanId: details.selectedPlanId, siteEvidenceIds: [...details.siteEvidenceIds],
    frame: { id: frame.id, lengthUnit: "mm" as const }, nodes,
    pieces: plan.segments.map(segment => {
      if (!segment.productId) throw new Error(`Missing pipe product: ${segment.id}`);
      return { id: segment.id, sourceSegmentIds: [...(segment.sourceSegmentIds ?? [segment.id])], productId: segment.productId,
        startNodeId: segment.startNodeId, endNodeId: segment.endNodeId, subassemblyId: details.subassemblyId, disposition: details.disposition };
    }),
    fittings: plan.fittings.map(fitting => {
      if (!fitting.productId) throw new Error(`Missing fitting product: ${fitting.id}`);
      return { id: fitting.id, sourceEntityIds: [fitting.id], productId: fitting.productId, nodeId: fitting.centerNodeId,
        ports: fitting.ports.map((port, i) => ({ id: `port-${i}`, pieceId: port.segmentId, end: port.endpoint, location: details.jointLocation })) };
    }),
    accessories: plan.heads.map(head => ({ id: head.headId, kind: "head" as const, productId: null,
      quantity: { value: 1, status: "proposed" as const, evidenceIds: [], reason: "Count from preserved head record; product/detailing unresolved." },
      attachedPieceIds: plan.segments.filter(s => s.startNodeId === head.attachedNodeId || s.endNodeId === head.attachedNodeId).map(s => s.id),
      reason: "Preserved head reference; product and installation procedure are outside this routing slice." })),
    evidence: structuredClone(details.evidence), assemblyConditions: structuredClone(details.assemblyConditions),
  };
}
