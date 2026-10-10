import { Type, type Static } from 'typebox';

const id = Type.String({ minLength: 1, maxLength: 120, pattern: '^[a-zA-Z0-9][a-zA-Z0-9_.-]*$' });
const text = Type.String({ minLength: 1, maxLength: 8000 });
const choices = <const T extends string[]>(...values: T) => Type.Enum<T>(values);
const nullableText = Type.Union([text, Type.Null()]);
const ids = Type.Array(id, { uniqueItems: true, maxItems: 5000 });
const revision = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const object = <T extends Record<string, import('typebox').TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const list = <T extends import('typebox').TSchema>(items: T) => Type.Array(items, { maxItems: 5000 });
export const PackageIntentSchema = Type.Union([Type.Literal('prepare_from_drawing'), Type.Literal('adapt_to_site')]);
export const QuantityValueSchema = Type.Union([
  object({ value: Type.Number(), unit: text, reason: Type.Null(), basis: choices('confirmed_inputs', 'proposed_inputs') }),
  object({ value: Type.Null(), unit: text, reason: text, basis: Type.Literal('unknown') }),
]);
const frame = object({ id, lengthUnit: Type.Literal('mm'), axes: Type.Literal('right_handed_z_up') });
const point = object({ x: Type.Number(), y: Type.Number(), z: Type.Number() });
const port = object({ id, position: Type.Union([point, Type.Null()]), unknownReason: nullableText });
const endpoint = object({ entityId: id, portId: id });
export const PackagePlanSchema = object({
  id, coordinateFrame: frame, confirmation: Type.Union([Type.Literal('proposed'), Type.Literal('confirmed')]),
  entities: list(object({ id, kind: choices('pipe', 'fitting', 'head', 'support', 'tie_in', 'unsupported'), productId: Type.Union([text, Type.Null()]), ports: list(port) })),
  connections: list(object({ id, from: endpoint, to: endpoint })),
});
const source = object({ description: text, assetId: Type.Union([id, Type.Null()]), page: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]) });
export const PackageFactSchema = object({
  id, subjectIds: ids, field: text,
  value: Type.Union([Type.Number(), Type.String({ maxLength: 8000 }), Type.Boolean(), Type.Null()]),
  unit: nullableText, unknownReason: nullableText,
  confirmation: Type.Union([Type.Literal('proposed'), Type.Literal('confirmed')]),
  context: Type.Union([Type.Literal('observed'), Type.Literal('installed'), Type.Literal('detailing')]),
  provenance: Type.Optional(choices('machine_proposal', 'user_entered', 'confirmed_evidence', 'synthetic_assumption')),
  source,
});
const sheetPoint = object({ x: Type.Number(), y: Type.Number() });
const lengthUnit = choices('mm', 'm', 'in', 'ft');
/**
 * How one view of the sheet maps to the plan frame. Sheet coordinates are PDF points of the page
 * at 1x (Y down) or image pixels (Y down). Plan millimetres are
 * `rotate(rotationDeg) * ((sx - origin.x) * scale, -(sy - origin.y) * scale)`, Z up.
 */
export const DrawingViewSchema = object({
  sheetUnit: choices('pdf_pt', 'image_px'),
  workArea: Type.Union([object({ x: Type.Number(), y: Type.Number(), width: Type.Number({ exclusiveMinimum: 0 }), height: Type.Number({ exclusiveMinimum: 0 }) }), Type.Null()]),
  calibration: Type.Union([object({
    method: choices('two_point', 'printed_scale'),
    a: Type.Union([sheetPoint, Type.Null()]), b: Type.Union([sheetPoint, Type.Null()]),
    realDistance: Type.Union([object({ value: Type.Number({ exclusiveMinimum: 0 }), unit: lengthUnit }), Type.Null()]),
    printedScale: nullableText,
    reference: text,
    /** Plan-length uncertainty of one picked point, from the pick tolerance; not a construction tolerance. */
    pointUncertaintyMm: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  }), Type.Null()]),
  frame: object({ origin: sheetPoint, rotationDeg: Type.Number({ minimum: -360, maximum: 360 }) }),
  /** Set when the upload is a copy (raster, crop, rotation) of another document; names the original. */
  derivativeOf: nullableText,
});
export const DrawingRefSchema = object({
  assetId: id, drawingId: id, revision: text, page: Type.Integer({ minimum: 1 }),
  approval: choices('unreviewed', 'approved', 'superseded'),
  scale: QuantityValueSchema,
  view: Type.Optional(DrawingViewSchema),
});
const scope = object({ coordinateFrame: frame, includedEntityIds: ids, excludedEntityIds: ids, tieInEntityIds: ids });
const change = object({ id, description: text, affectedEntityIds: ids, factIds: ids });
const inputFields = {
  title: text, sourceDrawing: Type.Union([DrawingRefSchema, Type.Null()]),
  baselinePlan: Type.Union([PackagePlanSchema, Type.Null()]), scope: Type.Union([scope, Type.Null()]),
  siteFacts: list(PackageFactSchema), detailing: list(PackageFactSchema), changeRequest: Type.Union([change, Type.Null()]),
};
export const PackageInputsSchema = object(inputFields);
export const CreateWorkPackageSchema = object({
  projectId: id, intent: PackageIntentSchema, title: text,
  sourceDrawing: Type.Optional(inputFields.sourceDrawing), baselinePlan: Type.Optional(inputFields.baselinePlan),
  scope: Type.Optional(inputFields.scope), siteFacts: Type.Optional(inputFields.siteFacts),
  detailing: Type.Optional(inputFields.detailing), changeRequest: Type.Optional(inputFields.changeRequest),
});
export const EditWorkPackageSchema = object({ expectedRevision: revision, patch: Type.Partial(PackageInputsSchema, { additionalProperties: false }) });
export const SelectPackagePlanSchema = object({ expectedRevision: revision, planId: id });
export const AnswerPackageRequestSchema = object({
  expectedRevision: revision, requestId: id,
  value: Type.Union([Type.String({ maxLength: 8000 }), Type.Number(), Type.Boolean(), Type.Null()]),
  unavailableReason: nullableText,
});
export const StartPackageRunSchema = object({
  expectedRevision: revision,
  goal: choices('prepare_from_drawing', 'adapt_to_site', 'export_selected_package', 'read_site_evidence'),
});
const binding = { id, inputRevision: revision, configVersion: text };
const gap = object({ id, subjectIds: ids, reason: text });
export const CandidateSetSchema = object({
  ...binding, baselinePlanId: id, searchDescription: text,
  candidates: list(object({ plan: PackagePlanSchema, metrics: list(object({ name: text, quantity: QuantityValueSchema })) })),
  rejected: list(object({ id, reason: text })), gaps: list(gap),
});
export const PackageResultSchema = object({
  ...binding, planId: id,
  materials: list(object({ id, entityIds: ids, description: text, quantity: QuantityValueSchema })),
  cuts: list(object({ id, pieceId: id, sourceEntityIds: ids, length: QuantityValueSchema })),
  assembly: list(object({ id, step: Type.Integer({ minimum: 1 }), pieceIds: ids, jointIds: ids, instruction: text, procedureRef: nullableText, unresolved: Type.Array(text) })),
  evaluations: list(object({ id, subjectIds: ids, status: choices('pass', 'fail', 'unknown', 'not_applicable'), reason: text, sourceRefs: Type.Array(text) })),
  gaps: list(gap),
});
export const PackageRequestSchema = object({ ...binding, question: text, subjectIds: ids });
export const PackageArtifactSchema = object({
  ...binding, planId: id, resultId: id, assetId: id,
  kind: choices('pdf', 'bom_csv', 'cut_csv', 'manifest'),
});
export const PublishPackageOutputsSchema = object({
  candidates: Type.Optional(CandidateSetSchema), results: Type.Optional(list(PackageResultSchema)),
  requests: Type.Optional(list(PackageRequestSchema)), artifacts: Type.Optional(list(PackageArtifactSchema)),
});
export type PackageIntent = Static<typeof PackageIntentSchema>;
export type PackagePlan = Static<typeof PackagePlanSchema>;
export type DrawingRef = Static<typeof DrawingRefSchema>;
export type DrawingView = Static<typeof DrawingViewSchema>;
export type PackageInputs = Static<typeof PackageInputsSchema>;
export type CreateWorkPackage = Static<typeof CreateWorkPackageSchema>;
export type CandidateSet = Static<typeof CandidateSetSchema>;
export type PackageResult = Static<typeof PackageResultSchema>;
export type PackageRequest = Static<typeof PackageRequestSchema>;
export type PackageArtifact = Static<typeof PackageArtifactSchema>;
export type PublishPackageOutputs = Static<typeof PublishPackageOutputsSchema>;
export type StartPackageRun = Static<typeof StartPackageRunSchema>;
export type PackageRunStatus = 'running' | 'waiting_input' | 'completed' | 'blocked' | 'interrupted' | 'failed' | 'cancelled';
export interface PackageRun {
  id: string; goal: StartPackageRun['goal']; inputRevision: number; configVersion: string;
  status: PackageRunStatus; progress: string; stopReason: string | null; startedAt: string; updatedAt: string;
}
export interface WorkPackageSnapshot extends PackageInputs {
  siteWork?: import('./site-work.js').SiteWork;
  id: string; projectId: string; intent: PackageIntent; inputRevision: number; configVersion: string;
  selectedPlan: PackagePlan | null;
  outputs: { candidates: CandidateSet | null; results: PackageResult[]; requests: PackageRequest[]; artifacts: PackageArtifact[] };
  answers: Array<{ requestId: string; inputRevision: number; value: string | number | boolean | null; unavailableReason: string | null }>;
  run: PackageRun | null; createdAt: string; updatedAt: string;
}
export interface PackageAsset {
  id: string; packageId: string; projectId: string; filename: string; mimeType: string;
  bytes: number; sha256: string; purpose: 'source' | 'artifact';
}
