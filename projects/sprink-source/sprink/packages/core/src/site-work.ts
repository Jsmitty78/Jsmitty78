import { Type, type Static } from 'typebox';
import type { PackagePlan } from './work-package.js';

const text = Type.String({ minLength: 1, maxLength: 4000 });
const point = Type.Object({ x: Type.Number({ minimum: 0, maximum: 1 }), y: Type.Number({ minimum: 0, maximum: 1 }) }, { additionalProperties: false });
export const ReadingItemSchema = Type.Object({
  id: text, kind: Type.Enum(['pipe', 'head', 'duct', 'dimension']), label: text,
  points: Type.Array(point, { minItems: 1, maxItems: 8 }),
  field: Type.Union([text, Type.Null()]), value: Type.Union([Type.Number(), Type.Null()]),
  unit: Type.Union([Type.Enum(['mm', 'm', 'in', 'ft']), Type.Null()]),
  evidence: text, uncertain: Type.Boolean(),
}, { additionalProperties: false });
export const SiteReadingSchema = Type.Object({ items: Type.Array(ReadingItemSchema, { maxItems: 80 }), notes: text }, { additionalProperties: false });
export type ReadingItem = Static<typeof ReadingItemSchema>;
export type EvidenceImage = { id: string; originalAssetId: string; imageAssetId: string; page: number; width: number; height: number; role: 'drawing' | 'site'; synthetic: boolean; label: string };
export type ReadingRequest = { evidenceId: string; instruction: string; crop: { x: number; y: number; width: number; height: number } | null };
export type SiteReading = Static<typeof SiteReadingSchema> & { id: string; evidenceId: string; inputRevision: number; configVersion: string; reviewedAt?: string; reviewedBy?: string; originalItems?: ReadingItem[]; acceptedIds?: string[] };
export type SiteMeasurement = { field: string; subjectIds: string[]; value: number | null; unit: 'mm' | 'm' | 'in' | 'ft'; reason: string; evidenceId: string | null; synthetic: boolean; confirmed: boolean; unavailableReason: string | null };
export const reviewTopics = ['supports', 'assembly', 'heads', 'hydraulics'] as const;
export type ReviewCheck = { topic: typeof reviewTopics[number]; answer: string; evidence: string };
export type DesignerReview = { id: string; planId: string; inputRevision: number; configVersion: string; fingerprint: string; reviewer: string; recordedAt: string; decision: 'accepted' | 'conditional' | 'revise'; conditions: string; evidenceIds: string[]; checks?: ReviewCheck[]; plan?: PackagePlan };
export type SiteWork = { evidence: EvidenceImage[]; readingRequest: ReadingRequest | null; readings: SiteReading[]; measurements: Array<SiteMeasurement & { inputRevision: number }>; reviews: DesignerReview[] };
export const emptySiteWork = (): SiteWork => ({ evidence: [], readingRequest: null, readings: [], measurements: [], reviews: [] });
export const measurementFields = [
  'span.length', 'pipeElevation', 'duct.min.x', 'duct.min.y', 'duct.min.z', 'duct.max.x', 'duct.max.y', 'duct.max.z',
  'workEnvelope.min.x', 'workEnvelope.min.y', 'workEnvelope.min.z', 'workEnvelope.max.x', 'workEnvelope.max.y', 'workEnvelope.max.z',
  'requiredPipeClearance', 'fittingEnvelopeRadius', 'assemblyEnvelopeRadius',
] as const;
