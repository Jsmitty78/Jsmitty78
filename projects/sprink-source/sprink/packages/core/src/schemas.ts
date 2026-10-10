import { Type, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { FACT_OPTIONS } from "./types.js";

const identifier = () => Type.String({ minLength: 1 });
const evidenceIds = () => Type.Array(identifier(), { uniqueItems: true });
const options = <T extends string>(values: readonly T[]) => Type.Union(values.map(value => Type.Literal(value)));

export function factSchema<T extends TSchema>(value: T) {
  return Type.Object({
    value: Type.Union([value, Type.Null()]),
    confirmed: Type.Boolean(),
    evidenceIds: evidenceIds(),
    source: Type.Union([Type.Literal("manual"), Type.Literal("model"), Type.Literal("fixture")]),
  }, { additionalProperties: false });
}

export const OrientationSchema = Type.Union([
  Type.Literal("pendent"), Type.Literal("upright"), Type.Literal("sideways"), Type.Literal("unknown"),
]);
export const HeadFactsSchema = Type.Object({
  model: factSchema(Type.String()),
  installation: factSchema(Type.Union([Type.Literal("installed"), Type.Literal("uninstalled")])),
  mounting: factSchema(Type.Union([Type.Literal("standard"), Type.Literal("recessed")])),
  orientation: factSchema(OrientationSchema),
  verticalReference: factSchema(Type.Union([Type.Literal("gravity"), Type.Literal("verified_record"), Type.Literal("unknown")])),
  escutcheon: Type.Optional(factSchema(options(FACT_OPTIONS.escutcheon))),
  bulbCondition: Type.Optional(factSchema(options(FACT_OPTIONS.bulbCondition))),
  installationWrench: Type.Optional(factSchema(options(FACT_OPTIONS.installationWrench))),
  threadStandard: Type.Optional(factSchema(options(FACT_OPTIONS.threadStandard))),
  installationTorqueFtLb: Type.Optional(factSchema(Type.Number({ minimum: 0 }))),
  construction: Type.Optional(factSchema(options(FACT_OPTIONS.construction))),
  fieldFinish: Type.Optional(factSchema(options(FACT_OPTIONS.fieldFinish))),
  leakage: Type.Optional(factSchema(options(FACT_OPTIONS.leakage))),
  corrosion: Type.Optional(factSchema(options(FACT_OPTIONS.corrosion))),
  workingPressurePsi: Type.Optional(factSchema(Type.Number({ minimum: 0 }))),
  approvalBasis: Type.Optional(factSchema(options(FACT_OPTIONS.approvalBasis))),
  pressureBasis: Type.Optional(factSchema(options(FACT_OPTIONS.pressureBasis))),
}, { additionalProperties: false });
export const HeadFactsPatchSchema = Type.Partial(HeadFactsSchema, { additionalProperties: false });
export const EvidenceSchema = Type.Object({
  id: identifier(),
  targetId: identifier(),
  superseded: Type.Optional(Type.Boolean()),
  invalidated: Type.Optional(Type.Boolean()),
  spatial: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, { additionalProperties: false });
export const RuleContextSchema = Type.Object({
  targetId: identifier(),
  taskRevision: Type.Integer({ minimum: 0 }),
  observations: Type.Array(EvidenceSchema),
}, { additionalProperties: false });

export const MeasurementEndpointSchema = Type.Object({
  coordinateFrameId: identifier(),
  captureSessionId: identifier(),
  timestamp: Type.Number({ minimum: 0 }),
  position: Type.Tuple([Type.Number(), Type.Number(), Type.Number()]),
  hit: Type.Union([Type.Literal("existing_plane"), Type.Literal("estimated_plane"), Type.Literal("none"), Type.Literal("fallback"), Type.Literal("fixture")]),
  tracking: Type.Union([Type.Literal("normal"), Type.Literal("limited"), Type.Literal("unavailable")]),
  evidenceIds: evidenceIds(),
}, { additionalProperties: false });

const measurementBase = {
  id: identifier(),
  targetId: identifier(),
  unit: Type.Literal("m"),
  evidenceIds: evidenceIds(),
};
export const MeasurementSchema = Type.Union([
  Type.Object({
    ...measurementBase,
    method: Type.Union([Type.Literal("ar_raycast"), Type.Literal("fixture")]),
    from: MeasurementEndpointSchema,
    to: MeasurementEndpointSchema,
  }, { additionalProperties: false }),
  Type.Object({
    ...measurementBase,
    method: Type.Literal("manual"),
    valueMeters: Type.Number({ minimum: 0 }),
    fromLabel: identifier(),
    toLabel: identifier(),
  }, { additionalProperties: false }),
]);

export { Check as checkSchema };
