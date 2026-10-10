export type Intent = "prepare_from_drawing" | "adapt_to_site";
export type LengthUnit = "m" | "mm" | "ft" | "in";
export interface Length { value: number; unit: LengthUnit }
export interface Point3 { x: number; y: number; z: number; unit: LengthUnit; frameId: string }
/** Proposed values may be calculated, but never promoted to confirmed site facts. */
export interface Value<T> {
  value: T | null;
  status: "confirmed" | "proposed" | "unknown";
  evidenceIds: string[];
  reason: string | null;
}
export interface Evidence { id: string; subjectIds: string[]; description: string }
export interface Source {
  id: string; url: string; document: string; revision: string; pages: string;
  sha256: string;
}
export type ConnectionMethod = "cpvc_socket_solvent" | "steel_threaded" | "unsupported";
export type ProcedureId = "spears-fg3-socket-1in" | "anvil-351-threaded";
export interface PipeProduct {
  id: string; kind: "pipe"; label: string; nominalSize: string;
  outsideDiameter: Length; connection: ConnectionMethod;
  preparation?: "spears-fg3" | "steel_threaded";
  limitations?: string[];
  sourceIds: string[];
}
export interface ElbowProduct {
  id: string; kind: "elbow_90"; label: string; nominalSize: string;
  connection: ConnectionMethod; compatiblePipeIds: string[];
  procedureId?: ProcedureId;
  limitations?: string[];
  centerToFace: Length | null;
  /** G: centerline intersection to socket bottom. No field tolerance is added. */
  centerToSocketBottom: Length | null;
  publishedDimensionTolerance: Length | null;
  sourceIds: string[];
}
export interface Catalog {
  /** The application's SINGLE configVersion, including this catalog and procedure. */
  configVersion: string;
  evidenceClass: "manufacturer_document" | "synthetic_arithmetic";
  products: (PipeProduct | ElbowProduct)[];
  sources: Source[];
}
export interface Node {
  id: string;
  position: Value<Point3>;
  datum: "fitting_center" | "physical_pipe_end" | "tie_in" | "scope_interface";
  /** Required for tie_in only; positive offset shortens the pipe. */
  netCutOffset?: Value<Length>;
}
export interface Piece {
  id: string;
  sourceSegmentIds: string[];
  productId: string;
  startNodeId: string;
  endNodeId: string;
  subassemblyId: string;
  disposition: "new" | "proposed_reuse";
}
/** Bound to the selected pair; changing products invalidates this input. */
export interface ThreadMakeup {
  pipeProductId: string; fittingProductId: string;
  axialEngagement: Value<Length>;
}
export interface Port {
  id: string;
  pieceId: string;
  end: "start" | "end";
  /** Shop vs field is planning intent, not an observation. */
  location: "shop" | "field";
  /** Face to final pipe end, scoped to fittingId/portId. Never inferred from turns. */
  threadMakeup?: ThreadMakeup;
}
export interface Fitting {
  id: string; sourceEntityIds: string[]; productId: string; nodeId: string;
  ports: Port[];
}
export interface Accessory {
  id: string; kind: "head" | "support" | "coupling" | "other";
  productId: string | null; quantity: Value<number>; attachedPieceIds: string[];
  /** Kept visible: these products/procedures are outside the first catalog. */
  reason: string;
}
export interface FabricationInput {
  projectId: string; packageId: string; planId: string; baselinePlanId: string;
  intent: Intent; inputRevision: number; configVersion: string;
  sourceDrawing: { id: string; revision: string; approval: "approved" | "not_approved" | "unknown" };
  planRole: "baseline" | "candidate";
  selectedPlanId: string | null;
  siteEvidenceIds: string[];
  frame: { id: string; lengthUnit: LengthUnit };
  nodes: Node[];
  /** Ordered along the run; endpoint direction may differ. No route search. */
  pieces: Piece[];
  fittings: Fitting[];
  accessories: Accessory[];
  evidence: Evidence[];
  assemblyConditions: {
    workAreaAccess: Value<boolean>;
    /** Joint IDs are fittingId/portId. Includes full insertion and quarter-turn movement. */
    jointMovement: Record<string, Value<boolean>>;
    /** Reviewed, project-specific set/cure plan with manufacturer section and conditions. */
    curePlan: Value<string>;
    /** Preparation/sealant/tool plan scoped to each threaded joint and product pair. */
    threadedJointPlan?: Record<string, {
      pipeProductId: string; fittingProductId: string;
      plan: Value<string>; movement: Value<boolean>;
    }>;
  };
}
export interface Metric {
  value: number | null; unit: "m" | "each";
  basis: "confirmed_inputs" | "proposed_inputs" | "unknown";
  reasons: string[]; evidenceIds: string[];
}
export interface EndpointTakeout {
  nodeId: string;
  datum: Node["datum"];
  fittingId: string | null; portId: string | null;
  centerToFaceM: number | null;
  insertionM: number | null;
  netTakeout: Metric;
  sourceIds: string[];
}
export interface CutRow {
  pieceId: string; callout: number; sourceSegmentIds: string[];
  productId: string; subassemblyId: string; disposition: Piece["disposition"];
  start: Value<Point3>; end: Value<Point3>;
  centerline: Metric; cutLength: Metric;
  takeouts: [EndpointTakeout, EndpointTakeout];
  formula: "centerline - start.netTakeout - end.netTakeout";
}
export interface MaterialRow {
  id: string; kind: "pipe" | "fitting" | Accessory["kind"] | "consumable";
  productId: string | null; entityIds: string[];
  quantity: Metric;
  centerlineLength: Metric | null;
  cutLength: Metric | null;
  status: "supported" | "unsupported" | "unresolved";
  reasons: string[];
}
export interface Joint {
  id: string; callout: number; pieceId: string; end: "start" | "end";
  nodeId: string; fittingId: string | null; portId: string | null;
  subassemblyId: string; location: "shop" | "field";
  orientation: string | null;
  procedureId: ProcedureId | null;
  reasons: string[];
}
export interface Operation {
  id: string; number: number; code: string; pieceIds: string[]; jointIds: string[];
  predecessorId: string | null; instruction: string; sourceIds: string[];
  status: "planned" | "needs_confirmation" | "unsupported";
  reasons: string[];
}
/** JSON handoff DTO for #13. No PDF/CSV or application persistence behavior. */
export interface FabricationOutput {
  schemaVersion: "fabrication/v1";
  projectId: string; packageId: string; planId: string; baselinePlanId: string;
  intent: Intent; inputRevision: number; configVersion: string;
  sourceDrawing: FabricationInput["sourceDrawing"];
  planRole: FabricationInput["planRole"]; selectedPlanId: string | null;
  siteEvidenceIds: string[];
  evidenceClass: Catalog["evidenceClass"];
  selectedProducts: Catalog["products"];
  frame: FabricationInput["frame"];
  rounding: "none; metres in calculation; renderer must declare display rounding";
  quantityBasis: "modeled pieces/spans; physical splits and purchasing stock require separate detailing";
  fittings: (Fitting & { callout: string; position: Value<Point3>; jointIds: string[] })[];
  materials: MaterialRow[]; cuts: CutRow[]; joints: Joint[]; operations: Operation[];
  subassemblies: { id: string; pieceIds: string[]; jointIds: string[] }[];
  gaps: { subjectId: string; reason: string }[];
  sources: Source[];
  evidence: Evidence[];
  constructionApproval: "not_assessed";
}
