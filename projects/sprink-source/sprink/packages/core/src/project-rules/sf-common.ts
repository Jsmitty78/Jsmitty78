import { contextIssues, factIssues } from "../evidence.js";
import { resolveSfNfpa13Edition, type SfProjectFacts } from "../sf-project-basis.js";
import type { Fact, RuleContext } from "../types.js";
import type { ProjectEvaluationRequest, ProjectEvidence, ProjectRulePackId, ProjectRuleResult, ProjectSourceReference } from "../project-contract.js";

const AB204_URL = "https://sf-fire.org/media/4169";
const AB415_URL = "https://sf-fire.org/media/3979";

export function sfSourceReference(documentId: "SFFD AB 2.04" | "SFFD AB 4.15", page: number, clause: string, purpose: string): ProjectSourceReference {
  const is204 = documentId === "SFFD AB 2.04";
  return {
    document: is204 ? "SFFD Administrative Bulletin 2.04, Fire Sprinkler Submittals" : "SFFD Administrative Bulletin 4.15, Attachments and Anchors Acceptable for Hanging and Sway Bracing of Sprinkler Pipe",
    documentId,
    revision: "2025",
    page,
    url: is204 ? AB204_URL : AB415_URL,
    purpose,
    clauses: [clause],
  };
}

export function projectRule(
  rule: { id: string; title: string; scope: string; clause: string; source: ProjectSourceReference; sources?: readonly ProjectSourceReference[] },
  packId: ProjectRulePackId,
  context: RuleContext,
  status: ProjectRuleResult["status"],
  applicability: ProjectRuleResult["applicability"],
  reason: string,
  missingInputs: readonly string[] = [],
  evidenceIds: readonly string[] = [],
): ProjectRuleResult {
  return {
    ruleId: rule.id,
    title: rule.title,
    scope: rule.scope,
    targetId: context.targetId,
    subjectIds: [context.targetId],
    packId,
    requirementLevel: "requirement",
    status,
    applicability,
    reason,
    missingInputs: [...new Set(missingInputs)],
    evidenceIds: [...new Set(evidenceIds)],
    sourceRefs: rule.sources ?? [rule.source],
    versions: { taskRevision: context.taskRevision, ruleVersion: "1", sourceRevision: "2025" },
  };
}

export function projectFactIssues<T>(input: {
  fact: Fact<T> | undefined;
  request: ProjectEvaluationRequest;
  context: RuleContext;
  path: string;
  kinds: readonly ProjectEvidence["kind"][];
}): string[] {
  const { fact, request, context, path, kinds } = input;
  const issues = factIssues(fact, context, path);
  if (!fact || fact.value == null) return [...new Set(issues)];
  const records = fact.evidenceIds.map(id => {
    const matches = (request.evidence ?? []).filter(record => record.id === id);
    if (matches.length !== 1) {
      issues.push(`${path}.evidenceIds:${id}`);
      return undefined;
    }
    const record = matches[0]!;
    if (record.projectId !== request.project.id || !record.subjectIds.includes(context.targetId) || record.superseded || record.invalidated) {
      issues.push(`${path}.evidenceIds:${id}`);
    }
    return record;
  }).filter((record): record is ProjectEvidence => !!record);
  if (!records.some(record => kinds.includes(record.kind))) issues.push(`${path}.evidenceKinds:${kinds.join("|")}`);
  return [...new Set(issues)];
}

function sfFacts(request: ProjectEvaluationRequest): SfProjectFacts {
  const input = request.facts?.sfNfpa13 ?? {};
  const unknown = <T>(): Fact<T> => ({ value: null, confirmed: false, evidenceIds: [], source: "manual" });
  return {
    jurisdiction: input.jurisdiction ?? unknown(),
    standard: input.standard ?? unknown(),
    permitKind: input.permitKind ?? unknown(),
    ...(input.sitePermitCodeCycle ? { sitePermitCodeCycle: input.sitePermitCodeCycle } : {}),
    ...(input.architecturalPermitCodeCycle ? { architecturalPermitCodeCycle: input.architecturalPermitCodeCycle } : {}),
    ...(input.editionElection ? { editionElection: input.editionElection } : {}),
    ...(input.ownerRequestedEdition ? { ownerRequestedEdition: input.ownerRequestedEdition } : {}),
    ...(input.originalFirePermitNumber ? { originalFirePermitNumber: input.originalFirePermitNumber } : {}),
    ...(input.originalNfpa13Edition ? { originalNfpa13Edition: input.originalNfpa13Edition } : {}),
  };
}

export interface SfRuleScope {
  applicability: ProjectRuleResult["applicability"];
  missingInputs: string[];
  reason: string;
}

/** These packs are pinned to the 2025 SFFD bulletins and the bounded supported project scope. */
export function sf2025RuleScope(request: ProjectEvaluationRequest, context: RuleContext): SfRuleScope {
  const invalidContext = contextIssues(context);
  if (invalidContext.length) return { applicability: "unknown", missingInputs: invalidContext, reason: "The project target or evidence context is invalid." };
  const requiredScopeFacts = [
    ["systemType", request.facts?.systemType, "wet"],
    ["sprinklerType", request.facts?.sprinklerType, "standard_spray"],
    ["storage", request.facts?.storage, "non_storage"],
  ] as const;
  const factIssuesByField = requiredScopeFacts.map(([field, fact, expected]) => ({
    field, fact, expected,
    issues: projectFactIssues({ fact, request, context, path: field, kinds: ["permit"] }),
  }));
  const outOfScope = factIssuesByField.find(item => !item.issues.length && item.fact!.value !== item.expected);
  if (outOfScope) return {
    applicability: "not_applicable", missingInputs: [],
    reason: `The confirmed ${outOfScope.field} is outside this bounded wet, standard-spray, non-storage rule scope.`,
  };
  const scopeIssues = factIssuesByField.flatMap(item => item.issues);
  if (scopeIssues.length) return {
    applicability: "unknown", missingInputs: scopeIssues,
    reason: "Wet-system, standard-spray, non-storage project scope must be independently established by current permit evidence.",
  };
  const jurisdiction = request.facts?.sfNfpa13?.jurisdiction;
  const jurisdictionIssues = projectFactIssues({ fact: jurisdiction, request, context, path: "sfNfpa13.jurisdiction", kinds: ["permit"] });
  if (!jurisdictionIssues.length && jurisdiction!.value === "other") {
    return { applicability: "not_applicable", missingInputs: [], reason: "The independently confirmed jurisdiction is outside San Francisco." };
  }
  const basis = resolveSfNfpa13Edition(sfFacts(request), context);
  if (basis.status !== "resolved") {
    return { applicability: "unknown", missingInputs: [...new Set([...jurisdictionIssues, ...basis.missingInputs])], reason: "The San Francisco jurisdiction and adopted permit basis are not independently established." };
  }
  const sfPermitFacts = Object.entries(request.facts?.sfNfpa13 ?? {}).filter(([, fact]) => fact?.value != null) as [string, Fact<unknown>][];
  const invalidPermitKinds = sfPermitFacts.flatMap(([field, fact]) => projectFactIssues({
    fact, request, context, path: `sfNfpa13.${field}`, kinds: ["permit"],
  }));
  if (invalidPermitKinds.length) return { applicability: "unknown", missingInputs: invalidPermitKinds, reason: "The SF edition basis does not have current project permit evidence." };
  if (basis.nfpa13Edition !== "2025") {
    return { applicability: "unknown", missingInputs: ["sfNfpa13.2025EditionBasis"], reason: "These executable SFFD rules are pinned to the 2025 bulletins; the resolved project basis is not NFPA 13-2025." };
  }
  return { applicability: "applicable", missingInputs: [], reason: "The confirmed San Francisco NFPA 13-2025 project scope matches these bounded SFFD checks." };
}

export function projectContext(request: ProjectEvaluationRequest): RuleContext {
  const observations = (request.evidence ?? [])
    .filter(record => record.projectId === request.project.id && record.subjectIds.includes(request.project.id))
    .map(record => ({ id: record.id, targetId: request.project.id, ...(record.superseded ? { superseded: true } : {}), ...(record.invalidated ? { invalidated: true } : {}) }));
  return { targetId: request.project.id, taskRevision: request.project.revision, observations };
}
