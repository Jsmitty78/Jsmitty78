/** Structural bridge to core/local-change-geometry; no runtime copy of that engine. */
export interface Fact<T> {
  value: T | null;
  confirmed: boolean;
  evidenceIds: string[];
  source: "manual" | "model" | "fixture";
}
export type Unit = "m" | "mm" | "ft" | "in";
export interface Length { value: number; unit: Unit }
export interface Point { x: number; y: number; z: number; unit: Unit; frameId: string }
export interface Box { kind: "axis_aligned_box"; min: Point; max: Point }
export interface Node {
  id: string;
  kind: "fitting_center" | "tie_in" | "other";
  position: Fact<Point>;
  fittingId?: string;
  tieInNetCutOffset?: Fact<Length>;
}
export interface Segment {
  id: string;
  startNodeId: string;
  endNodeId: string;
  outsideDiameter: Fact<Length>;
  cutEndDatumAtStart: Fact<"center_to_center" | "physical_pipe_end">;
  cutEndDatumAtEnd: Fact<"center_to_center" | "physical_pipe_end">;
  productId?: string;
  sourceSegmentIds?: readonly string[];
}
export interface Port {
  segmentId: string;
  endpoint: "start" | "end";
  nodeId: string;
  centerToFace: Fact<Length>;
  insertionOrThreadMakeup: Fact<Length>;
}
export interface Fitting {
  id: string;
  kind: Fact<"elbow_90" | "unsupported">;
  centerNodeId: string;
  ports: readonly [Port, Port];
  productId?: string;
}
export interface Geometry {
  id: string;
  coordinateFrame: Fact<{ id: string; lengthUnit: Unit }>;
  nodes: readonly Node[];
  segments: readonly Segment[];
  fittings: readonly Fitting[];
  ducts: readonly { id: string; roomId: string; geometry: Fact<Box | { kind: "unsupported" }> }[];
}
export interface GeometryResult {
  planId: string;
  state: "verified" | "input_missing" | "unsupported";
  segmentCount: number;
  elbowCount: number;
  totalCenterlineLengthM: number | null;
  totalCutLengthM: number | null;
  segments: { segmentId: string; centerlineLengthM: number | null; cutLengthM: number | null;
    outsideDiameterM: number | null; state: "verified" | "input_missing" | "unsupported"; missingInputs: string[] }[];
  ductClearances: { segmentId: string; ductId: string;
    state: "collision" | "clear" | "input_missing" | "unsupported";
    distanceM?: number; radiusM?: number; marginM?: number; missingInputs: string[] }[];
  missingInputs: string[];
  unsupported: string[];
}
export type GeometryFailure = "insufficient_dimensions" | "invalid_connection" | "invalid_input";
export type GeometryCheck = { ok: true; result: GeometryResult }
  | { ok: false; code: GeometryFailure; path: string; reason: string };
export interface Hypothesis {
  plan: Geometry;
  proposedNodeIds: readonly string[];
  proposedFittingIds: readonly string[];
}
export type GeometryPort = (hypothesis: Hypothesis) => GeometryCheck;

/**
 * Evaluate proposed geometry as a mathematical hypothesis. Only a detached calculation
 * copy is marked readable for the old confirmed-facts evaluator. Never persist that copy
 * or interpret its `verified` state as site confirmation or construction approval.
 */
export function createLocalGeometryPort(evaluate: (plan: Geometry) => GeometryResult): GeometryPort {
  return hypothesis => {
    const plan = structuredClone(hypothesis.plan);
    const readable = <T>(fact: Fact<T>): Fact<T> => ({ ...fact, confirmed: true,
      source: "manual", evidenceIds: [`calculation-hypothesis:${plan.id}`] });
    plan.nodes = plan.nodes.map(node => hypothesis.proposedNodeIds.includes(node.id)
      ? { ...node, position: readable(node.position) } : node);
    plan.fittings = plan.fittings.map(fitting => hypothesis.proposedFittingIds.includes(fitting.id)
      ? { ...fitting, kind: readable(fitting.kind) } : fitting);
    try {
      return { ok: true, result: evaluate(plan) };
    } catch (error) {
      // Pin these legacy diagnostics in integration tests; unexpected exceptions propagate.
      if (!(error instanceof Error) || error.name !== "LocalGeometryInputError" || !("path" in error)) throw error;
      const code: GeometryFailure = error.message === "Net takeouts must leave a positive pipe cut length."
        ? "insufficient_dimensions"
        : /Unresolved|port|endpoint|Fitting|nodes must differ/.test(error.message)
          ? "invalid_connection" : "invalid_input";
      return { ok: false, code, path: String(error.path), reason: error.message };
    }
  };
}
