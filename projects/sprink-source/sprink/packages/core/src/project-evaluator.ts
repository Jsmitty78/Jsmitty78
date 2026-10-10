import { ADOPTED_RULES, validateRule, validateRules } from "./head-validator.js";
import { emptyFacts, type Evidence, type Fact, type HeadFacts, type RuleContext, type RuleResult, type SourceReference } from "./types.js";
import { resolveSfNfpa13Edition, type SfProjectFacts } from "./sf-project-basis.js";
import {
  isProjectPackId,
  normalizeProjectQuantity,
  ProjectInputError,
  toProjectSourceReference,
  type CoverageEntry,
  type ProjectBasisResult,
  type ProjectEvaluationOutput,
  type ProjectEvaluationRequest,
  type ProjectEvidence,
  type ProjectHead,
  type ProjectHeadFacts,
  type ProjectQuantity,
  type ProjectQuantityComparison,
  type ProjectQuantityTrace,
  type ProjectRulePackId,
  type ProjectRuleResult,
  type ProjectSourceReference,
} from "./project-contract.js";
import { ProjectEvaluationInputSchema } from "./project-schemas.js";
import { Check, Errors } from "typebox/value";
import { evaluateManufacturerExtraRule, evaluateManufacturerExtraRules } from "./project-rules/manufacturer-extra.js";
import { evaluateSfSupportRule, evaluateSfSupports2025 } from "./project-rules/sf-supports-2025.js";
import { evaluateSfLocalChangeRecordRule, evaluateSfLocalChangeRecords } from "./project-rules/sf-local-change-records.js";
import { localChangeRuleSources, evaluateLocalChangeRule, evaluateLocalChange } from "./project-rules/local-change.js";
import { LocalGeometryInputError } from "./local-change-geometry.js";

const SF_BASIS_SOURCE: ProjectSourceReference = {
  document: "SFFD Administrative Bulletin 2.04, Fire Sprinkler Submittals",
  documentId: "SFFD AB 2.04",
  revision: "2025",
  page: 1,
  url: "https://sf-fire.org/media/4169",
  purpose: "Notes 1.A-C: edition basis for the supported San Francisco permit pathways.",
  clauses: ["Note 1.A", "Note 1.B", "Note 1.C"],
};

const NFPA_SOURCE_PENDING_REASON = "The governing NFPA 13-2025 primary text and applicable amendments have not been incorporated into an executable rule.";
const PROJECT_HEAD_RULE_IDS = new Set([
  "TFP171_INSTALL_ORIENTATION_V2",
  "TFP171_RECESSED_ESCUTCHEON_V1",
  "TFP171_INSTALLATION_WRENCH_V1",
  "TFP171_NPT_INSTALLATION_TORQUE_V1",
  "TFP171_RETROFIT_ONLY_V1",
  "TFP171_WORKING_PRESSURE_V1",
]);
const sourcePendingDomains = [
  ["N02", "Hazard classification and design method"],
  ["N03", "Sprinkler spacing, coverage area, and wall distance"],
  ["N04", "Ceiling height, slope, and construction"],
  ["N05", "Obstructions to sprinkler discharge"],
  ["N06", "Pipe support and seismic bracing"],
  ["N07", "Hydraulics, water supply, and remote area"],
  ["N08", "Temperature rating and approval conditions"],
] as const;

const TFP_URL = "https://docs.johnsoncontrols.com/tycofire/api/khub/documents/JXGj~rL_f_FBVCY52uMTJw/content";
const AB204_URL = "https://sf-fire.org/media/4169";
const AB415_URL = "https://sf-fire.org/media/3979";
const tfpResiduals: readonly { id: string; title: string; pages: number[]; reason: string }[] = [
  { id: "TFP171_RECESSED_FITMENT_REMAINDERS", title: "Other recessed fitment and installation conditions", pages: [3, 4, 5], reason: "The fitting-face interval is covered; other fitment, installation, ceiling, and closure conditions remain unimplemented." },
  { id: "TFP171_APPROVAL_AND_TEMPERATURE_REMAINDERS", title: "Project approval and ambient-temperature suitability", pages: [6, 7, 8], reason: "Named agency/model/style/temperature table membership and bounded body-finish availability are covered; project-required approvals, ambient suitability, label authenticity, and current stock remain unimplemented." },
  { id: "TFP171_INSTALLATION_PROCEDURE_REMAINDERS", title: "Other sprinkler installation procedures", pages: [5], reason: "The bounded wrench engagement and sealant/hand-tightening sequence checks are covered; wrench identity, torque, and other installation steps remain separate or unimplemented." },
];

function source(document: string, revision: string, page: number, url: string, purpose: string, documentId = document): ProjectSourceReference {
  const reference: SourceReference = { document, revision, page, url, purpose };
  return toProjectSourceReference(reference, documentId);
}

const SOURCES_LOCAL_CHANGE_PLANS = [
  source("SFFD AB 2.04", "2025", 4, AB204_URL, "I.14(C): proposed sprinkler relocations are represented on approved plans.", "SFFD AB 2.04"),
  source("SFFD AB 2.04", "2025", 6, AB204_URL, "I.19(D)-(E): change plan information for affected piping and fittings.", "SFFD AB 2.04"),
];
const SOURCES_LOCAL_CHANGE_GEOMETRY = [source("SFFD AB 2.04", "2025", 6, AB204_URL, "I.19(E)(3): show pipe sizes and center-to-center lengths; bounded calculations do not determine design adequacy.", "SFFD AB 2.04")];
const SOURCES_LOCAL_CHANGE_HYDRAULIC = [source("SFFD AB 2.04", "2025", 10, AB204_URL, "I.22(A)(2)(a)-(d): named recalculation triggers and residual case-by-case direction.", "SFFD AB 2.04")];

function catalogEntry(input: Omit<CoverageEntry, "selected">, selectedPacks: ReadonlySet<ProjectRulePackId>): CoverageEntry {
  return { ...input, sourceRefs: [...input.sourceRefs], selected: input.packId ? selectedPacks.has(input.packId) : false };
}

function coverageCatalog(selectedPacks: ReadonlySet<ProjectRulePackId>): CoverageEntry[] {
  const entries: CoverageEntry[] = [
    catalogEntry({
      id: "N01_SF_EDITION_BASIS",
      area: "nfpa13",
      title: "San Francisco NFPA 13 edition-basis resolver",
      state: "supported",
      reason: "The bounded SFFD AB 2.04 permit pathways select an edition basis only; permit-history completeness and project persistence remain outside this helper.",
      sourceRefs: [SF_BASIS_SOURCE],
      packId: "sf-project-basis",
    }, selectedPacks),
    catalogEntry({
      id: "N01_PERMIT_SCOPE_AND_ADOPTION",
      area: "nfpa13",
      title: "Project permit scope and adopted requirements",
      state: "unimplemented",
      reason: "The edition helper does not establish the complete permit set, every local amendment, or final project adoption.",
      sourceRefs: [SF_BASIS_SOURCE],
    }, selectedPacks),
    ...sourcePendingDomains.map(([id, title]) => catalogEntry({
      id,
      area: "nfpa13",
      title,
      state: "source_pending",
      reason: NFPA_SOURCE_PENDING_REASON,
      sourceRefs: [],
      ...(["N02", "N03", "N05", "N06", "N07"].includes(id) ? { packId: "sf-local-change-2025" as const } : {}),
    }, selectedPacks)),
    ...[
      {
        id: "SFFD_AB415_POWDER_DRIVEN_STUDS_I2_I3_V1",
        title: "Powder-driven studs for sprinkler pipe hangers and sway bracing",
        clause: "I.2-I.3",
        page: 1,
        packId: "sf-supports-2025" as const,
        reason: "Checks new-versus-existing powder-driven stud conditions for hangers/sway bracing; other fasteners and support design remain outside this rule.",
        url: AB415_URL,
        documentId: "SFFD AB 4.15",
      },
      {
        id: "SFFD_AB415_CRACKED_CONCRETE_FASTENERS_I4_V1",
        title: "Cracked-concrete qualification for concrete hanger and sway-brace fasteners",
        clause: "I.4",
        page: 1,
        packId: "sf-supports-2025" as const,
        reason: "Checks only cracked-concrete certification/prequalification for concrete fasteners used for hangers/sway bracing.",
        url: AB415_URL,
        documentId: "SFFD AB 4.15",
      },
    ].map(item => catalogEntry({
      id: item.id,
      area: "sf-admin",
      title: item.title,
      state: "supported",
      reason: item.reason,
      sourceRefs: [{
        document: item.documentId === "SFFD AB 2.04" ? "SFFD Administrative Bulletin 2.04, Fire Sprinkler Submittals" : "SFFD Administrative Bulletin 4.15, Attachments and Anchors Acceptable for Hanging and Sway Bracing of Sprinkler Pipe",
        documentId: item.documentId,
        revision: "2025",
        page: item.page,
        url: item.url,
        purpose: item.reason,
        clauses: [item.clause],
      }],
      packId: item.packId,
    }, selectedPacks)),
    ...ADOPTED_RULES.filter(rule => PROJECT_HEAD_RULE_IDS.has(rule.id)).map(rule => catalogEntry({
      id: rule.id,
      area: "tfp171",
      title: rule.title,
      state: "supported",
      reason: rule.scope,
      sourceRefs: rule.sources.map(reference => toProjectSourceReference(reference, "TFP171")),
      packId: "tyco-tfp171-head",
    }, selectedPacks)),
    catalogEntry({
      id: "TFP171_INSTALLATION_WRENCH_FLATS_V1",
      area: "tfp171",
      title: "Wrench engagement on the wrench flats",
      state: "supported",
      reason: "This bounded subcondition is evaluated by the extra manufacturer pack; remaining installation procedure checks are still unimplemented.",
      sourceRefs: [source("TFP171", "August 2026", 5, TFP_URL, "Standard Step 3 and recessed Step 2; wrench flats shown in Figures 1-4 and 1-3.")],
      packId: "tyco-tfp171-extra",
    }, selectedPacks),
    ...[
      {
        id: "TFP171_INSTALL_SEALANT_HANDTIGHTEN_SEQUENCE_V1",
        title: "Pipe-thread sealant and hand-tightening sequence",
        pages: [5],
        purpose: "Checks only sealant-before-hand-tightening, hand-tightening-before-wrench-tightening, and recessed mounting-plate order where applicable.",
      },
      {
        id: "TFP171_RECESSED_FITTING_SURFACE_DIMENSION_V1",
        title: "Recessed fitting-face to mounting-surface interval",
        pages: [3, 4],
        purpose: "Checks explicit measurement intervals against the matching recessed model/style dimension in Figures 5-10.",
      },
      {
        id: "TFP171_LISTED_TEMPERATURE_APPROVAL_COMBINATION_V1",
        title: "Listed temperature and named-agency table combination",
        pages: [6, 7],
        purpose: "Checks Tables A-C row membership for a specific model/style, exact catalog temperature, and named agency.",
      },
      {
        id: "TFP171_SPRINKLER_BODY_FINISH_TEMPERATURE_AVAILABILITY_V1",
        title: "Sprinkler-body finish and temperature table availability",
        pages: [6, 7, 8],
        purpose: "Checks the Table E body-finish / exact-temperature combination and stated geographic restriction.",
      },
    ].map(item => catalogEntry({
      id: item.id,
      area: "tfp171",
      title: item.title,
      state: "supported",
      reason: `${item.purpose} Other requirements in the broader residual category remain unimplemented.`,
      sourceRefs: item.pages.map(page => source("TFP171", "August 2026", page, TFP_URL, item.purpose)),
      packId: "tyco-tfp171-extra",
    }, selectedPacks)),
    ...tfpResiduals.map(item => catalogEntry({
      id: item.id,
      area: "tfp171",
      title: item.title,
      state: "unimplemented",
      reason: item.reason,
      sourceRefs: item.pages.map(page => source("TFP171", "August 2026", page, TFP_URL, item.title)),
    }, selectedPacks)),
    ...[
      { id: "LOCAL_CHANGE_APPROVED_DRAWING_LINEAGE", title: "Approved baseline and proposed drawing revision lineage", state: "supported" as const, reason: "Checks explicit revision links and evidence scope; it does not grant approval.", sources: SOURCES_LOCAL_CHANGE_PLANS },
      { id: "LOCAL_CHANGE_STRAIGHT_PIPE_AND_DUCT_ENVELOPE", title: "Straight-pipe cut arithmetic and modeled duct-envelope comparison", state: "supported" as const, reason: "Supports axis-parallel straight pipe and AABB ducts only; physical clearance is not discharge compliance.", sources: SOURCES_LOCAL_CHANGE_GEOMETRY },
      { id: "LOCAL_CHANGE_COMPONENT_INTERFACE_SCREEN", title: "Confirmed nominal-size and connector interface screen", state: "supported" as const, reason: "Can identify confirmed size, standard, or gender mismatches; a matching screen does not prove product/joint compatibility.", sources: SOURCES_LOCAL_CHANGE_GEOMETRY },
      { id: "LOCAL_CHANGE_PRODUCT_PRESSURE_COMPATIBILITY", title: "Selected-part pressure and temperature compatibility", state: "unimplemented" as const, reason: "Calculation-backed system maximum is exposed against reported ratings, but selected manufacturer conditions and service temperature remain unresolved.", sources: SOURCES_LOCAL_CHANGE_GEOMETRY },
      { id: "LOCAL_CHANGE_BOM_RECONCILIATION", title: "Derived part counts and supplied bill-of-material reconciliation", state: "supported" as const, reason: "Reconciles plan entities and supplied rows; it does not confirm procurement or installation.", sources: SOURCES_LOCAL_CHANGE_GEOMETRY },
      { id: "LOCAL_CHANGE_HEAD_LAYOUT_AND_OBSTRUCTION", title: "Post-change head spacing and discharge-obstruction criteria", state: "source_pending" as const, reason: NFPA_SOURCE_PENDING_REASON, sources: [] as ProjectSourceReference[] },
      { id: "LOCAL_CHANGE_SUPPORT_ADEQUACY", title: "Support load, capacity, spacing, and structural adequacy", state: "source_pending" as const, reason: NFPA_SOURCE_PENDING_REASON, sources: [] as ProjectSourceReference[] },
      { id: "LOCAL_CHANGE_HYDRAULIC_ADEQUACY", title: "Hydraulic adequacy after local routing changes", state: "unimplemented" as const, reason: "The pack identifies source-backed recalculation triggers and lineage only; no hydraulic solver or adequacy check is implemented.", sources: SOURCES_LOCAL_CHANGE_HYDRAULIC },
    ].map(item => catalogEntry({ id: item.id, area: "local-change", title: item.title, state: item.state, reason: item.reason, sourceRefs: item.sources, packId: "sf-local-change-2025" }, selectedPacks)),
  ];
  return entries;
}

function isoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validateRequest(input: unknown): asserts input is ProjectEvaluationRequest {
  const raw = input as { selectedRulePacks?: unknown } | null;
  if (raw && Array.isArray(raw.selectedRulePacks)) {
    const unknown = raw.selectedRulePacks.find((pack): pack is string => typeof pack === "string" && !isProjectPackId(pack));
    if (unknown) throw new ProjectInputError("unknown_pack", `Unknown rule pack: ${unknown}.`, ["selectedRulePacks"]);
  }
  if (!Check(ProjectEvaluationInputSchema, input)) {
    const validationErrors = Errors(ProjectEvaluationInputSchema, input);
    throw new ProjectInputError("invalid_input", `Project evaluation input is invalid (${validationErrors.length} schema issue(s)).`, ["input"]);
  }
  const request = input as ProjectEvaluationRequest;
  if (!Number.isSafeInteger(request.project.revision) || request.project.revision < 0) {
    throw new ProjectInputError("invalid_input", "Project revision must be a non-negative safe integer.", ["project.revision"]);
  }
  if (!isoCalendarDate(request.project.asOf)) {
    throw new ProjectInputError("invalid_input", "asOf must be a valid ISO calendar date (YYYY-MM-DD).", ["project.asOf"]);
  }
  const identities = [request.project.id, ...(request.heads ?? []).map(head => head.id), ...(request.supports ?? []).map(support => support.id), ...(request.evidence ?? []).map(record => record.id)];
  if (new Set(identities).size !== identities.length) {
    throw new ProjectInputError("duplicate_id", "Project, head, support, and evidence IDs must be unique.", ["project.id", "heads.id", "supports.id", "evidence.id"]);
  }
  for (const [headIndex, head] of (request.heads ?? []).entries()) {
    const interval = (head.manufacturerExtra as Record<string, { value?: { lower?: number; upper?: number; unit?: string } | null } | undefined> | undefined)
      ?.recessedFittingFaceToMountingSurfaceInterval?.value;
    if (interval && (interval.unit !== "in" || !Number.isFinite(interval.lower) || !Number.isFinite(interval.upper) || interval.lower! < 0 || interval.upper! < interval.lower!)) {
      throw new ProjectInputError("invalid_input", "Recessed dimension interval must have finite, non-negative, ordered bounds in inches.", [`heads.${headIndex}.manufacturerExtra.recessedFittingFaceToMountingSurfaceInterval`]);
    }
  }
}

function evidenceContext(request: ProjectEvaluationRequest, subjectId: string): RuleContext {
  const observations: Evidence[] = (request.evidence ?? [])
    .filter(record => record.projectId === request.project.id && record.subjectIds.includes(subjectId))
    .map(record => ({ id: record.id, targetId: subjectId, ...(record.superseded ? { superseded: true } : {}), ...(record.invalidated ? { invalidated: true } : {}) }));
  return { targetId: subjectId, taskRevision: request.project.revision, observations };
}

function unknownFact<T>(): Fact<T> {
  return { value: null, confirmed: false, evidenceIds: [], source: "manual" };
}

function sfFacts(request: ProjectEvaluationRequest): SfProjectFacts {
  const input = request.facts?.sfNfpa13 ?? {};
  return {
    jurisdiction: input.jurisdiction ?? unknownFact(),
    standard: input.standard ?? unknownFact(),
    permitKind: input.permitKind ?? unknownFact(),
    ...(input.sitePermitCodeCycle ? { sitePermitCodeCycle: input.sitePermitCodeCycle } : {}),
    ...(input.architecturalPermitCodeCycle ? { architecturalPermitCodeCycle: input.architecturalPermitCodeCycle } : {}),
    ...(input.editionElection ? { editionElection: input.editionElection } : {}),
    ...(input.ownerRequestedEdition ? { ownerRequestedEdition: input.ownerRequestedEdition } : {}),
    ...(input.originalFirePermitNumber ? { originalFirePermitNumber: input.originalFirePermitNumber } : {}),
    ...(input.originalNfpa13Edition ? { originalNfpa13Edition: input.originalNfpa13Edition } : {}),
  };
}

function evidenceOfKinds(
  request: ProjectEvaluationRequest,
  subjectId: string,
  fact: Fact<unknown> | undefined,
  kinds: readonly ProjectEvidence["kind"][],
): boolean {
  if (!fact || fact.value == null) return true;
  const ids = new Set(fact.evidenceIds);
  return (request.evidence ?? []).some(record =>
    ids.has(record.id) && record.projectId === request.project.id && record.subjectIds.includes(subjectId) &&
    !record.superseded && !record.invalidated && kinds.includes(record.kind));
}

function withEvidenceKindGates(
  request: ProjectEvaluationRequest,
  head: ProjectHead,
  headFacts: ProjectHeadFacts,
  result: RuleResult,
): RuleResult {
  const requirements: Record<string, { fields: readonly string[]; kinds: readonly ProjectEvidence["kind"][] }> = {
    TFP171_INSTALLATION_WRENCH_V1: { fields: ["installationWrench"], kinds: ["installation"] },
    TFP171_NPT_INSTALLATION_TORQUE_V1: { fields: ["installationTorque"], kinds: ["installation"] },
    TFP171_RETROFIT_ONLY_V1: { fields: ["construction"], kinds: ["permit", "installation"] },
    TFP171_BULB_CONDITION_V1: { fields: ["bulbCondition"], kinds: ["inspection"] },
    TFP171_FACTORY_FINISH_V1: { fields: ["fieldFinish"], kinds: ["inspection"] },
    TFP171_LEAKAGE_V1: { fields: ["leakage"], kinds: ["inspection"] },
    TFP171_VISIBLE_CORROSION_V1: { fields: ["corrosion"], kinds: ["inspection"] },
    TFP171_WORKING_PRESSURE_V1: { fields: ["workingPressure"], kinds: ["calculation"] },
  };
  const requirement = requirements[result.ruleId];
  if (!requirement || result.status === "not_applicable") return result;
  const failures = requirement.fields.filter(field => {
    const fact = (headFacts as Record<string, Fact<unknown> | undefined>)[field];
    return !evidenceOfKinds(request, head.id, fact, requirement.kinds);
  });
  if (!failures.length) return result;
  const missingInputs = [...new Set([...result.missingInputs, ...failures.map(field => `${field}.evidenceKinds:${requirement.kinds.join("|")}`)])];
  return {
    ...result,
    status: "unknown",
    applicability: result.applicability === "not_applicable" ? "unknown" : result.applicability,
    reason: "The referenced evidence does not include the record type required for this work-history or inspection fact.",
    missingInputs,
  };
}

function normalizeHeadFacts(input: ProjectHeadFacts | undefined): { facts: HeadFacts; torque?: ProjectQuantityTrace; pressure?: ProjectQuantityTrace } {
  const patch = input ?? {};
  const { installationTorque, workingPressure, ...legacyPatch } = patch;
  const facts = { ...emptyFacts(), ...legacyPatch } as HeadFacts;
  let torque: ProjectQuantityTrace | undefined;
  let pressure: ProjectQuantityTrace | undefined;
  if (installationTorque) {
    if (installationTorque.value == null) facts.installationTorqueFtLb = { ...installationTorque, value: null } as Fact<number>;
    else {
      const normalized = normalizeProjectQuantity(installationTorque.value, "torque");
      facts.installationTorqueFtLb = { ...installationTorque, value: normalized.value } as Fact<number>;
      torque = { field: "installationTorque", input: installationTorque.value, normalized };
    }
  }
  if (workingPressure) {
    if (workingPressure.value == null) facts.workingPressurePsi = { ...workingPressure, value: null } as Fact<number>;
    else {
      const normalized = normalizeProjectQuantity(workingPressure.value, "pressure");
      facts.workingPressurePsi = { ...workingPressure, value: normalized.value } as Fact<number>;
      pressure = { field: "workingPressure", input: workingPressure.value, normalized };
    }
  }
  return { facts, ...(torque ? { torque } : {}), ...(pressure ? { pressure } : {}) };
}

function rangeOutcome(value: number, minimum: number | undefined, maximum: number, converted = false): "pass" | "fail" {
  const atBoundary = (bound: number) => converted && Math.abs(value - bound) <= 4 * Number.EPSILON * Math.max(1, Math.abs(bound));
  const aboveMinimum = minimum === undefined || value >= minimum || atBoundary(minimum);
  const belowMaximum = value <= maximum || atBoundary(maximum);
  return aboveMinimum && belowMaximum ? "pass" : "fail";
}

function torqueComparisons(trace: ProjectQuantityTrace, head: ProjectHead): ProjectQuantityComparison[] {
  const model = head.facts?.model?.value?.trim().toUpperCase();
  const threeQuarter = model === "TY4131" || model === "TY4231";
  const imperial = threeQuarter ? { minimum: 10, maximum: 20 } : { minimum: 7, maximum: 14 };
  const metric = threeQuarter ? { minimum: 13.4, maximum: 26.8 } : { minimum: 9.5, maximum: 19.0 };
  const normalizedValue = trace.normalized.value;
  const comparisons: ProjectQuantityComparison[] = [{
    unit: "ft_lb", value: normalizedValue, ...imperial,
    outcome: rangeOutcome(normalizedValue, imperial.minimum, imperial.maximum, trace.input.unit !== "ft_lb"),
    sourceBasis: "TFP171 p.4 printed ft-lb torque interval",
  }];
  if (trace.input.unit === "N_m") comparisons.push({
    unit: "N_m", value: trace.input.value, ...metric,
    outcome: rangeOutcome(trace.input.value, metric.minimum, metric.maximum),
    sourceBasis: "TFP171 p.4 printed N-m torque interval",
  });
  return comparisons;
}

function barValue(quantity: ProjectQuantity): number {
  switch (quantity.unit) {
    case "Pa": return quantity.value / 100000;
    case "kPa": return quantity.value / 100;
    case "bar": return quantity.value;
    case "psi": return quantity.value * 6894.757293168 / 100000;
    default: throw new ProjectInputError("invalid_input", "Expected a pressure quantity.", ["quantity.unit"]);
  }
}

function pressureComparisons(trace: ProjectQuantityTrace, head: ProjectHead): ProjectQuantityComparison[] {
  const psiValue = trace.normalized.value;
  const model = head.facts?.model?.value?.trim().toUpperCase();
  const higherRatedModel = model === "TY3131" || model === "TY3231";
  const ulCul = head.facts?.approvalBasis?.value === "ul_cul";
  const maximumPsi = higherRatedModel && ulCul ? 250 : 175;
  const maximumBar = maximumPsi === 250 ? 17.2 : 12.1;
  const comparisons: ProjectQuantityComparison[] = [{
    unit: "psi", value: psiValue, maximum: maximumPsi,
    outcome: rangeOutcome(psiValue, undefined, maximumPsi, trace.input.unit !== "psi"),
    sourceBasis: maximumPsi === 250
      ? "TFP171 p.8 printed psi maximum for UL/C-UL TY3131/TY3231"
      : "TFP171 p.8 printed psi maximum working pressure",
  }];
  if (trace.input.unit !== "psi") {
    const value = barValue(trace.input);
    comparisons.push({
      unit: "bar", value, maximum: maximumBar,
      outcome: rangeOutcome(value, undefined, maximumBar, trace.input.unit !== "bar"),
      sourceBasis: "TFP171 p.8 printed bar maximum working pressure",
    });
  }
  return comparisons;
}

function reconcileQuantityRule(result: RuleResult, trace: ProjectQuantityTrace | undefined, head: ProjectHead): { result: RuleResult; trace?: ProjectQuantityTrace } {
  if (!trace) return { result };
  if (result.status !== "pass" && result.status !== "fail") return { result, trace };
  const comparisons = result.ruleId === "TFP171_NPT_INSTALLATION_TORQUE_V1" ? torqueComparisons(trace, head)
    : result.ruleId === "TFP171_WORKING_PRESSURE_V1" ? pressureComparisons(trace, head) : undefined;
  if (!comparisons) return { result, trace };
  const nextTrace = { ...trace, comparisons };
  const outcomes = new Set(comparisons.map(comparison => comparison.outcome));
  if (outcomes.size === 1) return { result: { ...result, status: comparisons[0]!.outcome }, trace: nextTrace };
  const bounds = comparisons.map(comparison => `${comparison.minimum === undefined ? "" : `${comparison.minimum}-`}${comparison.maximum} ${comparison.unit}`).join(" versus ");
  const field = trace.field;
  return {
    result: {
      ...result,
      status: "unknown",
      reason: `The source publishes paired-unit limits (${bounds}) whose comparisons disagree for the supplied quantity; manual review is required.`,
      missingInputs: unique([...result.missingInputs, `${field}.unitBoundaryConflict`]),
    },
    trace: nextTrace,
  };
}

function mapSource(sourceRef: SourceReference): ProjectSourceReference {
  return toProjectSourceReference(sourceRef, sourceRef.document);
}

function mapHeadResult(result: RuleResult, headId: string, traces: { torque?: ProjectQuantityTrace; pressure?: ProjectQuantityTrace }): ProjectRuleResult {
  const trace = result.ruleId === "TFP171_NPT_INSTALLATION_TORQUE_V1" ? traces.torque
    : result.ruleId === "TFP171_WORKING_PRESSURE_V1" ? traces.pressure : undefined;
  return {
    ...result,
    packId: "tyco-tfp171-head",
    subjectIds: [headId],
    requirementLevel: "requirement",
    sourceRefs: result.sourceRefs.map(mapSource),
    ...(trace ? { quantityTrace: [trace] } : {}),
  };
}

function mapBasis(request: ProjectEvaluationRequest): ProjectBasisResult {
  const result = resolveSfNfpa13Edition(sfFacts(request), evidenceContext(request, request.project.id));
  const sourceRefs = result.sourceRefs.map(sourceRef => toProjectSourceReference(
    sourceRef, "SFFD AB 2.04", undefined, ["Note 1.A", "Note 1.B", "Note 1.C"],
  ));
  const gateFields = Object.entries(request.facts?.sfNfpa13 ?? {}).filter(([, fact]) => fact?.value != null) as [string, Fact<unknown>][];
  const needsPermitRecord = gateFields.some(([, fact]) => !evidenceOfKinds(request, request.project.id, fact, ["permit"]));
  if (!needsPermitRecord) return { ...result, sourceRefs };
  return {
    ...result,
    status: "unknown",
    nfpa13Edition: null,
    reason: "The San Francisco permit facts do not resolve to a current project permit record.",
    missingInputs: [...new Set([...result.missingInputs, "sfNfpa13.evidenceKinds:permit"])],
    sourceRefs,
  };
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}

/** Pure, deterministic evaluation of only explicitly selected rule packs. */
export function evaluateProject(input: unknown): ProjectEvaluationOutput {
  validateRequest(input);
  const request = input;
  const selectedPacks = new Set(request.selectedRulePacks);
  const rules: ProjectRuleResult[] = [];
  let basis: ProjectBasisResult | undefined;
  let localChangeReport: ProjectEvaluationOutput["localChange"];

  if (selectedPacks.has("tyco-tfp171-head")) {
    if (!(request.heads?.length)) {
      // A selected pack with no targets is incomplete but creates no invented per-head results.
    } else {
      for (const head of request.heads) {
        const normalized = normalizeHeadFacts(head.facts);
        const context = evidenceContext(request, head.id);
        const evaluated = validateRules(normalized.facts, context);
        for (const result of evaluated.filter(item => PROJECT_HEAD_RULE_IDS.has(item.ruleId))) {
          const gated = withEvidenceKindGates(request, head, head.facts ?? {}, result);
          const trace = result.ruleId === "TFP171_NPT_INSTALLATION_TORQUE_V1" ? normalized.torque
            : result.ruleId === "TFP171_WORKING_PRESSURE_V1" ? normalized.pressure : undefined;
          const reconciled = reconcileQuantityRule(gated, trace, head);
          rules.push(mapHeadResult(reconciled.result, head.id, {
            ...(result.ruleId === "TFP171_NPT_INSTALLATION_TORQUE_V1" && reconciled.trace ? { torque: reconciled.trace } : {}),
            ...(result.ruleId === "TFP171_WORKING_PRESSURE_V1" && reconciled.trace ? { pressure: reconciled.trace } : {}),
          }));
        }
      }
    }
  }

  if (selectedPacks.has("tyco-tfp171-extra")) {
    if (!(request.heads?.length)) {
      // A selected pack with no targets is incomplete but creates no invented per-head results.
    } else {
      for (const head of request.heads) {
        const normalized = normalizeHeadFacts(head.facts);
        rules.push(...evaluateManufacturerExtraRules({
          projectId: request.project.id,
          facts: normalized.facts,
          extraFacts: head.manufacturerExtra ?? {},
          context: evidenceContext(request, head.id),
          evidence: request.evidence ?? [],
        }));
      }
    }
  }

  if (selectedPacks.has("sf-project-basis") || selectedPacks.has("sf-local-change-2025")) basis = mapBasis(request);
  if (selectedPacks.has("sf-supports-2025")) rules.push(...evaluateSfSupports2025(request));
  if (selectedPacks.has("sf-local-change-2025")) {
    if (!request.localChange) {
      // Keep the selection valid and report its missing request object without manufacturing target results.
    } else {
      try {
        const local = evaluateLocalChange(request);
        const records = evaluateSfLocalChangeRecords({
          input: request.localChange,
          projectId: request.project.id,
          taskRevision: request.project.revision,
          evidence: request.evidence ?? [],
        });
        const allLocal = [...local.rules, ...records];
        const gate = allLocal.find(rule => rule.ruleId === "SFFD_LOCAL_CHANGE_SCOPE_V1");
        const gatedLocal = gate?.verificationState === "verified" ? allLocal : allLocal.map(rule => {
          if (!rule.ruleId.startsWith("SFFD_") || rule.ruleId === "SFFD_LOCAL_CHANGE_SCOPE_V1") return rule;
          return {
            ...rule,
            status: "unknown" as const,
            applicability: "unknown" as const,
            verificationState: gate?.verificationState ?? "input_missing",
            reason: `The San Francisco local-change scope is unresolved or outside this bounded pack, so this clause-specific result is not evaluated. ${rule.reason}`,
            missingInputs: [...new Set([...rule.missingInputs, ...(gate?.missingInputs ?? ["localChange.scope"])])],
          };
        });
        rules.push(...gatedLocal);
        localChangeReport = { ...local.report, ruleIds: gatedLocal.map(rule => rule.ruleId) };
      } catch (error) {
        if (error instanceof LocalGeometryInputError) throw new ProjectInputError("invalid_input", error.message, [`localChange.${error.path}`]);
        throw error;
      }
    }
  }

  const missingInputs = unique([
    ...(rules.flatMap(rule => rule.missingInputs)),
    ...(basis?.missingInputs ?? []),
    ...(selectedPacks.has("sf-supports-2025") && !request.supports?.length ? ["supports"] : []),
    ...((selectedPacks.has("tyco-tfp171-head") || selectedPacks.has("tyco-tfp171-extra")) && !request.heads?.length ? ["heads"] : []),
  ]);

  return {
    projectId: request.project.id,
    taskRevision: request.project.revision,
    asOf: request.project.asOf,
    rules,
    ...(basis ? { basis } : {}),
    coverage: coverageCatalog(selectedPacks),
    missingInputs: unique([...missingInputs, ...(selectedPacks.has("sf-local-change-2025") && !request.localChange ? ["localChange"] : []), ...rules.filter(rule => rule.packId === "sf-local-change-2025").flatMap(rule => rule.missingInputs)]),
    ...(localChangeReport ? { localChange: localChangeReport } : {}),
  };
}

export interface ProjectRuleCatalogEntry {
  id: string;
  version: string;
  title: string;
  check: string;
  applicability: string;
  subjectTypes: string[];
  requiredInputs: string[];
  sourceRefs: ProjectSourceReference[];
  implementationStatus: CoverageEntry["state"];
  executionFunction: string | null;
}

const LOCAL_RULES = [
  ["SFFD_LOCAL_CHANGE_SCOPE_V1", "San Francisco local-change scope", "scope", "changeRequest"],
  ["SFFD_LOCAL_CHANGE_APPROVED_BASELINE_V1", "Approved baseline drawing revision", "plans", "approvedDrawing,baseline.sourceDrawing"],
  ["SFFD_LOCAL_CHANGE_DRAWING_LINEAGE_V1", "Proposed drawing revision lineage", "plans", "approvedDrawing,proposed.sourceDrawing,revisedDrawing"],
  ["SFFD_LOCAL_CHANGE_ROUTE_GEOMETRY_V1", "Straight-pipe cut lengths and geometry delta", "geometry", "baseline,proposed"],
  ["LOCAL_CHANGE_STRAIGHT_PIPE_DUCT_ENVELOPE_V1", "Straight-pipe envelope versus modeled ducts", "geometry", "baseline,proposed,changeRequest.impactNeighborhood"],
  ["LOCAL_CHANGE_CONFIRMED_INTERFACE_SCREEN_V1", "Nominal-size and connector interface mismatch screen", "geometry", "proposed"],
  ["LOCAL_CHANGE_BOM_ACCOUNTING_V1", "Plan bill-of-material reconciliation", "geometry", "baseline,proposed"],
  ["LOCAL_CHANGE_HEAD_NEIGHBORHOOD_V1", "Head positions and impact neighborhood", "plans", "baseline,proposed,changeRequest.impactNeighborhood"],
  ["SFFD_AB204_HEAD_RELOCATION_I14C_V1", "Relocated head on approved revised plan", "plans", "baseline,proposed,revisedDrawing,changeRequest.impactNeighborhood"],
  ["SFFD_AB204_HYDRAULIC_RECALC_I22A2_V1", "Existing-system hydraulic recalculation triggers and lineage", "hydraulic", "changeRequest,hydraulic"],
  ["SFFD_AB204_FIELD_DEVIATION_I14E_V1", "Actual field deviation from approved plan", "plans", "changeRequest.fieldInstallationDeviationFromApprovedPlan"],
  ["SFFD_AB204_NO_REINSTALL_REMOVED_OR_WELDED_SPRINKLER_I14D_V1", "Removed or welded threaded sprinkler reuse", "plans", "changeRequest,proposed"],
  ["SFFD_AB204_REMOVE_UNUSED_EXCESS_PIPE_I14A_V1", "Unused excess piping in a modification", "plans", "changeRequest,baseline,proposed"],
  ["SFFD_AB204_EXISTING_CONFIGURATION_RISER_FOR_ADDITIONS_I15_V1", "Existing configuration and riser connection for additions", "plans", "changeRequest,baseline,proposed"],
] as const;
const HEAD_INPUTS: Record<string, string[]> = {
  TFP171_INSTALL_ORIENTATION_V2: ["orientation", "verticalReference"],
  TFP171_RECESSED_ESCUTCHEON_V1: ["escutcheon"],
  TFP171_INSTALLATION_WRENCH_V1: ["installationWrench"],
  TFP171_NPT_INSTALLATION_TORQUE_V1: ["threadStandard", "installationTorque"],
  TFP171_RETROFIT_ONLY_V1: ["threadStandard", "construction"],
  TFP171_BULB_CONDITION_V1: ["bulbCondition"],
  TFP171_FACTORY_FINISH_V1: ["fieldFinish"],
  TFP171_LEAKAGE_V1: ["leakage"],
  TFP171_VISIBLE_CORROSION_V1: ["corrosion"],
  TFP171_WORKING_PRESSURE_V1: ["threadStandard", "workingPressure", "pressureBasis", "approvalBasis"],
};

const EXTRA_INPUTS: Record<string, string[]> = {
  TFP171_INSTALLATION_WRENCH_FLATS_V1: ["installationWrenchEngagementArea"],
  TFP171_INSTALL_SEALANT_HANDTIGHTEN_SEQUENCE_V1: ["pipeThreadSealantAppliedBeforeHandTightening", "headHandTightenedBeforeWrenchTightening", "mountingPlateInstalledBeforeHandTightening"],
  TFP171_RECESSED_FITTING_SURFACE_DIMENSION_V1: ["recessedFittingFaceToMountingSurfaceInterval"],
  TFP171_LISTED_TEMPERATURE_APPROVAL_COMBINATION_V1: ["manufacturerTemperatureRating", "manufacturerListedAgency"],
  TFP171_SPRINKLER_BODY_FINISH_TEMPERATURE_AVAILABILITY_V1: ["manufacturerTemperatureRating", "sprinklerBodyFinish", "sprinklerSalesHemisphere"],
};

/** Full, unfiltered selection catalog. Applicability is checked by the chosen script. */
export function getProjectRuleCatalog(): ProjectRuleCatalogEntry[] {
  const entries = coverageCatalog(new Set()).filter(entry => entry.area !== "local-change" || entry.state !== "supported");
  for (const rule of ADOPTED_RULES) if (!entries.some(entry => entry.id === rule.id)) entries.push({
    id: rule.id, title: rule.title, area: "tfp171", state: "supported", reason: rule.scope,
    sourceRefs: rule.sources.map(item => toProjectSourceReference(item, "TFP171")), packId: "tyco-tfp171-head", selected: false,
  });
  const catalog = entries.map((entry): ProjectRuleCatalogEntry => {
    const head = entry.packId?.startsWith("tyco-");
    const support = entry.packId === "sf-supports-2025";
    const inputs = head ? ["heads[].facts.model", "heads[].facts.installation", "heads[].facts.mounting", ...(HEAD_INPUTS[entry.id] ?? []).map(key => `heads[].facts.${key}`), ...(EXTRA_INPUTS[entry.id] ?? []).map(key => `heads[].manufacturerExtra.${key}`)]
      : support ? ["facts.sfNfpa13", "supports[].facts.use", ...(entry.id.includes("POWDER") ? ["supports[].facts.fastenerType", "supports[].facts.installationState", "supports[].facts.pipeMovedOrAltered", "supports[].facts.hangerHoldsProperly"] : ["supports[].facts.substrate", "supports[].facts.crackedConcreteQualification"])]
      : entry.packId === "sf-project-basis" ? ["facts.sfNfpa13"] : [];
    return {
      id: entry.id, version: entry.id.match(/_V(\d+)$/)?.[1] ?? "1", title: entry.title,
      check: entry.reason, applicability: entry.reason,
      subjectTypes: [head ? "head" : support ? "support" : "project"],
      requiredInputs: [...inputs, "evidence"], sourceRefs: [...entry.sourceRefs],
      implementationStatus: entry.state,
      executionFunction: entry.state === "supported" ? "executeProjectRule" : null,
    };
  });
  for (const [id, title, , paths] of LOCAL_RULES) catalog.push({
    id, version: "1", title, check: `${title}; bounded verification only, not design approval.`,
    applicability: id.startsWith("SFFD_") ? "Confirmed San Francisco local-change scope and current revision-linked evidence; the selected script checks these conditions." : "A local-change baseline and proposed plan with confirmed facts and current revision-linked evidence. Geometry supports straight axis-parallel pipe and modeled duct boxes only.",
    subjectTypes: ["local_change"], requiredInputs: [...paths.split(",").map(path => `localChange.${path}`), "evidence"],
    sourceRefs: localChangeRuleSources(id),
    implementationStatus: "supported", executionFunction: "executeProjectRule",
  });
  return catalog;
}

export interface ProjectRuleExecutionOutput extends ProjectEvaluationOutput {
  requiredArtifacts: NonNullable<ProjectEvaluationOutput["localChange"]>["requiredArtifacts"];
  ruleId: string;
  implementationStatus: CoverageEntry["state"];
  executionStatus: "executed" | "unimplemented" | "source_pending";
  reason: string;
}

/** Execute exactly the chosen rule, without jurisdiction/product preselection or a pack-wide run. */
export function executeProjectRule(input: unknown, ruleId: string): ProjectRuleExecutionOutput {
  validateRequest(input);
  const request = input;
  const entry = getProjectRuleCatalog().find(item => item.id === ruleId);
  if (!entry) throw new ProjectInputError("invalid_input", `Unknown rule: ${ruleId}.`, ["ruleId"]);
  const rules: ProjectRuleResult[] = [];
  const requiredArtifacts: ProjectRuleExecutionOutput["requiredArtifacts"] = [];
  let basis: ProjectBasisResult | undefined;
  const missingInputs: string[] = [];
  if (entry.implementationStatus === "supported") {
    if (ruleId === "N01_SF_EDITION_BASIS") basis = mapBasis(request);
    else if (ADOPTED_RULES.some(rule => rule.id === ruleId)) {
      if (!request.heads?.length) missingInputs.push("heads");
      for (const head of request.heads ?? []) {
        const normalized = normalizeHeadFacts(head.facts);
        const evaluated = validateRule(ruleId, normalized.facts, evidenceContext(request, head.id));
        const gated = withEvidenceKindGates(request, head, head.facts ?? {}, evaluated);
        const trace = ruleId === "TFP171_NPT_INSTALLATION_TORQUE_V1" ? normalized.torque : ruleId === "TFP171_WORKING_PRESSURE_V1" ? normalized.pressure : undefined;
        const reconciled = reconcileQuantityRule(gated, trace, head);
        rules.push(mapHeadResult(reconciled.result, head.id, {
          ...(ruleId === "TFP171_NPT_INSTALLATION_TORQUE_V1" && reconciled.trace ? { torque: reconciled.trace } : {}),
          ...(ruleId === "TFP171_WORKING_PRESSURE_V1" && reconciled.trace ? { pressure: reconciled.trace } : {}),
        }));
      }
    } else if (ruleId.startsWith("TFP171_")) {
      if (!request.heads?.length) missingInputs.push("heads");
      for (const head of request.heads ?? []) rules.push(...evaluateManufacturerExtraRule({
        projectId: request.project.id, facts: normalizeHeadFacts(head.facts).facts, extraFacts: head.manufacturerExtra ?? {},
        context: evidenceContext(request, head.id), evidence: request.evidence ?? [],
      }, ruleId));
    } else if (ruleId.startsWith("SFFD_AB415_")) {
      if (!request.supports?.length) missingInputs.push("supports");
      rules.push(...evaluateSfSupportRule(request, ruleId));
    } else if (!request.localChange) missingInputs.push("localChange");
    else {
      try {
        const recordIds = LOCAL_RULES.slice(-3).map(item => item[0]) as readonly string[];
        if (recordIds.includes(ruleId)) {
          const gate = evaluateLocalChangeRule(request, "SFFD_LOCAL_CHANGE_SCOPE_V1").rules[0]!;
          if (gate.verificationState !== "verified") rules.push({ ...gate, ruleId, title: entry.title });
          else rules.push(...evaluateSfLocalChangeRecordRule({ input: request.localChange, projectId: request.project.id, taskRevision: request.project.revision, evidence: request.evidence ?? [] }, ruleId));
        } else {
          const selected = evaluateLocalChangeRule(request, ruleId);
          rules.push(...selected.rules);
          requiredArtifacts.push(...selected.requiredArtifacts);
        }
      } catch (error) {
        if (error instanceof LocalGeometryInputError) throw new ProjectInputError("invalid_input", error.message, [`localChange.${error.path}`]);
        throw error;
      }
    }
  }
  if (entry.implementationStatus === "supported" && !rules.length && !basis) {
    if (!missingInputs.length) missingInputs.push("selectedRule.enumeratedSubjects");
    rules.push({
      ruleId, title: entry.title, scope: entry.applicability,
      packId: ruleId.startsWith("TFP171_") ? "tyco-tfp171-head" : ruleId.startsWith("SFFD_AB415_") ? "sf-supports-2025" : "sf-local-change-2025",
      targetId: request.project.id, subjectIds: [request.project.id], requirementLevel: "requirement",
      status: "unknown", applicability: "unknown", verificationState: "input_missing",
      reason: "No subject result was established for the selected rule. Confirm the relevant targets and their applicability; an empty target list is not a pass.",
      missingInputs: [...missingInputs], evidenceIds: [], sourceRefs: entry.sourceRefs,
      versions: { taskRevision: request.project.revision, ruleVersion: entry.version, sourceRevision: entry.sourceRefs[0]?.revision ?? "unavailable" },
    });
  }
  if (entry.implementationStatus !== "supported") rules.push({
    ruleId, title: entry.title, scope: entry.applicability, packId: ruleId.startsWith("TFP171_") ? "tyco-tfp171-extra" : "sf-local-change-2025",
    targetId: request.project.id, subjectIds: [request.project.id], requirementLevel: "requirement",
    status: "unknown", applicability: "unknown", verificationState: entry.implementationStatus,
    reason: entry.check, missingInputs: [entry.implementationStatus === "source_pending" ? "governingPrimarySource" : "ruleImplementation"],
    evidenceIds: [], sourceRefs: entry.sourceRefs,
    versions: { taskRevision: request.project.revision, ruleVersion: entry.version, sourceRevision: entry.sourceRefs[0]?.revision ?? "unavailable" },
  });
  return {
    projectId: request.project.id, taskRevision: request.project.revision, asOf: request.project.asOf,
    ruleId, requiredArtifacts, implementationStatus: entry.implementationStatus,
    executionStatus: entry.implementationStatus === "supported" ? "executed" : entry.implementationStatus,
    reason: entry.implementationStatus === "supported" ? "Only the selected bounded rule was evaluated. This is not a completeness or construction-approval determination." : entry.check,
    rules, ...(basis ? { basis } : {}),
    coverage: getProjectRuleCatalog().map(item => ({ id: item.id, title: item.title, area: item.id.startsWith("TFP171_") ? "tfp171" as const : /^N\d/.test(item.id) ? "nfpa13" as const : item.id.startsWith("SFFD_") ? "sf-admin" as const : "local-change" as const, state: item.implementationStatus, reason: item.check, sourceRefs: item.sourceRefs, selected: item.id === ruleId })),
    missingInputs: unique([...missingInputs, ...(basis?.missingInputs ?? []), ...rules.flatMap(rule => rule.missingInputs)]),
  };
}
