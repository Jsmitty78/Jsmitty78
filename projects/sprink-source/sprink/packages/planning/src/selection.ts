import type { CandidateSet, DeriveWorkPackage, GenerateInput, Version } from "./types.js";

export function selectCandidate(set: CandidateSet, candidateId: string, current: Version) {
  if (set.projectId !== current.projectId || set.packageId !== current.packageId
    || set.inputRevision !== current.inputRevision || set.configVersion !== current.configVersion) {
    return { ok: false, reason: "stale_or_wrong_package" } as const;
  }
  const candidate = set.candidates.find(c => c.id === candidateId);
  if (!candidate) return { ok: false, reason: "candidate_not_found" } as const;
  // Return an explicit selection proposal; the API must persist it and increment inputRevision.
  return { ok: true, candidate: structuredClone(candidate) } as const;
}

export function deriveCandidatePackages<T>(input: GenerateInput, set: CandidateSet, derive: DeriveWorkPackage<T>) {
  if (set.baselinePlanId !== input.baseline.id || set.projectId !== input.projectId || set.packageId !== input.packageId
    || set.inputRevision !== input.inputRevision || set.configVersion !== input.configVersion) {
    throw new Error("Cannot derive packages from a stale or unrelated candidate set.");
  }
  const version: Version = { projectId: input.projectId, packageId: input.packageId,
    inputRevision: input.inputRevision, configVersion: input.configVersion };
  return {
    baseline: derive({ ...version, intent: input.intent, plan: structuredClone(input.baseline), status: "baseline" }),
    candidates: set.candidates.map(candidate => ({ candidateId: candidate.id,
      workPackage: derive({ ...version, intent: input.intent, plan: structuredClone(candidate.plan), status: "proposed" }) })),
  };
}
