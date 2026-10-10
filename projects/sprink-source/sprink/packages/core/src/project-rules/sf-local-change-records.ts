import { contextIssues, factIssues } from "../evidence.js";
import type { Fact, RuleContext } from "../types.js";
import type { DocumentRevisionRef, ProjectEvidence, ProjectRuleResult } from "../project-contract.js";
import type { ProjectLocalChangeInput } from "../local-change-contract.js";
import { projectRule, sfSourceReference } from "./sf-common.js";

const packId = "sf-local-change-2025" as const;
const rules = {
  reuse: {
    id: "SFFD_AB204_NO_REINSTALL_REMOVED_OR_WELDED_SPRINKLER_I14D_V1",
    title: "Do not reinstall a threaded sprinkler removed from a fitting or welded",
    scope: "SFFD AB 2.04 I.14(D) only; checks proposed reuse of a sprinkler whose threaded connection and removal/welding history are independently established.",
    clause: "I.14(D)",
    source: sfSourceReference("SFFD AB 2.04", 4, "I.14(D)", "A threaded sprinkler removed from a fitting or welded is not to be reinstalled."),
  },
  excessPipe: {
    id: "SFFD_AB204_REMOVE_UNUSED_EXCESS_PIPE_I14A_V1",
    title: "Remove unused excess piping in a modification",
    scope: "SFFD AB 2.04 I.14(A) only; checks explicitly listed excess pipe against independently evidenced as-built removal. Candidate-plan omission does not establish field removal.",
    clause: "I.14(A)",
    source: sfSourceReference("SFFD AB 2.04", 4, "I.14(A)", "A modification includes removing unused excess piping."),
  },
  existingRiser: {
    id: "SFFD_AB204_EXISTING_CONFIGURATION_RISER_FOR_ADDITIONS_I15_V1",
    title: "Show existing configuration and riser connection for additions",
    scope: "SFFD AB 2.04 I.15 only; applies when sprinklers or piping are added to a confirmed existing system and checks the current proposed drawing for existing configuration and riser connection.",
    clause: "I.15",
    source: sfSourceReference("SFFD AB 2.04", 4, "I.15", "Plans for additions to existing systems include associated existing configuration and connection to the existing riser."),
  },
} as const;

type ReadFact<T> = { value?: T; issues: string[]; evidenceIds: string[]; records: ProjectEvidence[] };

function contextFor(projectId: string, taskRevision: number, targetId: string, evidence: readonly ProjectEvidence[]): RuleContext {
  return {
    targetId,
    taskRevision,
    observations: evidence
      .filter(record => record.projectId === projectId && record.subjectIds.includes(targetId))
      .map(record => ({
        id: record.id,
        targetId,
        ...(record.superseded ? { superseded: true } : {}),
        ...(record.invalidated ? { invalidated: true } : {}),
      })),
  };
}

function sameRevision(left: DocumentRevisionRef, right: DocumentRevisionRef): boolean {
  return left.documentId === right.documentId && left.revision === right.revision &&
    (left.edition === undefined || right.edition === undefined || left.edition === right.edition);
}

function readFact<T>(input: {
  fact: Fact<T> | undefined;
  path: string;
  projectId: string;
  taskRevision: number;
  targetId: string;
  evidence: readonly ProjectEvidence[];
  kinds: readonly ProjectEvidence["kind"][];
  expectedRevision?: DocumentRevisionRef;
  requiredSubjects?: readonly string[];
}): ReadFact<T> {
  const { fact, path, projectId, taskRevision, targetId, evidence, kinds, expectedRevision, requiredSubjects = [] } = input;
  const context = contextFor(projectId, taskRevision, targetId, evidence);
  const issues = [...contextIssues(context), ...factIssues(fact, context, path)];
  const ids = fact?.evidenceIds ?? [];
  if (new Set(ids).size !== ids.length) issues.push(`${path}.evidenceIds.duplicate`);
  const records: ProjectEvidence[] = [];

  for (const id of ids) {
    const matches = evidence.filter(record => record.id === id);
    if (matches.length !== 1) {
      issues.push(`${path}.evidenceIds:${id}`);
      continue;
    }
    const record = matches[0]!;
    records.push(record);
    if (record.projectId !== projectId || !record.subjectIds.includes(targetId) || record.superseded || record.invalidated) {
      issues.push(`${path}.evidenceIds:${id}.scope`);
    }
    if (record.kind !== "photo" && !record.documentRevision) issues.push(`${path}.evidenceIds:${id}.documentRevision`);
    if (!kinds.includes(record.kind)) issues.push(`${path}.evidenceIds:${id}.kind`);
    if (expectedRevision && (!record.documentRevision || !sameRevision(record.documentRevision, expectedRevision))) {
      issues.push(`${path}.evidenceIds:${id}.revision`);
    }
    if (requiredSubjects.some(subjectId => !record.subjectIds.includes(subjectId))) {
      issues.push(`${path}.evidenceIds:${id}.subjectIds`);
    }
  }

  if (fact && ids.length > 0 && !records.some(record => kinds.includes(record.kind))) {
    issues.push(`${path}.evidenceKinds:${kinds.join("|")}`);
  }
  const uniqueIssues = [...new Set(issues)];
  return {
    ...(uniqueIssues.length === 0 && fact?.value != null ? { value: fact.value } : {}),
    issues: uniqueIssues,
    evidenceIds: [...ids],
    records,
  };
}

function result(input: {
  rule: typeof rules.reuse | typeof rules.excessPipe | typeof rules.existingRiser;
  projectId: string;
  taskRevision: number;
  targetId: string;
  subjectIds: readonly string[];
  status: ProjectRuleResult["status"];
  applicability: ProjectRuleResult["applicability"];
  reason: string;
  missing?: readonly string[];
  evidenceIds?: readonly string[];
  verificationState: NonNullable<ProjectRuleResult["verificationState"]>;
}): ProjectRuleResult {
  const context: RuleContext = { targetId: input.targetId, taskRevision: input.taskRevision, observations: [] };
  const base = projectRule(input.rule, packId, context, input.status, input.applicability, input.reason, input.missing, input.evidenceIds);
  return {
    ...base,
    subjectIds: [...new Set(input.subjectIds)],
    sourceRefs: [input.rule.source],
    verificationState: input.verificationState,
  };
}

function drawingRevision(input: ProjectLocalChangeInput, projectId: string, taskRevision: number, evidence: readonly ProjectEvidence[]): ReadFact<DocumentRevisionRef> {
  const drawing = input.proposed.sourceDrawing;
  const expectedRevision = drawing?.value && typeof drawing.value === "object" ? drawing.value : undefined;
  return readFact({
    fact: drawing,
    path: "proposed.sourceDrawing",
    projectId,
    taskRevision,
    targetId: input.proposed.id,
    evidence,
    kinds: ["drawing"],
    ...(expectedRevision ? { expectedRevision } : {}),
  });
}

function evaluateThreadedReuse(input: {
  input: ProjectLocalChangeInput;
  projectId: string;
  taskRevision: number;
  evidence: readonly ProjectEvidence[];
  sourceDrawing: ReadFact<DocumentRevisionRef>;
}): ProjectRuleResult[] {
  const { input: localChange, projectId, taskRevision, evidence, sourceDrawing } = input;
  const actions = localChange.changeRequest.headRemovalActions ?? [];
  if (actions.length === 0) return [];

  return actions.map((action, index) => {
    const path = `changeRequest.headRemovalActions[${index}]`;
    const targetId = action.headId;
    const matchingHeads = localChange.proposed.heads.filter(head => head.headId === targetId);
    const duplicates = actions.filter(candidate => candidate.headId === targetId).length > 1 || matchingHeads.length > 1;
    const head = matchingHeads.length === 1 ? matchingHeads[0] : undefined;
    const reuse = readFact({
      fact: action.proposedReuse,
      path: `${path}.proposedReuse`,
      projectId,
      taskRevision,
      targetId,
      evidence,
      kinds: ["drawing"],
      ...(sourceDrawing.value ? { expectedRevision: sourceDrawing.value } : {}),
    });
    const removed = readFact({
      fact: action.removedFromFitting,
      path: `${path}.removedFromFitting`,
      projectId,
      taskRevision,
      targetId,
      evidence,
      kinds: ["installation"],
    });
    const welded = readFact({
      fact: action.wasWelded,
      path: `${path}.wasWelded`,
      projectId,
      taskRevision,
      targetId,
      evidence,
      kinds: ["installation"],
    });
    const factEvidence = [...reuse.evidenceIds, ...removed.evidenceIds, ...welded.evidenceIds];
    const subjects = [projectId, localChange.id, localChange.changeRequest.id, targetId];

    if (duplicates) return result({
      rule: rules.reuse, projectId, taskRevision, targetId, subjectIds: subjects,
      status: "unknown", applicability: "unknown",
      reason: "The head identity is duplicated, so its threaded connection and reuse history cannot be matched.",
      missing: [`${path}.headId.duplicate`], evidenceIds: factEvidence,
      verificationState: "input_missing",
    });

    if (sourceDrawing.issues.length || !sourceDrawing.value) return result({
      rule: rules.reuse, projectId, taskRevision, targetId, subjectIds: subjects,
      status: "unknown", applicability: "unknown",
      reason: "The candidate drawing revision is not independently established, so the proposed reuse fact cannot be tied to the current change.",
      missing: sourceDrawing.issues.length ? sourceDrawing.issues : ["proposed.sourceDrawing"], evidenceIds: factEvidence,
      verificationState: "input_missing",
    });

    if (reuse.issues.length || !reuse.value) return result({
      rule: rules.reuse, projectId, taskRevision, targetId, subjectIds: subjects,
      status: "unknown", applicability: "unknown",
      reason: "Whether this threaded sprinkler is proposed for reuse is not established by the current proposed drawing revision.",
      missing: reuse.issues.length ? reuse.issues : [`${path}.proposedReuse`], evidenceIds: factEvidence,
      verificationState: "input_missing",
    });

    if (reuse.value === "no") return result({
      rule: rules.reuse, projectId, taskRevision, targetId, subjectIds: subjects,
      status: "not_applicable", applicability: "not_applicable",
      reason: "The current proposed drawing confirms this threaded sprinkler is not being reused; I.14(D)'s reinstallation condition is not triggered.",
      evidenceIds: factEvidence, verificationState: "verified",
    });

    const thread = readFact({
      fact: head?.threadStandard,
      path: `proposed.heads.${targetId}.threadStandard`,
      projectId,
      taskRevision,
      targetId,
      evidence,
      kinds: ["drawing"],
      expectedRevision: sourceDrawing.value,
    });
    factEvidence.push(...thread.evidenceIds);
    if (!head || thread.issues.length || !["npt", "iso7_1"].includes(String(thread.value))) return result({
      rule: rules.reuse, projectId, taskRevision, targetId, subjectIds: subjects,
      status: "unknown", applicability: "unknown",
      reason: "I.14(D) is scoped to threaded sprinklers; the proposed head's NPT or ISO 7-1 connection is not established on the current proposed drawing revision.",
      missing: [...(!head ? [`${path}.headId`] : []), ...thread.issues, ...(thread.value === "other" ? [`proposed.heads.${targetId}.threadStandard.supportedThread`] : [])],
      evidenceIds: factEvidence,
      verificationState: !head || thread.issues.length ? "input_missing" : "unsupported",
    });

    const removedYes = removed.value === "yes" && removed.issues.length === 0;
    const weldedYes = welded.value === "yes" && welded.issues.length === 0;
    if (removedYes || weldedYes) return result({
      rule: rules.reuse, projectId, taskRevision, targetId, subjectIds: subjects,
      status: "fail", applicability: "applicable",
      reason: `The proposed drawing reuses this threaded sprinkler, and current installation history confirms it was ${removedYes ? "removed from a fitting" : "welded"}; AB 2.04 I.14(D) prohibits reinstalling it.`,
      evidenceIds: factEvidence, verificationState: "verified",
    });

    const historyIssues = [...removed.issues, ...welded.issues];
    if (historyIssues.length || removed.value !== "no" || welded.value !== "no") return result({
      rule: rules.reuse, projectId, taskRevision, targetId, subjectIds: subjects,
      status: "unknown", applicability: "applicable",
      reason: "A proposed reuse is eligible under this bounded check only when current installation evidence confirms both that the sprinkler was not removed from a fitting and was not welded.",
      missing: historyIssues.length ? historyIssues : [`${path}.removedFromFitting`, `${path}.wasWelded`],
      evidenceIds: factEvidence, verificationState: "input_missing",
    });
    return result({
      rule: rules.reuse, projectId, taskRevision, targetId, subjectIds: subjects,
      status: "pass", applicability: "applicable",
      reason: "Current installation history confirms the proposed threaded sprinkler was neither removed from a fitting nor welded; this resolves only AB 2.04 I.14(D).",
      evidenceIds: factEvidence, verificationState: "verified",
    });
  });
}

function evaluateExcessPipe(input: {
  input: ProjectLocalChangeInput;
  projectId: string;
  taskRevision: number;
  evidence: readonly ProjectEvidence[];
  sourceDrawing: ReadFact<DocumentRevisionRef>;
}): ProjectRuleResult[] {
  const { input: localChange, projectId, taskRevision, evidence, sourceDrawing } = input;
  const planFact = readFact({
    fact: localChange.changeRequest.plannedExcessPipeSegmentIds,
    path: "changeRequest.plannedExcessPipeSegmentIds",
    projectId,
    taskRevision,
    targetId: localChange.changeRequest.id,
    evidence,
    kinds: ["drawing"],
    ...(sourceDrawing.value ? { expectedRevision: sourceDrawing.value } : {}),
    requiredSubjects: Array.isArray(localChange.changeRequest.plannedExcessPipeSegmentIds?.value)
      ? localChange.changeRequest.plannedExcessPipeSegmentIds.value
      : [],
  });
  const segments = planFact.value;
  const baseSubjects = [projectId, localChange.id, localChange.changeRequest.id];
  if (sourceDrawing.issues.length || !sourceDrawing.value || planFact.issues.length || !segments) return [result({
    rule: rules.excessPipe, projectId, taskRevision,
    targetId: localChange.changeRequest.id, subjectIds: baseSubjects,
    status: "unknown", applicability: "unknown",
    reason: "The current proposed drawing revision and its explicit list of unused excess pipe require independent confirmation; omission alone is not field-removal evidence.",
    missing: [
      ...(sourceDrawing.issues.length ? sourceDrawing.issues : !sourceDrawing.value ? ["proposed.sourceDrawing"] : []),
      ...(planFact.issues.length ? planFact.issues : ["changeRequest.plannedExcessPipeSegmentIds"]),
    ],
    evidenceIds: [...sourceDrawing.evidenceIds, ...planFact.evidenceIds],
    verificationState: "input_missing",
  })];

  if (segments.length === 0) return [];

  const uniqueSegments = [...new Set(segments)];
  if (uniqueSegments.length !== segments.length || uniqueSegments.some(id => typeof id !== "string" || !id.trim())) return [result({
    rule: rules.excessPipe, projectId, taskRevision,
    targetId: localChange.changeRequest.id, subjectIds: baseSubjects,
    status: "unknown", applicability: "unknown",
    reason: "The proposed drawing's excess-pipe segment list contains duplicate or invalid identifiers.",
    missing: ["changeRequest.plannedExcessPipeSegmentIds.segmentIds"],
    evidenceIds: [...sourceDrawing.evidenceIds, ...planFact.evidenceIds],
    verificationState: "input_missing",
  })];

  const knownSegments = new Set([...localChange.baseline.segments, ...localChange.proposed.segments].map(segment => segment.id));
  if (uniqueSegments.some(id => !knownSegments.has(id))) return uniqueSegments.map(segmentId => result({
    rule: rules.excessPipe, projectId, taskRevision,
    targetId: segmentId, subjectIds: [...baseSubjects, segmentId],
    status: "unknown", applicability: "unknown",
    reason: "An explicitly listed excess-pipe identifier is not present in the baseline or proposed segment model, so the removal subject cannot be matched.",
    missing: [`changeRequest.plannedExcessPipeSegmentIds.${segmentId}.segmentReference`],
    evidenceIds: [...sourceDrawing.evidenceIds, ...planFact.evidenceIds],
    verificationState: "input_missing",
  }));

  const fieldStatus = readFact({
    fact: localChange.changeRequest.fieldExcessPipeRemovalStatus,
    path: "changeRequest.fieldExcessPipeRemovalStatus",
    projectId,
    taskRevision,
    targetId: localChange.changeRequest.id,
    evidence,
    kinds: ["installation"],
    requiredSubjects: uniqueSegments,
  });
  return uniqueSegments.map(segmentId => {
    const subjectIds = [...baseSubjects, segmentId];
    const evidenceIds = [...sourceDrawing.evidenceIds, ...planFact.evidenceIds, ...fieldStatus.evidenceIds];
    if (fieldStatus.issues.length || !fieldStatus.value) return result({
      rule: rules.excessPipe, projectId, taskRevision,
      targetId: segmentId, subjectIds,
      status: "unknown", applicability: "applicable",
      reason: "The current drawing identifies this unused excess-pipe segment, but only current installation evidence can confirm whether it was removed.",
      missing: fieldStatus.issues.length ? fieldStatus.issues : ["changeRequest.fieldExcessPipeRemovalStatus"],
      evidenceIds, verificationState: "input_missing",
    });
    if (fieldStatus.value === "not_removed") return result({
      rule: rules.excessPipe, projectId, taskRevision,
      targetId: segmentId, subjectIds,
      status: "fail", applicability: "applicable",
      reason: "Current installation evidence confirms the explicitly listed unused excess-pipe segment remains in place; AB 2.04 I.14(A) includes its removal in a modification.",
      evidenceIds, verificationState: "verified",
    });
    return result({
      rule: rules.excessPipe, projectId, taskRevision,
      targetId: segmentId, subjectIds,
      status: "pass", applicability: "applicable",
      reason: "Current installation evidence confirms removal of this explicitly listed unused excess-pipe segment; this resolves only AB 2.04 I.14(A).",
      evidenceIds, verificationState: "verified",
    });
  });
}

function evaluateExistingRiser(input: {
  input: ProjectLocalChangeInput;
  projectId: string;
  taskRevision: number;
  evidence: readonly ProjectEvidence[];
  sourceDrawing: ReadFact<DocumentRevisionRef>;
}): ProjectRuleResult {
  const { input: localChange, projectId, taskRevision, evidence, sourceDrawing } = input;
  const requestFacts = localChange.changeRequest;
  const subjects = [projectId, localChange.id, requestFacts.id];
  const targetId = requestFacts.id;
  const workType = readFact({
    fact: requestFacts.systemWorkType,
    path: "changeRequest.systemWorkType",
    projectId,
    taskRevision,
    targetId,
    evidence,
    kinds: ["permit", "drawing"],
  });
  const existing = readFact({
    fact: requestFacts.existingSystem,
    path: "changeRequest.existingSystem",
    projectId,
    taskRevision,
    targetId,
    evidence,
    kinds: ["permit", "drawing"],
  });
  const adds = readFact({
    fact: requestFacts.addsSprinklersOrPiping,
    path: "changeRequest.addsSprinklersOrPiping",
    projectId,
    taskRevision,
    targetId,
    evidence,
    kinds: ["permit", "drawing"],
  });
  const baseEvidence = [...workType.evidenceIds, ...existing.evidenceIds, ...adds.evidenceIds];

  if (workType.issues.length || !workType.value) return result({
    rule: rules.existingRiser, projectId, taskRevision, targetId, subjectIds: subjects,
    status: "unknown", applicability: "unknown",
    reason: "Whether this work is a new system or an existing-system modification is not independently established by current permit or drawing evidence.",
    missing: workType.issues.length ? workType.issues : ["changeRequest.systemWorkType"],
    evidenceIds: baseEvidence, verificationState: "input_missing",
  });

  if (workType.value === "new_system") return result({
    rule: rules.existingRiser, projectId, taskRevision, targetId, subjectIds: subjects,
    status: "unknown", applicability: "unknown",
    reason: "This bounded I.15 rule covers additions to existing systems; new-system submittal requirements are outside this check and must not be treated as a no-trigger pass.",
    missing: ["changeRequest.systemWorkType.existingSystemScopeUnsupported"],
    evidenceIds: baseEvidence, verificationState: "unsupported",
  });

  if (existing.issues.length || !existing.value) return result({
    rule: rules.existingRiser, projectId, taskRevision, targetId, subjectIds: subjects,
    status: "unknown", applicability: "unknown",
    reason: "The existence of the sprinkler system being modified is not independently established by current permit or drawing evidence.",
    missing: existing.issues.length ? existing.issues : ["changeRequest.existingSystem"],
    evidenceIds: baseEvidence, verificationState: "input_missing",
  });

  if (existing.value === "no") return result({
    rule: rules.existingRiser, projectId, taskRevision, targetId, subjectIds: subjects,
    status: "unknown", applicability: "unknown",
    reason: "The work is classified as an existing-system modification while the system is confirmed absent; resolve this conflicting scope before applying I.15.",
    missing: ["changeRequest.systemWorkType.existingSystemConflict"],
    evidenceIds: baseEvidence, verificationState: "input_missing",
  });

  if (adds.issues.length || !adds.value) return result({
    rule: rules.existingRiser, projectId, taskRevision, targetId, subjectIds: subjects,
    status: "unknown", applicability: "unknown",
    reason: "Whether this existing-system modification adds sprinklers or piping is not independently established by current permit or drawing evidence.",
    missing: adds.issues.length ? adds.issues : ["changeRequest.addsSprinklersOrPiping"],
    evidenceIds: baseEvidence, verificationState: "input_missing",
  });

  if (adds.value === "no") return result({
    rule: rules.existingRiser, projectId, taskRevision, targetId, subjectIds: subjects,
    status: "not_applicable", applicability: "not_applicable",
    reason: "The existing-system modification adds no sprinklers or piping; AB 2.04 I.15's addition-specific drawing-content requirement is not triggered.",
    evidenceIds: baseEvidence, verificationState: "verified",
  });

  if (sourceDrawing.issues.length || !sourceDrawing.value) return result({
    rule: rules.existingRiser, projectId, taskRevision, targetId, subjectIds: subjects,
    status: "unknown", applicability: "applicable",
    reason: "The added work triggers the I.15 drawing-content check, but the current proposed drawing revision is not established.",
    missing: sourceDrawing.issues.length ? sourceDrawing.issues : ["proposed.sourceDrawing"],
    evidenceIds: [...baseEvidence, ...sourceDrawing.evidenceIds], verificationState: "input_missing",
  });

  const included = readFact({
    fact: requestFacts.existingConfigurationAndRiserIncluded,
    path: "changeRequest.existingConfigurationAndRiserIncluded",
    projectId,
    taskRevision,
    targetId,
    evidence,
    kinds: ["drawing"],
    expectedRevision: sourceDrawing.value,
  });
  const evidenceIds = [...baseEvidence, ...sourceDrawing.evidenceIds, ...included.evidenceIds];
  if (included.issues.length || !included.value) return result({
    rule: rules.existingRiser, projectId, taskRevision, targetId, subjectIds: subjects,
    status: "unknown", applicability: "applicable",
    reason: "The current proposed drawing revision must establish whether both the existing configuration and connection to the existing riser are shown.",
    missing: included.issues.length ? included.issues : ["changeRequest.existingConfigurationAndRiserIncluded"],
    evidenceIds, verificationState: "input_missing",
  });
  if (included.value === "no") return result({
    rule: rules.existingRiser, projectId, taskRevision, targetId, subjectIds: subjects,
    status: "fail", applicability: "applicable",
    reason: "The current proposed drawing revision is confirmed not to show both the associated existing configuration and connection to the existing riser, as AB 2.04 I.15 requires for an addition.",
    evidenceIds, verificationState: "verified",
  });
  return result({
    rule: rules.existingRiser, projectId, taskRevision, targetId, subjectIds: subjects,
    status: "pass", applicability: "applicable",
    reason: "The current proposed drawing revision is confirmed to show both the associated existing configuration and connection to the existing riser; this resolves only AB 2.04 I.15.",
    evidenceIds, verificationState: "verified",
  });
}

/** Three source-bounded records checks for I.14(A), I.14(D), and I.15; no overall permit verdict. */
export function evaluateSfLocalChangeRecords(input: {
  input: ProjectLocalChangeInput;
  projectId: string;
  taskRevision: number;
  evidence: readonly ProjectEvidence[];
}): ProjectRuleResult[] {
  const sourceDrawing = drawingRevision(input.input, input.projectId, input.taskRevision, input.evidence);
  return [
    ...evaluateThreadedReuse({ ...input, sourceDrawing }),
    ...evaluateExcessPipe({ ...input, sourceDrawing }),
    evaluateExistingRiser({ ...input, sourceDrawing }),
  ];
}

export function evaluateSfLocalChangeRecordRule(input: Parameters<typeof evaluateSfLocalChangeRecords>[0], ruleId: string): ProjectRuleResult[] {
  const context = { ...input, sourceDrawing: drawingRevision(input.input, input.projectId, input.taskRevision, input.evidence) };
  switch (ruleId) {
    case "SFFD_AB204_NO_REINSTALL_REMOVED_OR_WELDED_SPRINKLER_I14D_V1": return evaluateThreadedReuse(context);
    case "SFFD_AB204_REMOVE_UNUSED_EXCESS_PIPE_I14A_V1": return evaluateExcessPipe(context);
    case "SFFD_AB204_EXISTING_CONFIGURATION_RISER_FOR_ADDITIONS_I15_V1": return [evaluateExistingRiser(context)];
    default: throw new Error(`Unknown local record rule: ${ruleId}`);
  }
}
