import type { Fact } from "./types.js";
import type { DocumentRevisionRef, ProjectSourceReference } from "./project-contract.js";
import type {
  LocalDuctBox,
  LocalElbowPort,
  LocalFitting,
  LocalLength,
  LocalPlanGeometry,
  LocalPlanGeometryDelta,
  LocalPlanGeometryResult,
  LocalPipeSegment,
  LocalPoint3,
} from "./local-change-geometry.js";

export type LocalChangeAnswer = "yes" | "no";
export type LocalChangeVerificationState = "verified" | "input_missing" | "source_pending" | "unimplemented" | "unsupported";

export interface LocalChangeRequestFacts {
  id: string;
  description: Fact<string>;
  affectedEntityIds: Fact<string[]>;
  impactNeighborhood: Fact<{
    roomIds: string[];
    headIds: string[];
    supportIds: string[];
    ductIds: string[];
    segmentIds: string[];
  }>;
  changeClassification: Fact<"relocation_or_reroute" | "addition_to_existing_system" | "other">;
  /** New-system work has a separate AB 2.04 pathway and is outside this existing-system change slice. */
  systemWorkType: Fact<"new_system" | "existing_system_modification">;
  existingSystem: Fact<LocalChangeAnswer>;
  addsSprinklersOrPiping: Fact<LocalChangeAnswer>;
  /** Resolves AB 2.04 I.15 only when a confirmed addition is made to an existing system. */
  existingConfigurationAndRiserIncluded?: Fact<LocalChangeAnswer>;
  remoteAreaChanged: Fact<LocalChangeAnswer>;
  hazardBecameMoreDemanding: Fact<LocalChangeAnswer>;
  waterSupplyRoutingOrBackflowChanged: Fact<LocalChangeAnswer>;
  /** Per-head removal history and proposed reuse are separate facts, never inferred from moved IDs. */
  headRemovalActions: readonly {
    headId: string;
    removedFromFitting: Fact<LocalChangeAnswer>;
    wasWelded: Fact<LocalChangeAnswer>;
    proposedReuse: Fact<LocalChangeAnswer>;
  }[];
  /** Candidate plan intent. It does not prove field removal. */
  plannedExcessPipeSegmentIds?: Fact<string[]>;
  /** As-built field confirmation only, scoped to the listed pipe segment IDs. */
  fieldExcessPipeRemovalStatus?: Fact<"removed" | "not_removed">;
  /** Actual field condition only; never inferred from the proposal. */
  fieldInstallationDeviationFromApprovedPlan?: Fact<LocalChangeAnswer>;
  /** Resolves only the residual case-by-case hydraulic branch, never an explicit I.22.A(2) trigger. */
  caseByCaseHydraulicDecision?: Fact<"recalculation_required" | "no_additional_calculation_directed">;
}

export interface ProjectLocalRoom {
  id: string;
  ceiling: Fact<{ id: string; kind: "flat" | "unsupported"; height: LocalLength }>;
}

export interface ProjectLocalPipeSegment extends LocalPipeSegment {
  nominalSize: Fact<string>;
  material: Fact<string>;
  pressureRating: Fact<{ value: number; unit: "Pa" | "kPa" | "bar" | "psi" }>;
  connectionAtStart: Fact<LocalConnection>;
  connectionAtEnd: Fact<LocalConnection>;
  /** Actual cut endpoint datum is distinct from the centerline node graph. */
  cutEndDatumAtStart: Fact<"center_to_center" | "physical_pipe_end">;
  cutEndDatumAtEnd: Fact<"center_to_center" | "physical_pipe_end">;
}

export interface LocalConnection {
  standard: string;
  gender: "male" | "female" | "other";
}

export interface ProjectLocalFittingPort extends LocalElbowPort {
  connection: Fact<LocalConnection>;
}

export interface ProjectLocalFitting extends Omit<LocalFitting, "ports"> {
  ports: readonly [ProjectLocalFittingPort, ProjectLocalFittingPort];
  nominalSize: Fact<string>;
  material: Fact<string>;
  pressureRating: Fact<{ value: number; unit: "Pa" | "kPa" | "bar" | "psi" }>;
  productId: Fact<string>;
}

export interface ProjectLocalDuct extends LocalDuctBox {}

export interface ProjectLocalHead {
  headId: string;
  roomId: string;
  ceilingId: string;
  position: Fact<LocalPoint3>;
  /** Selected candidate connection, revision-linked to the proposed drawing. */
  threadStandard?: Fact<"npt" | "iso7_1" | "other">;
}

export interface ProjectLocalSupport {
  supportId: string;
  attachedPipeSegmentIds: Fact<string[]>;
}

export interface ProjectLocalBomLine {
  itemId: string;
  kind: "pipe" | "fitting" | "head" | "support" | "other";
  quantity: Fact<number>;
  cutLength?: Fact<LocalLength>;
}

export interface ProjectLocalPlan extends Omit<LocalPlanGeometry, "segments" | "fittings" | "ducts"> {
  sourceDrawing: Fact<DocumentRevisionRef>;
  rooms: readonly ProjectLocalRoom[];
  segments: readonly ProjectLocalPipeSegment[];
  fittings: readonly ProjectLocalFitting[];
  ducts: readonly ProjectLocalDuct[];
  heads: readonly ProjectLocalHead[];
  supports: readonly ProjectLocalSupport[];
  bom?: readonly ProjectLocalBomLine[];
}

export interface ProjectLocalChangeInput {
  id: string;
  approvedDrawing: {
    document: Fact<DocumentRevisionRef>;
    approval: Fact<"approved" | "not_approved">;
  };
  revisedDrawing?: {
    document: Fact<DocumentRevisionRef>;
    approval: Fact<"approved" | "not_approved">;
  };
  changeRequest: LocalChangeRequestFacts;
  baseline: ProjectLocalPlan;
  proposed: ProjectLocalPlan;
  /** Only a calculation-backed system maximum is accepted for the local part-rating comparison. */
  systemMaximumWorkingPressure?: Fact<{
    value: number;
    unit: "Pa" | "kPa" | "bar" | "psi";
    basis: "system_maximum" | "spot_reading" | "design_intent";
  }>;
  baselineCalculation?: Fact<DocumentRevisionRef & {
    drawing: DocumentRevisionRef;
    affectedEntityIds: string[];
    referencePointIds: string[];
  }>;
  revisedCalculation?: Fact<DocumentRevisionRef & {
    drawing: DocumentRevisionRef;
    affectedEntityIds: string[];
    referencePointIds: string[];
  }>;
}

export interface ProjectLocalPlanSummary extends LocalPlanGeometryResult {
  sourceDrawing: DocumentRevisionRef | null;
}

export interface ProjectLocalHeadDelta {
  headId: string;
  moved: boolean | null;
  distanceM: number | null;
  baselinePosition: LocalPoint3 | null;
  proposedPosition: LocalPoint3 | null;
  roomId: string | null;
  ceilingId: string | null;
  state: LocalChangeVerificationState;
  missingInputs: string[];
}

export interface ProjectLocalBomDelta {
  itemId: string;
  kind: ProjectLocalBomLine["kind"];
  baselineQuantity: number | null;
  proposedQuantity: number | null;
  quantityDelta: number | null;
  baselineCutLengthM: number | null;
  proposedCutLengthM: number | null;
  cutLengthDeltaM: number | null;
  derivedBaselineQuantity: number | null;
  derivedProposedQuantity: number | null;
  baselineMatchesDerived: boolean | null;
  proposedMatchesDerived: boolean | null;
  state: LocalChangeVerificationState;
}

export interface ProjectLocalPressureCheck {
  partId: string;
  partKind: "pipe" | "fitting";
  systemMaximumPressure: { value: number; unit: "Pa" | "kPa" | "bar" | "psi"; basis: "system_maximum" | "spot_reading" | "design_intent" } | null;
  partPublishedPressureRating: { value: number; unit: "Pa" | "kPa" | "bar" | "psi" } | null;
  comparison: "system_exceeds_reported_rating" | "system_not_above_reported_rating" | null;
  state: "source_pending" | "input_missing";
  evidenceIds: string[];
  missingInputs: string[];
}

export interface ProjectLocalRequiredArtifact {
  id: string;
  title: string;
  state: "required" | "may_be_required" | "manual_review" | "not_triggered" | "unknown";
  reason: string;
  subjectIds: string[];
  sourceRefs: readonly ProjectSourceReference[];
}

export interface ProjectLocalChangeReport {
  version: "1";
  ruleIds: string[];
  baseline: ProjectLocalPlanSummary;
  proposed: ProjectLocalPlanSummary;
  delta: LocalPlanGeometryDelta;
  stableContextState: LocalChangeVerificationState;
  headDeltas: ProjectLocalHeadDelta[];
  bomDeltas: ProjectLocalBomDelta[];
  changedContextIds: string[];
  pressureChecks: ProjectLocalPressureCheck[];
  requiredArtifacts: ProjectLocalRequiredArtifact[];
  physicalClearanceMeaning: "modeled_straight_pipe_envelope_only";
}
