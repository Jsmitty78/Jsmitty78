import type { Fact, RuleContext } from "./types.js";

export function evidenceIssues(ids: string[] | undefined, ctx: RuleContext, path: string): string[] {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id)) return [`${path}.evidenceIds`];
  if (!Array.isArray(ctx.observations)) return ['observations'];
  return [...new Set(ids)].flatMap(id => {
    const matches = ctx.observations.filter(item => item && item.id === id);
    return matches.length !== 1 || matches[0].targetId !== ctx.targetId || matches[0].superseded || matches[0].invalidated
      ? [`${path}.evidenceIds:${id}`]
      : [];
  });
}

export function factIssues<T>(fact: Fact<T> | undefined, ctx: RuleContext, path: string): string[] {
  if (!fact) return [path];
  const issues: string[] = [];
  if (fact.value == null || fact.value === "unknown" || fact.value === "") issues.push(path);
  if (fact.confirmed !== true || !['manual','fixture'].includes(fact.source)) issues.push(`${path}.confirmation`);
  return [...issues, ...evidenceIssues(fact.evidenceIds, ctx, path)];
}

export function contextIssues(ctx: RuleContext): string[] {
  return [
    ...(typeof ctx.targetId !== 'string' || !ctx.targetId.trim() ? ["targetId"] : []),
    ...(!Number.isSafeInteger(ctx.taskRevision) || ctx.taskRevision < 0 ? ["taskRevision"] : []),
    ...(!Array.isArray(ctx.observations) ? ['observations'] : []),
  ];
}
