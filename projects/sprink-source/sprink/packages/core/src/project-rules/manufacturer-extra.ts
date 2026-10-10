import { FACT_OPTIONS, type Fact, type HeadFacts, type RuleContext, type RuleStatus } from "../types.js";
import { contextIssues, factIssues } from "../evidence.js";
import { ProjectInputError, type ProjectEvidence, type ProjectRuleResult, type ProjectSourceReference } from "../project-contract.js";

const sourceUrl = "https://docs.johnsoncontrols.com/tycofire/api/khub/documents/JXGj~rL_f_FBVCY52uMTJw/content";
const sourceRef = (purpose: string, clauses: readonly string[], page = 5): ProjectSourceReference => ({
  document: "TFP171",
  documentId: "TFP171",
  revision: "August 2026",
  page,
  url: sourceUrl,
  purpose,
  clauses,
});

type WrenchArea = "wrench_flats" | "other_area";
type YesNo = "yes" | "no";
type RecessedFittingFaceToMountingSurfaceInterval = { lower: number; upper: number; unit: "in"; phase: "planned" | "as_built" };
type ManufacturerTemperature = { value: number; unit: "F" | "C" };
type ManufacturerAgency = "ul" | "c_ul" | "fm" | "lpcb_007k_04" | "lpcb_094a_06" | "vds" | "lpcb_unspecified" | "other";
type SprinklerBodyFinish = "natural_brass" | "pure_white_polyester" | "signal_white_polyester" | "chrome_plated" | "other";
type SalesHemisphere = "eastern" | "other";

/** Additional independently confirmed facts for the bounded, design-relevant TFP171 checks. */
export interface ManufacturerExtraFacts {
  installationWrenchEngagementArea?: Fact<WrenchArea>;
  pipeThreadSealantAppliedBeforeHandTightening?: Fact<YesNo>;
  headHandTightenedBeforeWrenchTightening?: Fact<YesNo>;
  mountingPlateInstalledBeforeHandTightening?: Fact<YesNo>;
  recessedFittingFaceToMountingSurfaceInterval?: Fact<RecessedFittingFaceToMountingSurfaceInterval>;
  manufacturerTemperatureRating?: Fact<ManufacturerTemperature>;
  manufacturerListedAgency?: Fact<ManufacturerAgency>;
  sprinklerBodyFinish?: Fact<SprinklerBodyFinish>;
  sprinklerSalesHemisphere?: Fact<SalesHemisphere>;
}

interface ExtraRule {
  id: string;
  title: string;
  version: string;
  scope: string;
  requirementLevel: ProjectRuleResult["requirementLevel"];
  sourceRefs: readonly ProjectSourceReference[];
}

const modelIds = new Set(["TY2131", "TY2231", "TY3131", "TY3231", "TY4131", "TY4231", "TY4831", "TY4931"]);
const recessedModels = new Set(["TY2231", "TY3231", "TY4231"]);
const sourceScope = "Confirmed Series TY-FRB model/configuration covered by TFP171; this named condition only is evaluated, not system compliance.";

const RULES: readonly ExtraRule[] = Object.freeze([
  {
    id: "TFP171_INSTALLATION_WRENCH_FLATS_V1",
    title: "Wrench engaged the sprinkler wrench flats",
    version: "1",
    scope: `${sourceScope} As-built installation history only; wrench identity is evaluated by TFP171_INSTALLATION_WRENCH_V1. A confirmed ISO 7-1 special connection remains unknown in this bounded check.`,
    requirementLevel: "requirement",
    sourceRefs: [sourceRef(
      "The installation instruction applies the sprinkler wrench to the wrench flats; it does not check wrench type, sealant, hand-tightening, torque, or other sequence steps.",
      ["Installation: Series TY-FRB Upright and Pendent Sprinklers, Step 3", "Installation: Series TY-FRB Recessed Pendent Sprinklers, Step 2", "Figures 1-4 and 1-3 respectively"],
    )],
  },
  {
    id: "TFP171_INSTALL_SEALANT_HANDTIGHTEN_SEQUENCE_V1",
    title: "Pipe-thread sealant and hand-tightening sequence",
    version: "1",
    scope: `${sourceScope} As-built installation history only; checks only sealant-before-hand-tightening and hand-tightening-before-wrench-tightening; recessed mounting plate order is checked when applicable. Wrench type, wrench contact, torque, and sealant material are separate or unmodeled conditions.`,
    requirementLevel: "requirement",
    sourceRefs: [sourceRef(
      "The standard instructions place pipe-thread sealant and hand-tightening before wrench-tightening; the recessed Step 1 requires mounting plate and pipe-thread sealant before hand-tightening, followed by wrench-tightening in Step 2.",
      ["Installation: Series TY-FRB Upright and Pendent Sprinklers, Steps 2-3", "Installation: Series TY-FRB Recessed Pendent Sprinklers, Steps 1-2"],
    )],
  },
  {
    id: "TFP171_RECESSED_FITTING_SURFACE_DIMENSION_V1",
    title: "Recessed fitting-face to mounting-surface interval",
    version: "1",
    scope: `${sourceScope} Checks only a phase-identified planned or as-built fitting-face to mounting-surface inch interval against a matching recessed model/style in Figures 5-10.`,
    requirementLevel: "requirement",
    sourceRefs: [
      sourceRef("Figure 5 dimension for TY2231 recessed Style 10; fitting-face to mounting-surface.", ["Figure 5"], 3),
      sourceRef("Figures 6-10 dimensions for TY2231/TY3231/TY4231 recessed styles; fitting-face to mounting-surface.", ["Figures 6-10"], 4),
    ],
  },
  {
    id: "TFP171_LISTED_TEMPERATURE_APPROVAL_COMBINATION_V1",
    title: "Listed temperature and named-agency table combination",
    version: "1",
    scope: `${sourceScope} Checks only a selected model/style/catalog-temperature/named-agency row in Tables A-C; it does not authenticate a unit's approval mark or establish project-required approvals.`,
    requirementLevel: "requirement",
    sourceRefs: [
      sourceRef("Table A model, style, temperature, and approval columns.", ["Table A"], 6),
      sourceRef("Table B model, style, temperature, and approval columns.", ["Table B"], 6),
      sourceRef("Table C model, style, temperature, and approval columns; Note 4 limits LPCB 007k/04 thermal-sensitivity interpretation for recessed sprinklers.", ["Table C", "Note 4"], 7),
    ],
  },
  {
    id: "TFP171_SPRINKLER_BODY_FINISH_TEMPERATURE_AVAILABILITY_V1",
    title: "Sprinkler-body finish and temperature table availability",
    version: "1",
    scope: `${sourceScope} Checks only a selected Table E sprinkler-body finish/catalog-temperature combination and stated Eastern-Hemisphere condition; it does not check recessed-escutcheon finish or current stock.`,
    requirementLevel: "requirement",
    sourceRefs: [
      sourceRef("Table E body finish and temperature part-number codes and Notes 1-4, including the Pure White sales-hemisphere restriction.", ["Table E", "Notes 1-4"], 8),
      sourceRef("Table A defines whether the TY2131/TY2231 model/style/catalog-temperature row is represented; absent rows are not used to infer Table E availability.", ["Table A"], 6),
      sourceRef("Table B defines whether the TY3131/TY3231 model/style/catalog-temperature row is represented; absent rows are not used to infer Table E availability.", ["Table B"], 6),
      sourceRef("Table C defines whether the TY4131/TY4231/TY4831/TY4931 model/style/catalog-temperature row is represented; absent rows are not used to infer Table E availability.", ["Table C"], 7),
    ],
  },
]);

type HeadScope = { model: string; mounting: "standard" | "recessed" } | { outcome: ProjectRuleResult };

function uniqueEvidence(fact: Fact<unknown> | undefined, path: string, projectId: string, context: RuleContext, evidence: readonly ProjectEvidence[], allowedKinds?: readonly ProjectEvidence["kind"][]): string[] {
  const issues = factIssues(fact, context, path);
  if (!fact || !Array.isArray(fact.evidenceIds) || !fact.evidenceIds.length) return [...new Set(issues)];
  if (new Set(fact.evidenceIds).size !== fact.evidenceIds.length) issues.push(`${path}.evidenceIds`);

  const records = fact.evidenceIds.map(id => {
    const matches = evidence.filter(item => item.id === id);
    if (matches.length !== 1) {
      issues.push(`${path}.evidenceIds:${id}`);
      return undefined;
    }
    const record = matches[0]!;
    if (record.projectId !== projectId || !record.subjectIds.includes(context.targetId) || record.superseded || record.invalidated) {
      issues.push(`${path}.evidenceIds:${id}`);
    }
    if (record.kind !== "photo" && !record.documentRevision) issues.push(`${path}.evidenceIds:${id}.documentRevision`);
    return record;
  }).filter((item): item is ProjectEvidence => !!item);

  if (allowedKinds?.length && !records.some(record => allowedKinds.includes(record.kind))) {
    issues.push(`${path}.evidenceIds.kind`);
  }
  return [...new Set(issues)];
}

function uniqueValues<T extends string>(fact: Fact<T> | undefined, path: string, allowed: readonly string[], projectId: string, context: RuleContext, evidence: readonly ProjectEvidence[], allowedEvidenceKinds?: readonly ProjectEvidence["kind"][]): { value?: T; issues: string[] } {
  const issues = uniqueEvidence(fact, path, projectId, context, evidence, allowedEvidenceKinds);
  const value = fact && allowed.includes(String(fact.value)) ? fact.value as T : undefined;
  if (value === undefined) issues.push(path);
  return { ...(value === undefined ? {} : { value }), issues: [...new Set(issues)] };
}

function emptyHeadScope(rule: ExtraRule, facts: HeadFacts, projectId: string, context: RuleContext, evidence: readonly ProjectEvidence[], unsupportedRecessed: "not_applicable" | "unknown" = "not_applicable"): HeadScope {
  const contextMissing = contextIssues(context);
  if (contextMissing.length) return { outcome: makeResult(rule, context, "unknown", "unknown", "The rule context is invalid.", contextMissing) };

  const modelFact = uniqueEvidence(facts.model, "model", projectId, context, evidence);
  const modelValue = typeof facts.model?.value === "string" ? facts.model.value.trim().toUpperCase() : "";
  if (["UNKNOWN", "AMBIGUOUS", "UNREADABLE"].includes(modelValue)) {
    return { outcome: makeResult(rule, context, "unknown", "unknown", "The TFP171 model is unresolved or ambiguous.", ["model"], facts.model?.evidenceIds ?? []) };
  }
  if (!modelFact.length && modelValue && !modelIds.has(modelValue)) {
    return { outcome: makeResult(rule, context, "not_applicable", "not_applicable", `The independently confirmed model ${modelValue} is outside TFP171.`) };
  }
  if (modelFact.length || !modelValue) {
    return { outcome: makeResult(rule, context, "unknown", "unknown", "The TFP171 model is not independently established with matching project evidence.", modelFact.length ? modelFact : ["model"]) };
  }

  const installation = uniqueValues(facts.installation, "installation", FACT_OPTIONS.installation, projectId, context, evidence);
  if (installation.value === "uninstalled" && !installation.issues.length) {
    return { outcome: makeResult(rule, context, "not_applicable", "not_applicable", "The head is independently confirmed uninstalled; this check covers installed heads.") };
  }
  const mounting = uniqueValues(facts.mounting, "mounting", FACT_OPTIONS.mounting, projectId, context, evidence);
  if (installation.issues.length || !installation.value) {
    return { outcome: makeResult(rule, context, "unknown", "unknown", "Installed status is not independently established with matching project evidence.", installation.issues.length ? installation.issues : ["installation"]) };
  }
  if (mounting.value === "recessed" && !recessedModels.has(modelValue) && !mounting.issues.length) {
    return { outcome: unsupportedRecessed === "unknown"
      ? makeResult(rule, context, "unknown", "unknown", "This confirmed model/recessed combination is not mapped by the checked TFP171 recessed figures; manual review is required.", ["model", "mounting"])
      : makeResult(rule, context, "not_applicable", "not_applicable", "This model/recessed combination is outside the TFP171 recessed-product scope; this does not approve that combination.") };
  }
  if (mounting.issues.length || !mounting.value) {
    return { outcome: makeResult(rule, context, "unknown", "unknown", "Mounting style is not independently established with matching project evidence.", mounting.issues.length ? mounting.issues : ["mounting"]) };
  }
  return { model: modelValue, mounting: mounting.value };
}

/** Candidate catalog facts are tied to a revisioned drawing and do not require installation. */
function selectedHeadScope(rule: ExtraRule, facts: HeadFacts, projectId: string, context: RuleContext, evidence: readonly ProjectEvidence[]): HeadScope {
  const contextMissing = contextIssues(context);
  if (contextMissing.length) return { outcome: makeResult(rule, context, "unknown", "unknown", "The rule context is invalid.", contextMissing) };

  const modelFact = uniqueEvidence(facts.model, "model", projectId, context, evidence, ["drawing"]);
  const modelValue = typeof facts.model?.value === "string" ? facts.model.value.trim().toUpperCase() : "";
  if (["UNKNOWN", "AMBIGUOUS", "UNREADABLE"].includes(modelValue)) {
    return { outcome: makeResult(rule, context, "unknown", "unknown", "The selected TFP171 model is unresolved or ambiguous.", ["model"], facts.model?.evidenceIds ?? []) };
  }
  if (modelFact.length || !modelValue) {
    return { outcome: makeResult(rule, context, "unknown", "unknown", "The selected product model is not independently established by a current project drawing.", modelFact.length ? modelFact : ["model"], facts.model?.evidenceIds ?? []) };
  }
  if (!modelIds.has(modelValue)) {
    return { outcome: makeResult(rule, context, "not_applicable", "not_applicable", `The selected model ${modelValue} is outside TFP171.`) };
  }

  const mounting = uniqueValues(facts.mounting, "mounting", FACT_OPTIONS.mounting, projectId, context, evidence, ["drawing"]);
  if (mounting.issues.length || !mounting.value) {
    return { outcome: makeResult(rule, context, "unknown", "unknown", "The selected mounting is not independently established by a current project drawing.", mounting.issues.length ? mounting.issues : ["mounting"], factEvidenceIds(facts.model, facts.mounting)) };
  }
  return { model: modelValue, mounting: mounting.value };
}

function makeResult(rule: ExtraRule, context: RuleContext, status: RuleStatus, applicability: ProjectRuleResult["applicability"], reason: string, missingInputs: string[] = [], evidenceIds: string[] = [], sourceRefs: readonly ProjectSourceReference[] = rule.sourceRefs): ProjectRuleResult {
  return {
    ruleId: rule.id,
    title: rule.title,
    scope: rule.scope,
    targetId: context.targetId,
    subjectIds: [context.targetId],
    packId: "tyco-tfp171-extra",
    requirementLevel: rule.requirementLevel,
    status,
    applicability,
    reason,
    missingInputs: [...new Set(missingInputs)],
    evidenceIds: [...new Set(evidenceIds)],
    sourceRefs,
    versions: { taskRevision: context.taskRevision, ruleVersion: rule.version, sourceRevision: "August 2026" },
  };
}

function finish(rule: ExtraRule, context: RuleContext, status: RuleStatus, reason: string, missingInputs: string[] = [], evidenceIds: string[] = [], sourceRefs: readonly ProjectSourceReference[] = rule.sourceRefs): ProjectRuleResult {
  return makeResult(rule, context, status, "applicable", reason, missingInputs, evidenceIds, sourceRefs);
}

function factEvidenceIds(...facts: Array<Fact<unknown> | undefined>): string[] {
  return facts.flatMap(fact => fact?.evidenceIds ?? []);
}

function evaluateWrench(rule: ExtraRule, facts: HeadFacts, extra: ManufacturerExtraFacts, projectId: string, context: RuleContext, evidence: readonly ProjectEvidence[]): ProjectRuleResult {
  const scope = emptyHeadScope(rule, facts, projectId, context, evidence);
  if ("outcome" in scope) return scope.outcome;
  const thread = uniqueValues(facts.threadStandard, "threadStandard", FACT_OPTIONS.threadStandard, projectId, context, evidence);
  if (thread.issues.length || thread.value !== "npt") {
    return finish(rule, context, "unknown", thread.issues.length ? "The thread standard is not independently established with matching project evidence." : "This bounded check is based on the TFP171 NPT wrench figures; application to the confirmed special ISO 7-1 connection has not been established.", thread.issues.length ? thread.issues : ["threadStandard"], factEvidenceIds(facts.model, facts.installation, facts.mounting, facts.threadStandard));
  }
  const area = uniqueValues(extra.installationWrenchEngagementArea, "installationWrenchEngagementArea", ["wrench_flats", "other_area"], projectId, context, evidence, ["installation"]);
  if (area.issues.length || !area.value) return finish(rule, context, "unknown", "An installation record confirming wrench engagement location is required; the finished head appearance does not establish it.", area.issues.length ? area.issues : ["installationWrenchEngagementArea"], factEvidenceIds(facts.model, facts.installation, facts.mounting, facts.threadStandard, extra.installationWrenchEngagementArea));
  return finish(rule, context, area.value === "wrench_flats" ? "pass" : "fail", area.value === "wrench_flats" ? "The installation record confirms the wrench engaged the specified wrench flats." : "The installation record confirms the wrench was applied outside the specified wrench flats.", [], factEvidenceIds(facts.model, facts.installation, facts.mounting, facts.threadStandard, extra.installationWrenchEngagementArea));
}

function evaluateInstallationSequence(rule: ExtraRule, facts: HeadFacts, extra: ManufacturerExtraFacts, projectId: string, context: RuleContext, evidence: readonly ProjectEvidence[]): ProjectRuleResult {
  const scope = emptyHeadScope(rule, facts, projectId, context, evidence, "unknown");
  if ("outcome" in scope) return scope.outcome;
  const thread = uniqueValues(facts.threadStandard, "threadStandard", FACT_OPTIONS.threadStandard, projectId, context, evidence);
  if (thread.issues.length || thread.value !== "npt") {
    return finish(rule, context, "unknown", thread.issues.length
      ? "The thread standard is not independently established with matching project evidence."
      : "This bounded procedure check is based on the NPT connection instructions; the confirmed special ISO 7-1 connection needs manual review.", thread.issues.length ? thread.issues : ["threadStandard"],
    factEvidenceIds(facts.model, facts.installation, facts.mounting, facts.threadStandard));
  }

  const sealant = uniqueValues(extra.pipeThreadSealantAppliedBeforeHandTightening, "pipeThreadSealantAppliedBeforeHandTightening", ["yes", "no"], projectId, context, evidence, ["installation"]);
  const handTighten = uniqueValues(extra.headHandTightenedBeforeWrenchTightening, "headHandTightenedBeforeWrenchTightening", ["yes", "no"], projectId, context, evidence, ["installation"]);
  const plate = scope.mounting === "recessed"
    ? uniqueValues(extra.mountingPlateInstalledBeforeHandTightening, "mountingPlateInstalledBeforeHandTightening", ["yes", "no"], projectId, context, evidence, ["installation"])
    : undefined;
  const factsToCheck = [sealant, handTighten, ...(plate ? [plate] : [])];
  const evidenceIds = factEvidenceIds(facts.model, facts.installation, facts.mounting, facts.threadStandard,
    extra.pipeThreadSealantAppliedBeforeHandTightening, extra.headHandTightenedBeforeWrenchTightening,
    ...(scope.mounting === "recessed" ? [extra.mountingPlateInstalledBeforeHandTightening] : []));

  const falseFacts = factsToCheck.filter(item => !item.issues.length && item.value === "no");
  if (falseFacts.length) {
    const knownFailure = falseFacts[0]!;
    const detail = knownFailure === sealant
      ? "The installation record confirms pipe-thread sealant was omitted or applied only after hand-tightening; TFP171 requires it before hand-tightening."
      : knownFailure === handTighten
        ? "The installation record confirms hand-tightening did not precede wrench-tightening as TFP171 instructs."
        : "The recessed installation record confirms the mounting plate was not installed before hand-tightening as TFP171 instructs.";
    return finish(rule, context, "fail", detail, [], evidenceIds);
  }
  const missing = factsToCheck.flatMap(item => item.issues);
  if (missing.length) return finish(rule, context, "unknown", "Installation history must confirm sealant-before-hand-tightening and hand-tightening-before-wrench-tightening; recessed heads also require the plate-before-hand-tightening fact.", missing, evidenceIds);
  return finish(rule, context, "pass", scope.mounting === "recessed"
    ? "The installation record confirms the recessed plate and pipe-thread sealant preceded hand-tightening, which preceded wrench-tightening; other installation conditions are separate."
    : "The installation record confirms pipe-thread sealant and hand-tightening preceded wrench-tightening; other installation conditions are separate.", [], evidenceIds);
}

function validateDistanceInterval(value: unknown): asserts value is RecessedFittingFaceToMountingSurfaceInterval {
  const path = `manufacturerExtra.recessedFittingFaceToMountingSurfaceInterval`;
  if (!value || typeof value !== "object") {
    throw new ProjectInputError("invalid_input", "Recessed distance must be an explicit interval with lower, upper, unit, and phase fields.", [path]);
  }
  const interval = value as Partial<RecessedFittingFaceToMountingSurfaceInterval>;
  if (interval.unit !== "in" || !["planned", "as_built"].includes(String(interval.phase)) || !Number.isFinite(interval.lower) || !Number.isFinite(interval.upper) || interval.lower! < 0 || interval.upper! < 0 || interval.lower! > interval.upper!) {
    throw new ProjectInputError("invalid_input", "Recessed distance interval must have finite, non-negative, ordered inch bounds and an explicit planned or as-built phase.", [path]);
  }
}

function evaluateRecessedDistance(rule: ExtraRule, facts: HeadFacts, extra: ManufacturerExtraFacts, projectId: string, context: RuleContext, evidence: readonly ProjectEvidence[]): ProjectRuleResult {
  const scopedInterval = extra.recessedFittingFaceToMountingSurfaceInterval;
  if (scopedInterval?.value != null) validateDistanceInterval(scopedInterval.value);
  const phase = scopedInterval?.value?.phase;
  const isAsBuilt = phase === "as_built" || (!phase && facts.installation?.value === "installed");
  const scope = isAsBuilt
    ? emptyHeadScope(rule, facts, projectId, context, evidence, "unknown")
    : selectedHeadScope(rule, facts, projectId, context, evidence);
  if ("outcome" in scope) return scope.outcome;
  if (scope.mounting === "standard") return makeResult(rule, context, "not_applicable", "not_applicable", "The confirmed standard-mounted head is outside this recessed-dimension check.", [], factEvidenceIds(facts.model, facts.installation, facts.mounting));
  if (!phase) return finish(rule, context, "unknown", "An explicit planned-versus-as-built dimension phase is required; candidate drawing geometry cannot be reported as an as-built measurement or vice versa.", ["recessedFittingFaceToMountingSurfaceInterval.phase"], factEvidenceIds(facts.model, facts.installation, facts.mounting, scopedInterval));
  const thread = uniqueValues(facts.threadStandard, "threadStandard", FACT_OPTIONS.threadStandard, projectId, context, evidence, phase === "planned" ? ["drawing"] : ["inspection"]);
  if (thread.issues.length || thread.value !== "npt") {
    return finish(rule, context, "unknown", thread.issues.length
      ? "The thread standard is not independently established with matching project evidence."
      : "The checked dimension figures show NPT products; this confirmed non-NPT connection is not mapped.", thread.issues.length ? thread.issues : ["threadStandard"],
    factEvidenceIds(facts.model, facts.installation, facts.mounting, facts.threadStandard));
  }
  const factKinds: readonly ProjectEvidence["kind"][] = phase === "planned" ? ["drawing"] : ["inspection"];
  const style = uniqueValues(facts.escutcheon, "escutcheon", FACT_OPTIONS.escutcheon, projectId, context, evidence, factKinds);
  const mapping: Record<string, Record<string, { low: number; high: number; figure: number; page: number }>> = {
    TY2231: {
      style_10: { low: 3 / 8, high: 7 / 8, figure: 5, page: 3 },
      style_20: { low: 3 / 8, high: 5 / 8, figure: 6, page: 3 },
    },
    TY3231: {
      style_10: { low: 3 / 8, high: 7 / 8, figure: 7, page: 4 },
      style_20: { low: 3 / 8, high: 5 / 8, figure: 8, page: 4 },
    },
    TY4231: {
      style_40: { low: 3 / 8, high: 7 / 8, figure: 9, page: 4 },
      style_30: { low: 3 / 8, high: 5 / 8, figure: 10, page: 4 },
    },
  };
  if (style.issues.length || !style.value) return finish(rule, context, "unknown", "The recessed escutcheon style is not independently established with matching project evidence.", style.issues.length ? style.issues : ["escutcheon"], factEvidenceIds(facts.model, facts.installation, facts.mounting, facts.threadStandard, facts.escutcheon));
  const allowed = mapping[scope.model]?.[style.value];
  if (!allowed) return finish(rule, context, "unknown", "The confirmed recessed model/style combination has no fitting-to-mounting-surface dimension in Figures 5-10; manual review is required.", ["model", "escutcheon"], factEvidenceIds(facts.model, facts.installation, facts.mounting, facts.threadStandard, facts.escutcheon));

  const interval = uniqueEvidence(scopedInterval, "recessedFittingFaceToMountingSurfaceInterval", projectId, context, evidence, factKinds);
  const validInterval = scopedInterval?.value;
  if (interval.length || !validInterval) return finish(rule, context, "unknown", `A confirmed ${phase === "planned" ? "planned drawing dimension" : "as-built measurement"} interval in inches is required; missing precision cannot be treated as zero uncertainty.`, interval.length ? interval : ["recessedFittingFaceToMountingSurfaceInterval"], factEvidenceIds(facts.model, facts.installation, facts.mounting, facts.threadStandard, facts.escutcheon, scopedInterval));

  const evidenceIds = factEvidenceIds(facts.model, facts.installation, facts.mounting, facts.threadStandard, facts.escutcheon, scopedInterval);
  const fullyInside = validInterval.lower >= allowed.low && validInterval.upper <= allowed.high;
  const measureKind = phase === "planned" ? "planned drawing dimension" : "as-built measurement";
  if (fullyInside) return finish(rule, context, "pass", `The entire confirmed ${validInterval.lower}-${validInterval.upper} in. ${measureKind} interval is within Figure ${allowed.figure}'s inclusive ${allowed.low}-${allowed.high} in. range; this is only the fitting-face to mounting-surface dimension.`, [], evidenceIds);
  const fullyOutside = validInterval.upper < allowed.low || validInterval.lower > allowed.high;
  if (fullyOutside) return finish(rule, context, "fail", `The entire confirmed ${validInterval.lower}-${validInterval.upper} in. ${measureKind} interval is outside Figure ${allowed.figure}'s inclusive ${allowed.low}-${allowed.high} in. range.`, [], evidenceIds);
  return finish(rule, context, "unknown", `The confirmed ${validInterval.lower}-${validInterval.upper} in. ${measureKind} interval overlaps Figure ${allowed.figure}'s ${allowed.low}-${allowed.high} in. range without being entirely inside or outside; measurement uncertainty prevents a conclusion.`, ["recessedFittingFaceToMountingSurfaceInterval"], evidenceIds);
}

type TemperatureCode = "135F_57C" | "155F_68C" | "175F_79C" | "200F_93C" | "286F_141C";
type AgencyCode = Exclude<ManufacturerAgency, "lpcb_unspecified" | "other">;

const TEMPERATURES: Readonly<Record<TemperatureCode, { f: number; c: number }>> = Object.freeze({
  "135F_57C": { f: 135, c: 57 },
  "155F_68C": { f: 155, c: 68 },
  "175F_79C": { f: 175, c: 79 },
  "200F_93C": { f: 200, c: 93 },
  "286F_141C": { f: 286, c: 141 },
});

const ALL_TEMPERATURES = Object.freeze(Object.keys(TEMPERATURES) as TemperatureCode[]);
const LOW_TY2231_TEMPERATURES = Object.freeze(ALL_TEMPERATURES.filter(item => item !== "286F_141C"));
const UL_CUL: readonly AgencyCode[] = ["ul", "c_ul"];
const UL_CUL_FM: readonly AgencyCode[] = ["ul", "c_ul", "fm"];
const UL_CUL_FM_LPCB_VDS_LPCB: readonly AgencyCode[] = ["ul", "c_ul", "fm", "lpcb_007k_04", "vds", "lpcb_094a_06"];
const UL_CUL_LPCB_VDS: readonly AgencyCode[] = ["ul", "c_ul", "lpcb_007k_04", "vds"];

interface ManufacturerCatalogConfiguration {
  table: "Table A" | "Table B" | "Table C";
  temperatures: readonly TemperatureCode[];
  agencies: readonly AgencyCode[];
}

function configurationFor(model: string, mounting: "standard" | "recessed", style?: string): ManufacturerCatalogConfiguration | undefined {
  if (mounting === "standard") {
    if (model === "TY2131" || model === "TY2231") return { table: "Table A", temperatures: ALL_TEMPERATURES, agencies: UL_CUL };
    if (model === "TY3131" || model === "TY3231") return { table: "Table B", temperatures: ALL_TEMPERATURES, agencies: UL_CUL_FM };
    if (model === "TY4131" || model === "TY4231") return { table: "Table C", temperatures: ALL_TEMPERATURES, agencies: UL_CUL_FM_LPCB_VDS_LPCB };
    if (model === "TY4831" || model === "TY4931") return { table: "Table C", temperatures: ALL_TEMPERATURES, agencies: UL_CUL_LPCB_VDS };
    return undefined;
  }
  if (model === "TY2231" && (style === "style_10" || style === "style_20")) {
    return { table: "Table A", temperatures: LOW_TY2231_TEMPERATURES, agencies: UL_CUL };
  }
  if (model === "TY3231" && style === "style_10") return { table: "Table B", temperatures: ALL_TEMPERATURES, agencies: UL_CUL };
  if (model === "TY3231" && style === "style_20") return { table: "Table B", temperatures: ALL_TEMPERATURES, agencies: UL_CUL_FM };
  if (model === "TY4231" && style === "style_40") return { table: "Table C", temperatures: ALL_TEMPERATURES, agencies: UL_CUL };
  if (model === "TY4231" && style === "style_30") return { table: "Table C", temperatures: ALL_TEMPERATURES, agencies: UL_CUL_FM };
  return undefined;
}

function tableForModel(model: string): ManufacturerCatalogConfiguration["table"] | undefined {
  if (model === "TY2131" || model === "TY2231") return "Table A";
  if (model === "TY3131" || model === "TY3231") return "Table B";
  if (["TY4131", "TY4231", "TY4831", "TY4931"].includes(model)) return "Table C";
  return undefined;
}

function modelSourceRefs(rule: ExtraRule, model: string, includeTableE = false, includeNote4 = false): readonly ProjectSourceReference[] {
  const table = tableForModel(model);
  if (!table) return rule.sourceRefs;
  const refs = rule.sourceRefs.filter(ref => ref.clauses?.includes(table)
    || (includeTableE && ref.clauses?.includes("Table E"))
    || (includeNote4 && ref.clauses?.includes("Note 4")));
  return refs.length ? refs : rule.sourceRefs;
}

function validateManufacturerTemperature(value: unknown, path: string): asserts value is ManufacturerTemperature {
  if (!value || typeof value !== "object") {
    throw new ProjectInputError("invalid_input", "Manufacturer temperature must include a numeric value and F or C unit.", [path]);
  }
  const temperature = value as Partial<ManufacturerTemperature>;
  if ((temperature.unit !== "F" && temperature.unit !== "C") || !Number.isFinite(temperature.value) || temperature.value! <= 0) {
    throw new ProjectInputError("invalid_input", "Manufacturer temperature must be finite, positive, and explicitly in F or C.", [path]);
  }
}

function temperatureCode(value: ManufacturerTemperature): TemperatureCode | undefined {
  return ALL_TEMPERATURES.find(code => TEMPERATURES[code][value.unit.toLowerCase() as "f" | "c"] === value.value);
}

function uniqueTemperature(fact: Fact<ManufacturerTemperature> | undefined, path: string, projectId: string, context: RuleContext, evidence: readonly ProjectEvidence[], allowedKinds: readonly ProjectEvidence["kind"][] = ["inspection"]): { value?: ManufacturerTemperature; issues: string[] } {
  if (fact?.value !== undefined && fact.value !== null) validateManufacturerTemperature(fact.value, path);
  const issues = uniqueEvidence(fact, path, projectId, context, evidence, allowedKinds);
  return { ...(fact?.value ? { value: fact.value } : {}), issues };
}

function evaluateTemperatureApproval(rule: ExtraRule, facts: HeadFacts, extra: ManufacturerExtraFacts, projectId: string, context: RuleContext, evidence: readonly ProjectEvidence[]): ProjectRuleResult {
  const scope = selectedHeadScope(rule, facts, projectId, context, evidence);
  if ("outcome" in scope) return scope.outcome;
  const style = scope.mounting === "recessed"
    ? uniqueValues(facts.escutcheon, "escutcheon", FACT_OPTIONS.escutcheon, projectId, context, evidence, ["drawing"])
    : undefined;
  if (style && (style.issues.length || !style.value)) return finish(rule, context, "unknown", "The recessed escutcheon style is not independently established with matching project evidence.", style.issues.length ? style.issues : ["escutcheon"], factEvidenceIds(facts.model, facts.installation, facts.mounting, facts.escutcheon));
  const config = configurationFor(scope.model, scope.mounting, style?.value);
  const rowRefs = modelSourceRefs(rule, scope.model);
  if (!config) return finish(rule, context, "unknown", "The confirmed model/style combination has no mapped Tables A-C row in this bounded lookup; manual review is required.", ["model", ...(style ? ["escutcheon"] : [])], factEvidenceIds(facts.model, facts.installation, facts.mounting, facts.escutcheon), rowRefs);

  const rating = uniqueTemperature(extra.manufacturerTemperatureRating, "manufacturerTemperatureRating", projectId, context, evidence, ["drawing"]);
  const agency = uniqueValues(extra.manufacturerListedAgency, "manufacturerListedAgency", ["ul", "c_ul", "fm", "lpcb_007k_04", "lpcb_094a_06", "vds", "lpcb_unspecified", "other"], projectId, context, evidence, ["drawing"]);
  const evidenceIds = factEvidenceIds(facts.model, facts.installation, facts.mounting, ...(style ? [facts.escutcheon] : []), extra.manufacturerTemperatureRating, extra.manufacturerListedAgency);
  const missing = [...rating.issues, ...agency.issues];
  if (missing.length || !rating.value || !agency.value) return finish(rule, context, "unknown", "A revisioned drawing must independently confirm the selected catalog temperature and specific named agency for this table check.", missing.length ? missing : [!rating.value ? "manufacturerTemperatureRating" : "manufacturerListedAgency"], evidenceIds, rowRefs);
  if (agency.value === "lpcb_unspecified") return finish(rule, context, "unknown", "The label identifies LPCB without the specific 007k/04 or 094a/06 reference distinguished in Table C; manual review is required.", ["manufacturerListedAgency"], evidenceIds, rowRefs);

  const code = temperatureCode(rating.value);
  if (!code) return finish(rule, context, "fail", `The selected ${rating.value.value}°${rating.value.unit} catalog temperature is not an exact pair printed in TFP171 Tables A-C.`, [], evidenceIds, rowRefs);
  if (!config.temperatures.includes(code)) return finish(rule, context, "fail", `The confirmed ${code} rating has no row for ${scope.model}${style?.value ? ` recessed ${style.value.replace("style_", "Style ")}` : " standard"} in ${config.table}.`, [], evidenceIds, rowRefs);
  if (scope.model === "TY4231" && scope.mounting === "recessed" && agency.value === "lpcb_007k_04") {
    return finish(rule, context, "unknown", "Table C Note 4 says LPCB 007k/04 does not rate recessed-sprinkler thermal sensitivity; this row cannot confirm or reject that selected agency/configuration.", ["manufacturerListedAgency"], evidenceIds, modelSourceRefs(rule, scope.model, false, true));
  }
  if (!config.agencies.includes(agency.value as AgencyCode)) return finish(rule, context, "fail", `The selected ${config.table} model/style/${code} row does not show the selected agency ${agency.value}.`, [], evidenceIds, rowRefs);
  return finish(rule, context, "pass", `The selected ${config.table} row represents ${scope.model}${style?.value ? ` recessed ${style.value.replace("style_", "Style ")}` : " standard"}, ${code}, and the selected agency ${agency.value}; this is table membership only and does not authenticate an installed unit or determine project-required approval.`, [], evidenceIds, rowRefs);
}

function evaluateBodyFinishAvailability(rule: ExtraRule, facts: HeadFacts, extra: ManufacturerExtraFacts, projectId: string, context: RuleContext, evidence: readonly ProjectEvidence[]): ProjectRuleResult {
  const scope = selectedHeadScope(rule, facts, projectId, context, evidence);
  if ("outcome" in scope) return scope.outcome;
  const style = scope.mounting === "recessed"
    ? uniqueValues(facts.escutcheon, "escutcheon", FACT_OPTIONS.escutcheon, projectId, context, evidence, ["drawing"])
    : undefined;
  if (style && (style.issues.length || !style.value)) return finish(rule, context, "unknown", "The recessed style is not independently established before checking Table E availability.", style.issues.length ? style.issues : ["escutcheon"], factEvidenceIds(facts.model, facts.installation, facts.mounting, facts.escutcheon), modelSourceRefs(rule, scope.model, true));
  const config = configurationFor(scope.model, scope.mounting, style?.value);
  const rowRefs = modelSourceRefs(rule, scope.model, true);
  if (!config) return finish(rule, context, "unknown", "The confirmed model/style combination has no mapped Tables A-C catalog row; Table E availability is not inferred.", ["model", ...(style ? ["escutcheon"] : [])], factEvidenceIds(facts.model, facts.installation, facts.mounting, facts.escutcheon), rowRefs);

  const rating = uniqueTemperature(extra.manufacturerTemperatureRating, "manufacturerTemperatureRating", projectId, context, evidence, ["drawing"]);
  const finishValue = uniqueValues(extra.sprinklerBodyFinish, "sprinklerBodyFinish", ["natural_brass", "pure_white_polyester", "signal_white_polyester", "chrome_plated", "other"], projectId, context, evidence, ["drawing"]);
  const evidenceIds = factEvidenceIds(facts.model, facts.installation, facts.mounting, ...(style ? [facts.escutcheon] : []), extra.manufacturerTemperatureRating, extra.sprinklerBodyFinish, extra.sprinklerSalesHemisphere);
  const initialMissing = [...rating.issues, ...finishValue.issues];
  if (initialMissing.length || !rating.value || !finishValue.value) return finish(rule, context, "unknown", "A revisioned drawing must independently confirm the selected catalog temperature and sprinkler-body finish.", initialMissing.length ? initialMissing : [!rating.value ? "manufacturerTemperatureRating" : "sprinklerBodyFinish"], evidenceIds, rowRefs);
  const code = temperatureCode(rating.value);
  if (!code || !config.temperatures.includes(code)) return finish(rule, context, "unknown", "The confirmed model/style/catalog-temperature combination has no applicable Tables A-C row, so Table E availability is not inferred.", ["manufacturerTemperatureRating"], evidenceIds, rowRefs);

  let unavailableReason: string | undefined;
  if (finishValue.value === "natural_brass" && ((scope.model === "TY2231" && code === "286F_141C") || (scope.model === "TY3131" && code === "135F_57C"))) {
    unavailableReason = `Table E Note 1 excludes Natural Brass for ${scope.model} at ${code}.`;
  } else if (finishValue.value === "pure_white_polyester" && scope.model === "TY3231" && code === "200F_93C") {
    unavailableReason = "Table E Note 2 excludes Pure White Polyester for TY3231 at 200F_93C.";
  } else if (finishValue.value === "signal_white_polyester" && ((scope.model === "TY3131" && ["175F_79C", "200F_93C", "286F_141C"].includes(code)) || (scope.model === "TY3231" && code === "175F_79C"))) {
    unavailableReason = `Table E Note 3 excludes Signal White Polyester for ${scope.model} at ${code}.`;
  } else if (finishValue.value === "chrome_plated" && scope.model === "TY3231" && code === "135F_57C") {
    unavailableReason = "Table E Note 4 excludes Chrome Plated for TY3231 at 135F_57C.";
  }
  if (unavailableReason) return finish(rule, context, "fail", unavailableReason, [], evidenceIds, [rule.sourceRefs[0]!, ...modelSourceRefs(rule, scope.model, false)]);
  if (finishValue.value === "other") return finish(rule, context, "fail", "The confirmed sprinkler-body finish is not one of Table E's four catalog finish choices.", [], evidenceIds, [rule.sourceRefs[0]!, ...modelSourceRefs(rule, scope.model, false)]);
  if (finishValue.value === "pure_white_polyester") {
    const hemisphere = uniqueValues(extra.sprinklerSalesHemisphere, "sprinklerSalesHemisphere", ["eastern", "other"], projectId, context, evidence, ["drawing", "permit"]);
    if (hemisphere.issues.length || !hemisphere.value) return finish(rule, context, "unknown", "Pure White Polyester is limited to Eastern-Hemisphere sales; the applicable sales hemisphere is not independently established.", hemisphere.issues.length ? hemisphere.issues : ["sprinklerSalesHemisphere"], evidenceIds, [rule.sourceRefs[0]!]);
    if (hemisphere.value === "other") return finish(rule, context, "fail", "Table E Note 2 limits Pure White Polyester to Eastern-Hemisphere sales; the confirmed sale is outside that region.", [], evidenceIds, [rule.sourceRefs[0]!]);
  }
  return finish(rule, context, "pass", `Table E represents the selected ${scope.model} ${finishValue.value.replaceAll("_", " ")} body-finish / ${code} catalog-temperature combination${finishValue.value === "pure_white_polyester" ? " for the confirmed Eastern-Hemisphere sale" : ""}; this does not establish current stock, an installed unit's label, or local suitability.`, [], evidenceIds, [rule.sourceRefs[0]!, ...modelSourceRefs(rule, scope.model, false)]);
}

/** Evaluate only the source-reviewed bounded TFP171 extra conditions. */
export function evaluateManufacturerExtraRules(input: {
  projectId: string;
  facts: HeadFacts;
  extraFacts: ManufacturerExtraFacts;
  context: RuleContext;
  evidence: readonly ProjectEvidence[];
}): ProjectRuleResult[] {
  const { projectId, facts, extraFacts, context, evidence } = input;
  return [
    evaluateWrench(RULES[0]!, facts, extraFacts, projectId, context, evidence),
    evaluateInstallationSequence(RULES[1]!, facts, extraFacts, projectId, context, evidence),
    evaluateRecessedDistance(RULES[2]!, facts, extraFacts, projectId, context, evidence),
    evaluateTemperatureApproval(RULES[3]!, facts, extraFacts, projectId, context, evidence),
    evaluateBodyFinishAvailability(RULES[4]!, facts, extraFacts, projectId, context, evidence),
  ];
}

export function evaluateManufacturerExtraRule(input: Parameters<typeof evaluateManufacturerExtraRules>[0], ruleId: string): ProjectRuleResult[] {
  const index = RULES.findIndex(rule => rule.id === ruleId);
  const evaluator = [evaluateWrench, evaluateInstallationSequence, evaluateRecessedDistance, evaluateTemperatureApproval, evaluateBodyFinishAvailability][index];
  if (!evaluator) throw new Error(`Unknown manufacturer rule: ${ruleId}`);
  return [evaluator(RULES[index]!, input.facts, input.extraFacts, input.projectId, input.context, input.evidence)];
}
