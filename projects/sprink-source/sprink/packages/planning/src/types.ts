import type { Box, Fact, Geometry, GeometryResult, Length, Point } from "./geometry-port.js";

export interface Version {
  projectId: string;
  packageId: string;
  inputRevision: number;
  configVersion: string;
}
export interface Plan extends Geometry {
  heads: readonly { headId: string; attachedNodeId: string; position: Fact<Point> }[];
}
export interface GenerateInput extends Version {
  intent: "adapt_to_site";
  baseline: Plan;
  targetSegmentId: string;
  fixedConnectionNodeIds: readonly [string, string];
  protectedSegmentIds: readonly string[];
  workEnvelope: Fact<Box>;
  /** Explicit constraint; zero is allowed only when actually confirmed. */
  requiredPipeClearance: Fact<Length>;
  product: {
    /** Subject-scoped compatibility evidence supplied by the shared catalog/detailing lane. */
    compatibility: Fact<{ pipeProductId: string; elbowProductId: string; connectionMethod: string }>;
    centerToFace: Fact<Length>;
    insertionOrThreadMakeup: Fact<Length>;
  };
}
export type ReasonCode = "input_missing" | "unsupported" | "invalid_input" | "invalid_connection"
  | "geometry_interference" | "insufficient_dimensions" | "outside_work_bounds" | "no_candidate";
export interface Reason { code: ReasonCode; path: string; message: string }
export type Template = "direct" | "detour:x-" | "detour:x+" | "detour:y-" | "detour:y+" | "detour:z-" | "detour:z+";
export interface Candidate {
  id: string;
  template: Template;
  plan: Plan;
  status: "proposed";
  proposedNodeIds: string[];
  proposedFittingIds: string[];
  /** Verified only for the mathematical hypothesis, not confirmed field facts. */
  geometry: GeometryResult;
  comparison: {
    addedFittings: number;
    centerlineLengthDeltaM: number;
    cutLengthDeltaM: number | null;
    changedSegmentIds: string[];
    addedSegmentIds: string[];
    retainedSegmentIds: string[];
    /** No reuse is inferred from a retained ID or from proposal geometry. */
    proposedReuse: null;
    lineage: { segmentId: string; baselineSegmentId: string }[];
    explanation: string;
  };
  unresolved: string[];
}
export interface CandidateSet extends Version {
  baselinePlanId: string;
  state: "ready" | "no_candidate" | "input_missing" | "unsupported" | "invalid_input" | "invalid_connection";
  candidates: Candidate[];
  rejected: { template: Template; reasons: Reason[] }[];
  searchedTemplates: Template[];
  reasons: Reason[];
  baselineGeometry: GeometryResult | null;
  selection: null;
  searchCoverage: string;
  preference: string;
}

/** Same callback for baseline and selected/generated plans; persistence is the caller's job. */
export type DeriveWorkPackage<T> = (input: Version & {
  intent: "prepare_from_drawing" | "adapt_to_site";
  plan: Plan;
  status: "baseline" | "proposed";
}) => T;
