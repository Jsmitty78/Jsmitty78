import { Type, type TSchema } from "typebox";
import { FACT_OPTIONS } from "./types.js";
import { PROJECT_RULE_PACK_IDS, type ProjectQuantityUnit } from "./project-contract.js";

const id = () => Type.String({ minLength: 1 });
const options = <T extends string>(values: readonly T[]) => Type.Union(values.map(value => Type.Literal(value)));
const factSchema = <T extends TSchema>(value: T) => Type.Object({
  value: Type.Union([value, Type.Null()]),
  confirmed: Type.Boolean(),
  evidenceIds: Type.Array(id(), { uniqueItems: true }),
  source: Type.Union([Type.Literal("manual"), Type.Literal("model"), Type.Literal("fixture")]),
}, { additionalProperties: false });
const documentRevision = Type.Object({
  documentId: id(), revision: id(), edition: Type.Optional(id()),
}, { additionalProperties: false });

function quantitySchema(units: readonly ProjectQuantityUnit[]) {
  return Type.Object({
    value: Type.Number({ minimum: 0 }),
    unit: options(units),
  }, { additionalProperties: false });
}

const optionalFact = <T extends TSchema>(value: T) => Type.Optional(factSchema(value));
const projectSfFacts = Type.Object({
  jurisdiction: optionalFact(options(["san_francisco", "other"] as const)),
  standard: optionalFact(options(["nfpa13", "nfpa13r", "nfpa13d", "other"] as const)),
  permitKind: optionalFact(options(["new_building_site_permit", "revision", "as_built", "other"] as const)),
  sitePermitCodeCycle: optionalFact(options(["2019", "2022", "2025", "other"] as const)),
  architecturalPermitCodeCycle: optionalFact(options(["2019", "2022", "2025", "other"] as const)),
  editionElection: optionalFact(options(["permit_basis", "owner_newer"] as const)),
  ownerRequestedEdition: optionalFact(options(["2016", "2022", "2025", "other"] as const)),
  originalFirePermitNumber: optionalFact(Type.String()),
  originalNfpa13Edition: optionalFact(options(["2016", "2022", "2025", "other"] as const)),
}, { additionalProperties: false });
const supportFacts = Type.Object({
  use: optionalFact(options(["hanger", "sway_brace", "other"] as const)),
  fastenerType: optionalFact(options(["powder_driven_stud", "other"] as const)),
  substrate: optionalFact(options(["concrete", "other"] as const)),
  installationState: optionalFact(options(["existing", "new"] as const)),
  pipeMovedOrAltered: optionalFact(options(["yes", "no"] as const)),
  hangerHoldsProperly: optionalFact(options(["yes", "no"] as const)),
  crackedConcreteQualification: optionalFact(options(["certified", "prequalified", "neither"] as const)),
}, { additionalProperties: false });

export const ProjectHeadFactsSchema = Type.Object({
  model: optionalFact(Type.String()),
  installation: optionalFact(options(FACT_OPTIONS.installation)),
  mounting: optionalFact(options(FACT_OPTIONS.mounting)),
  orientation: optionalFact(options(FACT_OPTIONS.orientation)),
  verticalReference: optionalFact(options(FACT_OPTIONS.verticalReference)),
  escutcheon: optionalFact(options(FACT_OPTIONS.escutcheon)),
  bulbCondition: optionalFact(options(FACT_OPTIONS.bulbCondition)),
  installationWrench: optionalFact(options(FACT_OPTIONS.installationWrench)),
  threadStandard: optionalFact(options(FACT_OPTIONS.threadStandard)),
  installationTorque: Type.Optional(factSchema(quantitySchema(["N_m", "ft_lb"]))),
  construction: optionalFact(options(FACT_OPTIONS.construction)),
  fieldFinish: optionalFact(options(FACT_OPTIONS.fieldFinish)),
  leakage: optionalFact(options(FACT_OPTIONS.leakage)),
  corrosion: optionalFact(options(FACT_OPTIONS.corrosion)),
  workingPressure: Type.Optional(factSchema(quantitySchema(["Pa", "kPa", "bar", "psi"]))),
  approvalBasis: optionalFact(options(FACT_OPTIONS.approvalBasis)),
  pressureBasis: optionalFact(options(FACT_OPTIONS.pressureBasis)),
}, { additionalProperties: false });

const manufacturerExtraFacts = Type.Object({
  installationWrenchEngagementArea: optionalFact(options(["wrench_flats", "other_area"] as const)),
  pipeThreadSealantAppliedBeforeHandTightening: optionalFact(options(["yes", "no"] as const)),
  headHandTightenedBeforeWrenchTightening: optionalFact(options(["yes", "no"] as const)),
  mountingPlateInstalledBeforeHandTightening: optionalFact(options(["yes", "no"] as const)),
  recessedFittingFaceToMountingSurfaceInterval: Type.Optional(factSchema(Type.Object({
    lower: Type.Number({ minimum: 0 }), upper: Type.Number({ minimum: 0 }), unit: Type.Literal("in"), phase: options(["planned", "as_built"] as const),
  }, { additionalProperties: false }))),
  manufacturerTemperatureRating: Type.Optional(factSchema(Type.Object({
    value: Type.Number({ exclusiveMinimum: 0 }),
    unit: options(["F", "C"] as const),
  }, { additionalProperties: false }))),
  manufacturerListedAgency: optionalFact(options(["ul", "c_ul", "fm", "lpcb_007k_04", "lpcb_094a_06", "vds", "lpcb_unspecified", "other"] as const)),
  sprinklerBodyFinish: optionalFact(options(["natural_brass", "pure_white_polyester", "signal_white_polyester", "chrome_plated", "other"] as const)),
  sprinklerSalesHemisphere: optionalFact(options(["eastern", "other"] as const)),
}, { additionalProperties: false });

const localLength = Type.Object({ value: Type.Number({ minimum: 0 }), unit: options(["m", "mm", "ft", "in"] as const) }, { additionalProperties: false });
const localPressure = Type.Object({ value: Type.Number({ minimum: 0 }), unit: options(["Pa", "kPa", "bar", "psi"] as const) }, { additionalProperties: false });
const localPoint = Type.Object({
  x: Type.Number(), y: Type.Number(), z: Type.Number(),
  unit: options(["m", "mm", "ft", "in"] as const),
  frameId: id(),
}, { additionalProperties: false });
const localConnection = Type.Object({ standard: id(), gender: options(["male", "female", "other"] as const) }, { additionalProperties: false });
const localBomLine = Type.Object({
  itemId: id(),
  kind: options(["pipe", "fitting", "head", "support", "other"] as const),
  quantity: factSchema(Type.Number({ minimum: 0 })),
  cutLength: Type.Optional(factSchema(localLength)),
}, { additionalProperties: false });
const localRoom = Type.Object({
  id: id(),
  ceiling: factSchema(Type.Object({ id: id(), kind: options(["flat", "unsupported"] as const), height: localLength }, { additionalProperties: false })),
}, { additionalProperties: false });
const localNode = Type.Object({
  id: id(),
  kind: options(["fitting_center", "tie_in", "other"] as const),
  position: factSchema(localPoint),
  fittingId: Type.Optional(id()),
  tieInNetCutOffset: Type.Optional(factSchema(localLength)),
}, { additionalProperties: false });
const localPipeSegment = Type.Object({
  id: id(), startNodeId: id(), endNodeId: id(),
  outsideDiameter: factSchema(localLength),
  nominalSize: factSchema(Type.String({ minLength: 1 })),
  material: factSchema(Type.String({ minLength: 1 })),
  pressureRating: factSchema(localPressure),
  connectionAtStart: factSchema(localConnection),
  connectionAtEnd: factSchema(localConnection),
  cutEndDatumAtStart: factSchema(options(["center_to_center", "physical_pipe_end"] as const)),
  cutEndDatumAtEnd: factSchema(options(["center_to_center", "physical_pipe_end"] as const)),
}, { additionalProperties: false });
const localFittingPort = Type.Object({
  segmentId: id(), endpoint: options(["start", "end"] as const), nodeId: id(),
  centerToFace: factSchema(localLength),
  insertionOrThreadMakeup: factSchema(localLength),
  connection: factSchema(localConnection),
}, { additionalProperties: false });
const localFitting = Type.Object({
  id: id(), kind: factSchema(options(["elbow_90", "unsupported"] as const)), centerNodeId: id(),
  ports: Type.Tuple([localFittingPort, localFittingPort]),
  nominalSize: factSchema(Type.String({ minLength: 1 })),
  material: factSchema(Type.String({ minLength: 1})),
  pressureRating: factSchema(localPressure),
  productId: factSchema(Type.String({ minLength: 1 })),
}, { additionalProperties: false });
const localDuct = Type.Object({
  id: id(), roomId: id(),
  geometry: factSchema(Type.Union([
    Type.Object({ kind: Type.Literal("axis_aligned_box"), min: localPoint, max: localPoint }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal("unsupported") }, { additionalProperties: false }),
  ])),
}, { additionalProperties: false });
const localHead = Type.Object({
  headId: id(), roomId: id(), ceilingId: id(), position: factSchema(localPoint),
  threadStandard: optionalFact(options(["npt", "iso7_1", "other"] as const)),
}, { additionalProperties: false });
const localSupport = Type.Object({ supportId: id(), attachedPipeSegmentIds: factSchema(Type.Array(id(), { uniqueItems: true })) }, { additionalProperties: false });
const localPlan = Type.Object({
  id: id(),
  sourceDrawing: factSchema(documentRevision),
  coordinateFrame: factSchema(Type.Object({ id: id(), lengthUnit: options(["m", "mm", "ft", "in"] as const) }, { additionalProperties: false })),
  nodes: Type.Array(localNode),
  rooms: Type.Array(localRoom),
  ducts: Type.Array(localDuct),
  segments: Type.Array(localPipeSegment),
  fittings: Type.Array(localFitting),
  heads: Type.Array(localHead),
  supports: Type.Array(localSupport),
  bom: Type.Optional(Type.Array(localBomLine)),
}, { additionalProperties: false });
const idFactArray = () => factSchema(Type.Array(id(), { uniqueItems: true }));
const localChangeRequestFacts = Type.Object({
  id: id(),
  description: factSchema(Type.String({ minLength: 1 })),
  affectedEntityIds: idFactArray(),
  impactNeighborhood: factSchema(Type.Object({
    roomIds: Type.Array(id(), { uniqueItems: true }),
    headIds: Type.Array(id(), { uniqueItems: true }),
    supportIds: Type.Array(id(), { uniqueItems: true }),
    ductIds: Type.Array(id(), { uniqueItems: true }),
    segmentIds: Type.Array(id(), { uniqueItems: true }),
  }, { additionalProperties: false })),
  changeClassification: factSchema(options(["relocation_or_reroute", "addition_to_existing_system", "other"] as const)),
  systemWorkType: factSchema(options(["new_system", "existing_system_modification"] as const)),
  existingSystem: factSchema(options(["yes", "no"] as const)),
  addsSprinklersOrPiping: factSchema(options(["yes", "no"] as const)),
  existingConfigurationAndRiserIncluded: optionalFact(options(["yes", "no"] as const)),
  remoteAreaChanged: factSchema(options(["yes", "no"] as const)),
  hazardBecameMoreDemanding: factSchema(options(["yes", "no"] as const)),
  waterSupplyRoutingOrBackflowChanged: factSchema(options(["yes", "no"] as const)),
  headRemovalActions: Type.Array(Type.Object({
    headId: id(),
    removedFromFitting: factSchema(options(["yes", "no"] as const)),
    wasWelded: factSchema(options(["yes", "no"] as const)),
    proposedReuse: factSchema(options(["yes", "no"] as const)),
  }, { additionalProperties: false })),
  plannedExcessPipeSegmentIds: Type.Optional(idFactArray()),
  fieldExcessPipeRemovalStatus: optionalFact(options(["removed", "not_removed"] as const)),
  fieldInstallationDeviationFromApprovedPlan: optionalFact(options(["yes", "no"] as const)),
  caseByCaseHydraulicDecision: optionalFact(options(["recalculation_required", "no_additional_calculation_directed"] as const)),
}, { additionalProperties: false });
const localDrawing = Type.Object({ document: factSchema(documentRevision), approval: factSchema(options(["approved", "not_approved"] as const)) }, { additionalProperties: false });
const localChangeInput = Type.Object({
  id: id(),
  approvedDrawing: localDrawing,
  revisedDrawing: Type.Optional(localDrawing),
  changeRequest: localChangeRequestFacts,
  baseline: localPlan,
  proposed: localPlan,
  systemMaximumWorkingPressure: Type.Optional(factSchema(Type.Object({
    value: Type.Number({ minimum: 0 }),
    unit: options(["Pa", "kPa", "bar", "psi"] as const),
    basis: options(["system_maximum", "spot_reading", "design_intent"] as const),
  }, { additionalProperties: false }))),
  baselineCalculation: Type.Optional(factSchema(Type.Object({
    documentId: id(), revision: id(), edition: Type.Optional(id()),
    drawing: documentRevision,
    affectedEntityIds: Type.Array(id(), { uniqueItems: true }),
    referencePointIds: Type.Array(id(), { uniqueItems: true }),
  }, { additionalProperties: false }))),
  revisedCalculation: Type.Optional(factSchema(Type.Object({
    documentId: id(), revision: id(), edition: Type.Optional(id()),
    drawing: documentRevision,
    affectedEntityIds: Type.Array(id(), { uniqueItems: true }),
    referencePointIds: Type.Array(id(), { uniqueItems: true }),
  }, { additionalProperties: false }))),
}, { additionalProperties: false });

const evidenceBase = {
  id: id(),
  projectId: id(),
  subjectIds: Type.Array(id(), { minItems: 1, uniqueItems: true }),
  superseded: Type.Optional(Type.Boolean()),
  invalidated: Type.Optional(Type.Boolean()),
  capturedAt: Type.Optional(Type.String({ minLength: 1 })),
};
export const ProjectEvidenceSchema = Type.Union([
  Type.Object({ ...evidenceBase, kind: Type.Literal("photo"), documentRevision: Type.Optional(documentRevision) }, { additionalProperties: false }),
  ...(["permit", "drawing", "installation", "calculation", "inspection"] as const).map(kind =>
    Type.Object({ ...evidenceBase, kind: Type.Literal(kind), documentRevision }, { additionalProperties: false })),
]);

export const ProjectEvaluationInputSchema = Type.Object({
  project: Type.Object({
    id: id(),
    revision: Type.Integer({ minimum: 0 }),
    asOf: Type.String({ minLength: 10, maxLength: 10 }),
  }, { additionalProperties: false }),
  selectedRulePacks: Type.Array(options(PROJECT_RULE_PACK_IDS), { uniqueItems: true }),
  facts: Type.Optional(Type.Object({
    sfNfpa13: Type.Optional(projectSfFacts),
    systemType: optionalFact(options(["wet", "dry", "preaction", "deluge", "other"] as const)),
    sprinklerType: optionalFact(options(["standard_spray", "residential", "cmsa", "esfr", "other"] as const)),
    storage: optionalFact(options(["non_storage", "storage", "unknown"] as const)),
    hazardClassification: optionalFact(options(["light", "ordinary_1", "ordinary_2", "extra_1", "extra_2", "other"] as const)),
  }, { additionalProperties: false })),
  heads: Type.Optional(Type.Array(Type.Object({
    id: id(),
    facts: Type.Optional(ProjectHeadFactsSchema),
    manufacturerExtra: Type.Optional(manufacturerExtraFacts),
  }, { additionalProperties: false }))),
  supports: Type.Optional(Type.Array(Type.Object({ id: id(), facts: Type.Optional(supportFacts) }, { additionalProperties: false }))),
  evidence: Type.Optional(Type.Array(ProjectEvidenceSchema)),
  localChange: Type.Optional(localChangeInput),
}, { additionalProperties: false });
