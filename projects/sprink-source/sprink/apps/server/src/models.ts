import type { HeadFacts, Measurement, RuleResult, PlanComparison, MeasurementValidation } from '@sprink/core';

export interface PlanModel {
  revision: number;
  targetId: string;
  model: string;
  orientation: string;
  lengthMeters: number;
  drawing?: import("@sprink/core").DrawingModel;
}
export interface Observation {
  id: string;
  targetId: string;
  assetId: string;
  originalAssetId: string;
  capturedAt: string;
  source: 'fixture' | 'ios_camera' | 'ios_ar' | 'file';
  synthetic: boolean;
  digest: string;
  width: number;
  height: number;
  spatial?: Record<string, unknown>;
  superseded?: boolean;
}
export interface EvidenceRequest {
  id: string;
  kind: 'capture' | 'measurement' | 'confirmation';
  targetId: string;
  reason: string;
  fields: string[];
  status: 'open' | 'answered' | 'unavailable' | 'superseded';
  baseRevision: number;
  planRevision: number;
  answer?: { id: string; observationIds: string[]; measurementIds: string[]; unavailableReason?: string };
}
export interface Candidate {
  id: string;
  targetId: string;
  reason: string;
  facts: Partial<HeadFacts>;
  createdAt: string;
}
export interface Finding {
  id: string;
  targetId: string;
  description: string;
  evidenceIds: string[];
  status: 'unverified';
  createdAt: string;
}
export interface ValidationReport {
  taskRevision: number;
  planRevision: number;
  checkedAt: string;
  rule: RuleResult;
  /** All adopted conditions; rule remains the orientation result for older clients. */
  rules: RuleResult[];
  comparison: PlanComparison;
  measurements: MeasurementValidation[];
  missingInputs: string[];
}
export interface Artifact {
  id: string;
  title: string;
  createdAt: string;
  taskRevision: number;
  planRevision: number;
  synthetic: boolean;
  targetId: string;
  plan: PlanModel;
  facts: HeadFacts;
  observations: Observation[];
  measurements: Measurement[];
  findings: Finding[];
  adoptedRules: unknown[];
  validation: ValidationReport;
  unresolved: string[];
  scope: string;
}
export interface TaskSnapshot {
  id: string;
  title: string;
  targetId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  state: 'active' | 'waiting' | 'review_ready' | 'cancelled';
  plan: PlanModel;
  facts: HeadFacts;
  candidates: Candidate[];
  findings: Finding[];
  observations: Observation[];
  measurements: Measurement[];
  requests: EvidenceRequest[];
  validation: ValidationReport | null;
  artifact: Artifact | null;
}
export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
