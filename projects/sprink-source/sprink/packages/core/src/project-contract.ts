import type { SfProjectBasisResult, SfProjectFacts } from "./sf-project-basis.js";
import type { ManufacturerExtraFacts } from "./project-rules/manufacturer-extra.js";
import type { Fact, HeadFacts, RuleResult, SourceReference } from "./types.js";
import type { LocalChangeVerificationState, ProjectLocalChangeInput, ProjectLocalChangeReport } from "./local-change-contract.js";

/** Executable packs are deliberately explicit. Future IDs become valid only with an implementation. */
export const PROJECT_RULE_PACK_IDS = Object.freeze([
  "tyco-tfp171-head",
  "tyco-tfp171-extra",
  "sf-project-basis",
  "sf-supports-2025",
  "sf-local-change-2025",
] as const);
export type ProjectRulePackId = (typeof PROJECT_RULE_PACK_IDS)[number];

export type ProjectSystemType = "wet" | "dry" | "preaction" | "deluge" | "other";
export type ProjectSprinklerType = "standard_spray" | "residential" | "cmsa" | "esfr" | "other";
export type ProjectStorageScope = "non_storage" | "storage" | "unknown";

/** Unit-bearing quantities accepted by the project API. No quantity implies compliance by itself. */
export type ProjectQuantity =
  | { value: number; unit: "m" | "ft" | "in" }
  | { value: number; unit: "Pa" | "kPa" | "bar" | "psi" }
  | { value: number; unit: "N_m" | "ft_lb" };
export type ProjectQuantityUnit = ProjectQuantity["unit"];
export type ProjectQuantityDimension = "length" | "pressure" | "torque";
export type NormalizedProjectQuantity =
  | { value: number; unit: "m" }
  | { value: number; unit: "psi" }
  | { value: number; unit: "ft_lb" };

/** Project-level scope is optional input, but any supplied claim retains Fact confirmation/evidence. */
export interface ProjectScopeFacts {
  systemType?: Fact<ProjectSystemType>;
  sprinklerType?: Fact<ProjectSprinklerType>;
  storage?: Fact<ProjectStorageScope>;
}

/** SF jurisdiction, standard and permit basis live only in this SF-specific fact set. */
export interface ProjectFacts extends ProjectScopeFacts {
  sfNfpa13?: Partial<SfProjectFacts>;
  hazardClassification?: Fact<"light" | "ordinary_1" | "ordinary_2" | "extra_1" | "extra_2" | "other">;
}

export type ProjectHeadFacts = Partial<Omit<HeadFacts, "installationTorqueFtLb" | "workingPressurePsi">> & {
  installationTorque?: Fact<ProjectQuantity>;
  workingPressure?: Fact<ProjectQuantity>;
};

export interface ProjectHead {
  id: string;
  facts?: ProjectHeadFacts;
  manufacturerExtra?: ManufacturerExtraFacts;
}

export interface ProjectSupportFacts {
  use?: Fact<"hanger" | "sway_brace" | "other">;
  fastenerType?: Fact<"powder_driven_stud" | "other">;
  substrate?: Fact<"concrete" | "other">;
  installationState?: Fact<"existing" | "new">;
  pipeMovedOrAltered?: Fact<"yes" | "no">;
  hangerHoldsProperly?: Fact<"yes" | "no">;
  crackedConcreteQualification?: Fact<"certified" | "prequalified" | "neither">;
}

export interface ProjectSupport {
  id: string;
  facts?: ProjectSupportFacts;
}

export interface DocumentRevisionRef {
  documentId: string;
  revision: string;
  edition?: string;
}

interface ProjectEvidenceBase {
  id: string;
  projectId: string;
  subjectIds: string[];
  superseded?: boolean;
  /** Explicitly marks a record as expired or revoked; evaluation never infers this from dates. */
  invalidated?: boolean;
  capturedAt?: string;
}

/** Non-photo records identify their immutable source-document revision. */
export type ProjectEvidence =
  | (ProjectEvidenceBase & { kind: "photo"; documentRevision?: DocumentRevisionRef })
  | (ProjectEvidenceBase & { kind: "permit" | "drawing" | "installation" | "calculation" | "inspection"; documentRevision: DocumentRevisionRef });

export interface ProjectEvaluationRequest {
  project: { id: string; revision: number; asOf: string };
  selectedRulePacks: ProjectRulePackId[];
  facts?: ProjectFacts;
  heads?: ProjectHead[];
  supports?: ProjectSupport[];
  evidence?: ProjectEvidence[];
  localChange?: ProjectLocalChangeInput;
}

/** The legacy source fields remain intact; edition and clause metadata are additive. */
export interface ProjectSourceReference extends SourceReference {
  documentId: string;
  edition?: string;
  clauses?: readonly string[];
}

export interface ProjectQuantityTrace {
  field: "installationTorque" | "workingPressure";
  input: ProjectQuantity;
  normalized: NormalizedProjectQuantity;
  /** Each published unit boundary used in the actual decision, including paired-unit checks. */
  comparisons?: readonly ProjectQuantityComparison[];
}

export interface ProjectQuantityComparison {
  unit: "N_m" | "ft_lb" | "bar" | "psi";
  value: number;
  minimum?: number;
  maximum: number;
  outcome: "pass" | "fail";
  sourceBasis: string;
}

/** Compliance outcomes preserve the existing RuleResult vocabulary and per-target semantics. */
export interface ProjectRuleResult extends RuleResult {
  packId: ProjectRulePackId;
  subjectIds: string[];
  requirementLevel: "requirement" | "recommendation";
  sourceRefs: readonly ProjectSourceReference[];
  quantityTrace?: readonly ProjectQuantityTrace[];
  verificationState?: LocalChangeVerificationState;
}

export interface ProjectBasisResult extends Omit<SfProjectBasisResult, "sourceRefs"> {
  sourceRefs: readonly ProjectSourceReference[];
}

export type CoverageState = "supported" | "source_pending" | "unimplemented";
export interface CoverageEntry {
  id: string;
  area: "nfpa13" | "tfp171" | "sf-admin" | "local-change";
  title: string;
  state: CoverageState;
  reason: string;
  sourceRefs: readonly ProjectSourceReference[];
  /** Present only when this catalog entry maps to a currently executable pack. */
  packId?: ProjectRulePackId;
  selected: boolean;
}

export interface ProjectEvaluationOutput {
  projectId: string;
  taskRevision: number;
  asOf: string;
  rules: ProjectRuleResult[];
  basis?: ProjectBasisResult;
  coverage: CoverageEntry[];
  missingInputs: string[];
  localChange?: ProjectLocalChangeReport;
}

export type ProjectInputErrorCode = "invalid_input" | "unknown_pack" | "duplicate_id";
export class ProjectInputError extends Error {
  constructor(readonly code: ProjectInputErrorCode, message: string, readonly paths: readonly string[] = []) {
    super(message);
    this.name = "ProjectInputError";
  }
}

export const PROJECT_QUANTITY_DIMENSION: Readonly<Record<ProjectQuantityUnit, ProjectQuantityDimension>> = Object.freeze({
  m: "length", ft: "length", in: "length",
  Pa: "pressure", kPa: "pressure", bar: "pressure", psi: "pressure",
  N_m: "torque", ft_lb: "torque",
});

const BASE_FACTORS: Readonly<Record<ProjectQuantityUnit, number>> = Object.freeze({
  m: 1, ft: 0.3048, in: 0.0254,
  Pa: 1, kPa: 1000, bar: 100000, psi: 6894.757293168,
  N_m: 1, ft_lb: 1.3558179483314004,
});

const NORMALIZED_UNIT: Readonly<Record<ProjectQuantityDimension, NormalizedProjectQuantity["unit"]>> = Object.freeze({
  length: "m", pressure: "psi", torque: "ft_lb",
});

/** Converts supported units only. Schema validation handles malformed/untrusted JSON first. */
export function normalizeProjectQuantity(quantity: ProjectQuantity, expected: ProjectQuantityDimension): NormalizedProjectQuantity {
  const actual = PROJECT_QUANTITY_DIMENSION[quantity.unit];
  if (actual !== expected) throw new ProjectInputError("invalid_input", `Expected a ${expected} quantity, received ${actual}.`, ["quantity.unit"]);
  if (!Number.isFinite(quantity.value) || quantity.value < 0) throw new ProjectInputError("invalid_input", "Quantity must be finite and non-negative.", ["quantity.value"]);
  const unit = NORMALIZED_UNIT[expected];
  const converted = quantity.unit === unit ? quantity.value : quantity.value * BASE_FACTORS[quantity.unit] / BASE_FACTORS[unit];
  // Preserve the full converted value. Boundary handling belongs to a rule's source-specific
  // comparison so meaningful overages are not rounded into a pass.
  const value = converted;
  if (!Number.isFinite(value)) throw new ProjectInputError("invalid_input", "Normalized quantity is not finite.", ["quantity.value"]);
  return { value, unit } as NormalizedProjectQuantity;
}

export function isProjectPackId(value: string): value is ProjectRulePackId {
  return (PROJECT_RULE_PACK_IDS as readonly string[]).includes(value);
}

export function toProjectSourceReference(source: SourceReference, documentId = source.document, edition?: string, clauses?: readonly string[]): ProjectSourceReference {
  return {
    ...source,
    documentId,
    ...(edition ? { edition } : {}),
    ...(clauses?.length ? { clauses: [...clauses] } : {}),
  };
}
