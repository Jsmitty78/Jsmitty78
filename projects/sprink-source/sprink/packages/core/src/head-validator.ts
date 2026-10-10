import { contextIssues, factIssues } from "./evidence.js";
import { FACT_OPTIONS, type HeadFacts, type Orientation, type PlanComparison, type RuleContext, type RuleDefinition, type RuleResult, type RuleStatus } from "./types.js";

const sourceUrl = "https://docs.johnsoncontrols.com/tycofire/api/khub/documents/JXGj~rL_f_FBVCY52uMTJw/content";
const modelSpecs = Object.freeze({
  TY2131: { orientation: "upright", thread: "half" },
  TY2231: { orientation: "pendent", thread: "half" },
  TY3131: { orientation: "upright", thread: "half" },
  TY3231: { orientation: "pendent", thread: "half" },
  TY4131: { orientation: "upright", thread: "three_quarter" },
  TY4231: { orientation: "pendent", thread: "three_quarter" },
  TY4831: { orientation: "upright", thread: "half" },
  TY4931: { orientation: "pendent", thread: "half" },
} as const);
type Model = keyof typeof modelSpecs;
const recessedModels: readonly Model[] = ["TY2231", "TY3231", "TY4231"];
const retrofitModels: readonly Model[] = ["TY4831", "TY4931"];
const scope = "Confirmed installed TFP171 products: eight standard models or recessed TY2231/TY3231/TY4231 only; not whole-system compliance.";

function definition(id: string, title: string, pages: readonly number[], detail: string, version = "1"): RuleDefinition {
  return Object.freeze({
    id, title, version, sourceRevision: "August 2026", scope: `${scope} ${detail}`,
    sources: Object.freeze(pages.map(page => Object.freeze({ document: "TFP171", revision: "August 2026", page, url: sourceUrl, purpose: detail }))),
  });
}

export const ADOPTED_RULES: readonly RuleDefinition[] = Object.freeze([
  definition("TFP171_INSTALL_ORIENTATION_V2", "型式に応じた取付方向", [3, 5, 6, 7], "Model identification and installed upright/pendent orientation; no invented angular tolerance.", "2"),
  definition("TFP171_RECESSED_ESCUTCHEON_V1", "埋込型と化粧板の組合せ", [3, 4, 6, 7], "Recessed TY2231/TY3231 use Style 10 or 20; TY4231 uses Style 30 or 40. This does not check listing, temperature, or adjustment dimensions."),
  definition("TFP171_BULB_CONDITION_V1", "ガラス球の割れ・液減り", [4, 5], "Independently inspected bulb cracking or loss of liquid; no bubble-size or image-resolution tolerance."),
  definition("TFP171_INSTALLATION_WRENCH_V1", "施工時の指定レンチ", [5], "Independent installation record: W-Type 6 for standard heads and W-Type 7 for recessed heads; appearance alone does not establish the tool used."),
  definition("TFP171_NPT_INSTALLATION_TORQUE_V1", "NPTねじの施工トルク", [3, 4], "Independent installation torque record in ft-lb: 1/2-inch NPT 7-14, 3/4-inch NPT 10-20. This does not establish leak tightness or authorize retightening."),
  definition("TFP171_RETROFIT_ONLY_V1", "8.0K・1/2インチNPT型の改修限定", [1, 3], "TY4831/TY4931 with NPT threads: manufacturer notice limits these 8.0K, 1/2-inch NPT models to retrofit, not new construction. This is not a general NFPA implementation."),
  definition("TFP171_FACTORY_FINISH_V1", "工場出荷後の塗装・めっき・被覆", [5], "Independently established post-factory paint, plating, or coating requires replacement. Other forms of alteration are outside this check."),
  definition("TFP171_LEAKAGE_V1", "ヘッドの漏れ", [5], "An independently confirmed leaking sprinkler requires replacement; a photograph alone cannot establish absence of leakage."),
  definition("TFP171_VISIBLE_CORROSION_V1", "ヘッドの目視腐食", [5], "Independently confirmed visible signs of corrosion require replacement; this does not predict internal condition or corrosion resistance."),
  definition("TFP171_WORKING_PRESSURE_V1", "最大使用圧力", [8], "Table D NPT maximum working pressure: 175 psi, or 250 psi for TY3131/TY3231 when the UL/C-UL listing basis is independently confirmed. This does not establish listing suitability, test pressure, or hydraulic adequacy."),
]);
export const RULE = ADOPTED_RULES[0];

function result(rule: RuleDefinition, facts: HeadFacts, ctx: RuleContext, status: RuleStatus, applicability: RuleResult["applicability"], reason: string, missingInputs: string[] = []): RuleResult {
  return {
    ruleId: rule.id, title: rule.title, scope: rule.scope, targetId: ctx.targetId, status, applicability, reason,
    missingInputs: [...new Set(missingInputs)],
    evidenceIds: [...new Set(Object.values(facts).flatMap(fact => Array.isArray(fact?.evidenceIds) ? fact.evidenceIds.filter((id: unknown): id is string => typeof id === "string") : []))],
    sourceRefs: rule.sources,
    versions: { taskRevision: ctx.taskRevision, ruleVersion: rule.version, sourceRevision: rule.sourceRevision },
  };
}

function enumIssues<K extends keyof typeof FACT_OPTIONS>(facts: HeadFacts, key: K, ctx: RuleContext): string[] {
  const value = facts[key]?.value;
  return [...factIssues(facts[key], ctx, key), ...(!(FACT_OPTIONS[key] as readonly unknown[]).includes(value) ? [key] : [])];
}
function numericIssues(facts: HeadFacts, key: "installationTorqueFtLb" | "workingPressurePsi", ctx: RuleContext): string[] {
  const value = facts[key]?.value;
  return [...factIssues(facts[key], ctx, key), ...(typeof value !== "number" || !Number.isFinite(value) || value < 0 ? [key] : [])];
}
function modelIssues(facts: HeadFacts, ctx: RuleContext): string[] {
  const issues = factIssues(facts.model, ctx, "model");
  const model = facts.model?.value;
  if (typeof model !== "string" || !/^[A-Z0-9][A-Z0-9._-]*$/i.test(model.trim())) issues.push("model");
  if (typeof model === "string" && ["UNKNOWN", "AMBIGUOUS", "UNREADABLE"].includes(model.trim().toUpperCase())) issues.push("model");
  return issues;
}

type Gate = { model: Model; mounting: "standard" | "recessed" } | { outcome: RuleResult };
function applicability(rule: RuleDefinition, facts: HeadFacts, ctx: RuleContext, options: { models?: readonly Model[]; recessedOnly?: boolean; nptOnly?: boolean } = {}): Gate {
  const finish = (status: RuleStatus, why: string, missing: string[] = []): Gate => ({ outcome: result(rule, facts, ctx, status, status === "not_applicable" ? "not_applicable" : "unknown", why, missing) });
  const invalid = contextIssues(ctx);
  if (invalid.length) return finish("unknown", "The target, task revision, or evidence context is invalid.", invalid);
  const modelMissing = modelIssues(facts, ctx);
  const installationMissing = enumIssues(facts, "installation", ctx);
  const mountingMissing = enumIssues(facts, "mounting", ctx);
  const model = typeof facts.model?.value === "string" ? facts.model.value.trim().toUpperCase() : "";
  if (!modelMissing.length && !Object.hasOwn(modelSpecs, model)) return finish("not_applicable", `The independently confirmed model ${model} is outside TFP171.`);
  if (!modelMissing.length && options.models && !options.models.includes(model as Model)) return finish("not_applicable", "The independently confirmed model is outside this rule's model subset.");
  if (!installationMissing.length && facts.installation.value === "uninstalled") return finish("not_applicable", "This rule checks an installed head; the head is independently confirmed uninstalled.");
  if (options.recessedOnly && !mountingMissing.length && facts.mounting.value === "standard") return finish("not_applicable", "The independently confirmed standard installation does not use the recessed-escutcheon rule.");
  const threadMissing = options.nptOnly ? enumIssues(facts, "threadStandard", ctx) : [];
  if (options.nptOnly && !threadMissing.length && facts.threadStandard!.value !== "npt") return finish("not_applicable", "The independently confirmed thread is not NPT; this NPT-only rule does not apply.");
  if (!modelMissing.length && !mountingMissing.length && facts.mounting.value === "recessed" && !recessedModels.includes(model as Model)) return finish("not_applicable", "This model/recessed combination is not covered by the adopted TFP171 rules; it is not an approval of the combination.");
  const missing = [...modelMissing, ...installationMissing, ...mountingMissing, ...threadMissing];
  if (missing.length) return finish("unknown", "The rule's model and installation applicability are not independently established with current evidence.", missing);
  return { model: model as Model, mounting: facts.mounting.value as "standard" | "recessed" };
}

function evaluate(rule: RuleDefinition, facts: HeadFacts, ctx: RuleContext): RuleResult {
  const gate = applicability(rule, facts, ctx, {
    recessedOnly: rule.id === "TFP171_RECESSED_ESCUTCHEON_V1",
    models: rule.id === "TFP171_RETROFIT_ONLY_V1" ? retrofitModels : undefined,
    nptOnly: ["TFP171_NPT_INSTALLATION_TORQUE_V1", "TFP171_RETROFIT_ONLY_V1", "TFP171_WORKING_PRESSURE_V1"].includes(rule.id),
  });
  if ("outcome" in gate) return gate.outcome;
  const finish = (status: RuleStatus, why: string, missing: string[] = []) => result(rule, facts, ctx, status, "applicable", why, missing);
  const unknown = (missing: string[]) => finish("unknown", "Independent confirmation and current evidence are required for this condition.", missing);
  const condition = (key: "bulbCondition" | "installationWrench" | "escutcheon" | "construction" | "fieldFinish" | "leakage" | "corrosion", allowed: readonly string[], pass: string, fail: string): RuleResult => {
    const missing = enumIssues(facts, key, ctx);
    if (missing.length) return unknown(missing);
    return allowed.includes(facts[key]!.value as string) ? finish("pass", pass) : finish("fail", fail);
  };
  switch (rule.id) {
    case "TFP171_INSTALL_ORIENTATION_V2": {
      const missing = [...enumIssues(facts, "orientation", ctx), ...enumIssues(facts, "verticalReference", ctx)];
      if (missing.length) return unknown(missing);
      const expected = modelSpecs[gate.model].orientation;
      return facts.orientation.value === expected
        ? finish("pass", `The independently established ${expected} orientation matches this model's requirement.`)
        : finish("fail", `The observed ${facts.orientation.value} orientation differs from the required ${expected} orientation.`);
    }
    case "TFP171_RECESSED_ESCUTCHEON_V1":
      return condition("escutcheon", gate.model === "TY4231" ? ["style_30", "style_40"] : ["style_10", "style_20"], "The confirmed escutcheon style matches this model's listed combination; other listing and dimensional conditions remain separate.", "The confirmed escutcheon style is not one of the styles specified for this model.");
    case "TFP171_BULB_CONDITION_V1":
      return condition("bulbCondition", ["intact"], "Independent inspection confirms neither cracking nor liquid loss in the bulb.", "The confirmed cracked bulb or loss of liquid requires replacement; do not treat this head as acceptable.");
    case "TFP171_INSTALLATION_WRENCH_V1":
      return condition("installationWrench", [gate.mounting === "recessed" ? "w_type_7" : "w_type_6"], "The independently confirmed installation record identifies the specified wrench.", "The independently confirmed installation record identifies a wrench other than the specified type.");
    case "TFP171_NPT_INSTALLATION_TORQUE_V1": {
      const missing = numericIssues(facts, "installationTorqueFtLb", ctx);
      if (missing.length) return unknown(missing);
      const [minimum, maximum] = modelSpecs[gate.model].thread === "half" ? [7, 14] : [10, 20];
      const torque = facts.installationTorqueFtLb!.value!;
      return finish(torque >= minimum && torque <= maximum ? "pass" : "fail", `The independently recorded installation torque is ${torque} ft-lb; the manufacturer's NPT range is ${minimum}-${maximum} ft-lb. This does not establish leak tightness.`);
    }
    case "TFP171_RETROFIT_ONLY_V1":
      return condition("construction", ["retrofit"], "The confirmed NPT installation is a retrofit, matching the manufacturer's restriction for this model.", "The confirmed new-construction NPT installation conflicts with the manufacturer's retrofit-only restriction for this model.");
    case "TFP171_FACTORY_FINISH_V1":
      return condition("fieldFinish", ["factory_only"], "Independent verification found no post-factory painting, plating, or coating; other alterations are not evaluated.", "Confirmed post-factory painting, plating, or coating requires replacement.");
    case "TFP171_LEAKAGE_V1":
      return condition("leakage", ["absent"], "Independent inspection confirms absence of sprinkler leakage at the recorded inspection; this is not a pressure test.", "Confirmed sprinkler leakage requires replacement.");
    case "TFP171_VISIBLE_CORROSION_V1":
      return condition("corrosion", ["absent"], "Independent inspection confirms no visible signs of corrosion; internal condition is not evaluated.", "Confirmed visible signs of sprinkler corrosion require replacement.");
    case "TFP171_WORKING_PRESSURE_V1": {
      const missing = [...numericIssues(facts, "workingPressurePsi", ctx), ...enumIssues(facts, "pressureBasis", ctx)];
      if (facts.pressureBasis?.value !== "system_maximum") missing.push("pressureBasis");
      if (missing.length) return unknown(missing);
      const pressure = facts.workingPressurePsi!.value!;
      const conditional250 = gate.model === "TY3131" || gate.model === "TY3231";
      if (pressure <= 175) return finish("pass", "The independently established maximum working pressure is within the 175 psi Table D limit. Listing and hydraulic suitability are not evaluated.");
      if (!conditional250 || pressure > 250) return finish("fail", `The independently established maximum working pressure ${pressure} psi exceeds the model's maximum Table D limit.`);
      const approvalMissing = enumIssues(facts, "approvalBasis", ctx);
      if (approvalMissing.length) return unknown(approvalMissing);
      return facts.approvalBasis!.value === "ul_cul"
        ? finish("pass", "The pressure is within 250 psi and the UL/C-UL listing basis is independently confirmed; other listing conditions are not evaluated.")
        : finish("fail", "The pressure exceeds 175 psi and the confirmed approval basis is not the UL/C-UL listing required for the 250 psi allowance.");
    }
    default: throw new Error("Unknown adopted rule");
  }
}

export function validateRule(ruleId: string, facts: HeadFacts, ctx: RuleContext): RuleResult {
  const rule = ADOPTED_RULES.find(item => item.id === ruleId);
  if (!rule) throw new Error(`Unknown head rule: ${ruleId}`);
  return evaluate(rule, facts, ctx);
}

export function validateRules(facts: HeadFacts, ctx: RuleContext): RuleResult[] {
  return ADOPTED_RULES.map(rule => evaluate(rule, facts, ctx));
}
export function validateHead(facts: HeadFacts, ctx: RuleContext): RuleResult {
  return evaluate(RULE, facts, ctx);
}

export function comparePlan(planOrientation: Orientation, facts: HeadFacts, ctx: RuleContext): PlanComparison {
  const missingInputs = [
    ...contextIssues(ctx),
    ...(!["pendent", "upright", "sideways"].includes(planOrientation) ? ["planOrientation"] : []),
    ...enumIssues(facts, "orientation", ctx),
    ...enumIssues(facts, "verticalReference", ctx),
  ];
  const status = missingInputs.length ? "unknown" : planOrientation === facts.orientation.value ? "match" : "different";
  return {
    status, targetId: ctx.targetId, planned: planOrientation, observed: facts.orientation?.value ?? null,
    reason: status === "unknown" ? "The planned or independently observed orientation is not established."
      : status === "match" ? "The observed orientation matches the plan; this comparison is not a manufacturer-compliance check."
        : "The observed orientation differs from the plan; this comparison is separate from manufacturer compliance.",
    missingInputs: [...new Set(missingInputs)], taskRevision: ctx.taskRevision,
  };
}
