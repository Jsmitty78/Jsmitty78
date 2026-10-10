export interface Fact<T = string> {
  value: T | null;
  confirmed: boolean;
  evidenceIds: string[];
  source: "manual" | "model" | "fixture";
}

export type Orientation = "pendent" | "upright" | "sideways" | "unknown";

export const FACT_OPTIONS = Object.freeze({
  installation: ["installed", "uninstalled"],
  mounting: ["standard", "recessed"],
  orientation: ["pendent", "upright", "sideways", "unknown"],
  verticalReference: ["gravity", "verified_record", "unknown"],
  escutcheon: ["style_10", "style_20", "style_30", "style_40", "other"],
  bulbCondition: ["intact", "cracked", "liquid_loss"],
  installationWrench: ["w_type_6", "w_type_7", "other"],
  threadStandard: ["npt", "iso7_1", "other"],
  construction: ["new", "retrofit"],
  fieldFinish: ["factory_only", "field_painted", "field_plated", "field_coated"],
  leakage: ["absent", "present"],
  corrosion: ["absent", "present"],
  approvalBasis: ["ul_cul", "other"],
  pressureBasis: ["system_maximum", "spot_reading", "catalog_rating", "test_pressure"],
} as const);
Object.values(FACT_OPTIONS).forEach(Object.freeze);
export const NUMERIC_FACT_FIELDS = Object.freeze(["installationTorqueFtLb", "workingPressurePsi"] as const);
export const HEAD_FACT_FIELDS = Object.freeze([
  "model", "installation", "mounting", "orientation", "verticalReference", "escutcheon", "bulbCondition",
  "installationWrench", "threadStandard", "installationTorqueFtLb", "construction", "fieldFinish",
  "leakage", "corrosion", "workingPressurePsi", "approvalBasis", "pressureBasis",
] as const);
type Option<K extends keyof typeof FACT_OPTIONS> = (typeof FACT_OPTIONS)[K][number];

export interface HeadFacts {
  model: Fact<string>;
  installation: Fact<"installed" | "uninstalled">;
  mounting: Fact<"standard" | "recessed">;
  orientation: Fact<Orientation>;
  verticalReference: Fact<"gravity" | "verified_record" | "unknown">;
  escutcheon?: Fact<Option<"escutcheon">>;
  bulbCondition?: Fact<Option<"bulbCondition">>;
  installationWrench?: Fact<Option<"installationWrench">>;
  threadStandard?: Fact<Option<"threadStandard">>;
  installationTorqueFtLb?: Fact<number>;
  construction?: Fact<Option<"construction">>;
  fieldFinish?: Fact<Option<"fieldFinish">>;
  leakage?: Fact<Option<"leakage">>;
  corrosion?: Fact<Option<"corrosion">>;
  workingPressurePsi?: Fact<number>;
  approvalBasis?: Fact<Option<"approvalBasis">>;
  pressureBasis?: Fact<Option<"pressureBasis">>;
}

export interface Evidence {
  id: string;
  targetId: string;
  /** Only explicit supersession invalidates an immutable observation. */
  superseded?: boolean;
  /** Explicit expiry or revocation invalidates a project-evidence record. */
  invalidated?: boolean;
  spatial?: Record<string, unknown>;
}

export interface RuleContext {
  targetId: string;
  taskRevision: number;
  observations: Evidence[];
}

export type RuleStatus = "pass" | "fail" | "unknown" | "not_applicable";

export interface SourceReference {
  document: string;
  revision: string;
  page: number;
  url: string;
  purpose: string;
}

export interface RuleDefinition {
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly sourceRevision: string;
  readonly scope: string;
  readonly sources: readonly SourceReference[];
}

export interface RuleResult {
  ruleId: string;
  title?: string;
  scope?: string;
  targetId: string;
  status: RuleStatus;
  applicability: "applicable" | "not_applicable" | "unknown";
  reason: string;
  missingInputs: string[];
  evidenceIds: string[];
  sourceRefs: readonly SourceReference[];
  versions: { taskRevision: number; ruleVersion: string; sourceRevision: string };
}

export interface PlanComparison {
  status: "match" | "different" | "unknown";
  targetId: string;
  planned: Orientation;
  observed: Orientation | null;
  reason: string;
  missingInputs: string[];
  taskRevision: number;
}

export interface MeasurementEndpoint {
  coordinateFrameId: string;
  captureSessionId: string;
  /** Seconds on the capture session's monotonic clock. */
  timestamp: number;
  position: [number, number, number];
  hit: "existing_plane" | "estimated_plane" | "none" | "fallback" | "fixture";
  tracking: "normal" | "limited" | "unavailable";
  evidenceIds: string[];
}

interface MeasurementBase {
  id: string;
  targetId: string;
  unit: "m";
  evidenceIds: string[];
}

export type Measurement = MeasurementBase & (
  | { method: "ar_raycast" | "fixture"; from: MeasurementEndpoint; to: MeasurementEndpoint }
  | { method: "manual"; valueMeters: number; fromLabel: string; toLabel: string }
);

export interface MeasurementValidation {
  measurementId: string;
  status: "recorded" | "unknown";
  qualityRecorded: boolean;
  /** Recording valid input never certifies physical accuracy. */
  accuracy: "unknown";
  valueMeters: number | null;
  reason: string;
  missingInputs: string[];
  targetId: string;
  taskRevision: number;
}

export function emptyFacts(): HeadFacts {
  const empty = <T>(): Fact<T> => ({
    value: null,
    confirmed: false,
    evidenceIds: [],
    source: "manual",
  });
  return {
    model: empty<string>(),
    installation: empty<"installed" | "uninstalled">(),
    mounting: empty<"standard" | "recessed">(),
    orientation: empty<Orientation>(),
    verticalReference: empty<"gravity" | "verified_record" | "unknown">(),
    escutcheon: empty<Option<"escutcheon">>(),
    bulbCondition: empty<Option<"bulbCondition">>(),
    installationWrench: empty<Option<"installationWrench">>(),
    threadStandard: empty<Option<"threadStandard">>(),
    installationTorqueFtLb: empty<number>(),
    construction: empty<Option<"construction">>(),
    fieldFinish: empty<Option<"fieldFinish">>(),
    leakage: empty<Option<"leakage">>(),
    corrosion: empty<Option<"corrosion">>(),
    workingPressurePsi: empty<number>(),
    approvalBasis: empty<Option<"approvalBasis">>(),
    pressureBasis: empty<Option<"pressureBasis">>(),
  };
}
