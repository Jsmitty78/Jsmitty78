import type { Fact, RuleContext } from "../types.js";
import type { ProjectEvaluationRequest, ProjectRuleResult, ProjectSupport, ProjectSupportFacts } from "../project-contract.js";
import { projectFactIssues, projectRule, projectContext, sf2025RuleScope, sfSourceReference } from "./sf-common.js";

const studRule = {
  id: "SFFD_AB415_POWDER_DRIVEN_STUDS_I2_I3_V1",
  title: "Powder-driven studs for sprinkler pipe hangers and sway bracing",
  scope: "SFFD AB 4.15 I.2-I.3 only; checks new versus existing powder-driven studs for hangers/sway bracing and the stated existing-installation conditions.",
  clause: "I.2-I.3",
  source: sfSourceReference("SFFD AB 4.15", 1, "I.2-I.3", "New powder-driven studs are not permitted; existing studs may remain only when the pipe has not been moved/altered and the hanger holds properly."),
} as const;

const concreteRule = {
  id: "SFFD_AB415_CRACKED_CONCRETE_FASTENERS_I4_V1",
  title: "Cracked-concrete qualification for concrete hanger and sway-brace fasteners",
  scope: "SFFD AB 4.15 I.4 only; checks that concrete fasteners used for hangers/sway bracing are certified or prequalified for cracked concrete.",
  clause: "I.4",
  source: sfSourceReference("SFFD AB 4.15", 1, "I.4", "All concrete fasteners for hangers or sway bracing must be certified or prequalified for cracked concrete."),
} as const;

type Done = (
  status: ProjectRuleResult["status"],
  applicability: ProjectRuleResult["applicability"],
  reason: string,
  missing?: readonly string[],
  evidence?: readonly string[],
) => ProjectRuleResult;

function supportContext(request: ProjectEvaluationRequest, supportId: string): RuleContext {
  return {
    targetId: supportId,
    taskRevision: request.project.revision,
    observations: (request.evidence ?? [])
      .filter(record => record.projectId === request.project.id && record.subjectIds.includes(supportId))
      .map(record => ({ id: record.id, targetId: supportId, ...(record.superseded ? { superseded: true } : {}), ...(record.invalidated ? { invalidated: true } : {}) })),
  };
}

function issues<T>(
  fact: Fact<T> | undefined,
  request: ProjectEvaluationRequest,
  context: RuleContext,
  path: string,
  kinds: readonly ("photo" | "permit" | "drawing" | "installation" | "calculation" | "inspection")[],
): string[] {
  return projectFactIssues({ fact, request, context, path, kinds });
}

function value<T>(fact: Fact<T> | undefined): T | undefined {
  return fact?.value == null ? undefined : fact.value;
}

function evaluateOne(
  request: ProjectEvaluationRequest,
  support: ProjectSupport,
  rule: typeof studRule | typeof concreteRule,
): ProjectRuleResult {
  const projectCtx = projectContext(request);
  const scope = sf2025RuleScope(request, projectCtx);
  const ctx = supportContext(request, support.id);
  const facts: ProjectSupportFacts = support.facts ?? {};

  const done = (
    status: ProjectRuleResult["status"],
    applicability: ProjectRuleResult["applicability"],
    reason: string,
    missing: readonly string[] = [],
    evidence: readonly string[] = [],
  ) => projectRule(rule, "sf-supports-2025", ctx, status, applicability, reason, missing, [
    ...(facts.use?.evidenceIds ?? []), ...evidence,
  ]);

  if (scope.applicability !== "applicable") {
    const status = scope.applicability === "not_applicable" ? "not_applicable" : "unknown";
    return done(status, scope.applicability, scope.reason, scope.missingInputs);
  }

  const use = facts.use;
  const useIssues = issues(use, request, ctx, "use", ["permit", "drawing"]);
  if (useIssues.length) return done("unknown", "unknown", "Whether this support is a hanger, sway brace, or another use is not established by current permit/drawing evidence.", useIssues, use?.evidenceIds);
  if (value(use) === "other") return done("not_applicable", "not_applicable", "This support is not a hanger or sway brace, so these AB 4.15 checks do not apply.", [], use!.evidenceIds);

  if (rule === studRule) return evaluateStudRule(request, support, ctx, done);
  return evaluateConcreteRule(request, support, ctx, done);
}

function evaluateStudRule(
  request: ProjectEvaluationRequest,
  support: ProjectSupport,
  context: RuleContext,
  done: Done,
): ProjectRuleResult {
  const facts = support.facts ?? {};
  const fastenerIssues = issues(facts.fastenerType, request, context, "fastenerType", ["permit", "drawing", "installation"]);
  if (fastenerIssues.length) return done("unknown", "unknown", "Fastener type is not established by current installation or design evidence.", fastenerIssues, facts.fastenerType?.evidenceIds);
  if (value(facts.fastenerType) === "other") return done("not_applicable", "not_applicable", "The support does not use a powder-driven stud; this bounded I.2-I.3 check does not apply.", [], facts.fastenerType!.evidenceIds);

  const stateIssues = issues(facts.installationState, request, context, "installationState", ["permit", "installation"]);
  if (stateIssues.length) return done("unknown", "applicable", "The powder-driven stud's new or existing installation state is not established.", stateIssues, facts.fastenerType!.evidenceIds);
  if (value(facts.installationState) === "new") return done("fail", "applicable", "AB 4.15 I.3 does not permit new powder-driven studs for sprinkler pipe hangers or sway bracing.", [], [...facts.fastenerType!.evidenceIds, ...facts.installationState!.evidenceIds]);

  const movedIssues = issues(facts.pipeMovedOrAltered, request, context, "pipeMovedOrAltered", ["permit", "installation", "inspection"]);
  const holdingIssues = issues(facts.hangerHoldsProperly, request, context, "hangerHoldsProperly", ["inspection"]);
  const moved = value(facts.pipeMovedOrAltered);
  const holding = value(facts.hangerHoldsProperly);
  if (!movedIssues.length && moved === "yes") return done("fail", "applicable", "AB 4.15 I.2 allows an existing powder-driven stud to remain only when the pipe has not been moved or altered.", [], [...facts.fastenerType!.evidenceIds, ...facts.installationState!.evidenceIds, ...facts.pipeMovedOrAltered!.evidenceIds]);
  if (!holdingIssues.length && holding === "no") return done("fail", "applicable", "AB 4.15 I.2 allows an existing powder-driven stud to remain only when the hanger holds properly.", [], [...facts.fastenerType!.evidenceIds, ...facts.installationState!.evidenceIds, ...facts.hangerHoldsProperly!.evidenceIds]);
  const missing = [...movedIssues, ...holdingIssues];
  if (missing.length) return done("unknown", "applicable", "The existing stud can be evaluated only after current evidence confirms the pipe was not moved/altered and the hanger holds properly.", missing, [
    ...facts.fastenerType!.evidenceIds,
    ...facts.installationState!.evidenceIds,
    ...(facts.pipeMovedOrAltered?.evidenceIds ?? []),
    ...(facts.hangerHoldsProperly?.evidenceIds ?? []),
  ]);
  return done("pass", "applicable", "Current evidence confirms an existing powder-driven stud, an unaltered pipe, and a hanger that holds properly; AB 4.15 I.2 permits it to remain under these conditions.", [], [...facts.fastenerType!.evidenceIds, ...facts.installationState!.evidenceIds, ...facts.pipeMovedOrAltered!.evidenceIds, ...facts.hangerHoldsProperly!.evidenceIds]);
}

function evaluateConcreteRule(
  request: ProjectEvaluationRequest,
  support: ProjectSupport,
  context: RuleContext,
  done: Done,
): ProjectRuleResult {
  const facts = support.facts ?? {};
  const substrateIssues = issues(facts.substrate, request, context, "substrate", ["permit", "drawing", "inspection"]);
  if (substrateIssues.length) return done("unknown", "unknown", "The support substrate is not established by current permit/design evidence.", substrateIssues, facts.substrate?.evidenceIds);
  if (value(facts.substrate) === "other") return done("not_applicable", "not_applicable", "The support is not anchored to concrete; AB 4.15 I.4 does not apply.", [], facts.substrate!.evidenceIds);

  const qualificationIssues = issues(facts.crackedConcreteQualification, request, context, "crackedConcreteQualification", ["permit", "drawing"]);
  if (qualificationIssues.length) return done("unknown", "applicable", "The concrete fastener's cracked-concrete certification or prequalification is not documented.", qualificationIssues, facts.crackedConcreteQualification?.evidenceIds);
  const qualification = value(facts.crackedConcreteQualification);
  return qualification === "neither"
    ? done("fail", "applicable", "AB 4.15 I.4 requires concrete fasteners for hangers or sway bracing to be certified or prequalified for cracked concrete.", [], [...facts.substrate!.evidenceIds, ...facts.crackedConcreteQualification!.evidenceIds])
    : done("pass", "applicable", "The current design record identifies the concrete fastener as certified or prequalified for cracked concrete, as AB 4.15 I.4 requires.", [], [...facts.substrate!.evidenceIds, ...facts.crackedConcreteQualification!.evidenceIds]);
}

export function evaluateSfSupports2025(request: ProjectEvaluationRequest): ProjectRuleResult[] {
  return (request.supports ?? []).flatMap(support => [evaluateOne(request, support, studRule), evaluateOne(request, support, concreteRule)]);
}

export function evaluateSfSupportRule(request: ProjectEvaluationRequest, ruleId: string): ProjectRuleResult[] {
  const rule = [studRule, concreteRule].find(item => item.id === ruleId);
  if (!rule) throw new Error(`Unknown support rule: ${ruleId}`);
  return (request.supports ?? []).map(support => evaluateOne(request, support, rule));
}
