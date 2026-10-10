import type { PackagePlan, WorkPackageSnapshot } from "@sprink/core";

/** Documented catalog pairs; selecting a pair does not confirm project suitability or site dimensions. */
export const PRODUCT_SETS: Record<string, { label: string; pipe: string | null; elbow: string | null; material: string | null }> = {
  none: { label: "Not selected yet", pipe: null, elbow: null, material: null },
  cpvc: { label: "Spears FlameGuard CPVC NPS 1", pipe: "spears/CP-010", elbow: "spears/4206-010S", material: "cpvc" },
  steel_nps2: { label: "Wheatland Schedule 40 steel / Anvil 351 — NPS 2", pipe: "wheatland/a53-sch40-black-nps2", elbow: "anvil/351-black-nps2", material: "steel" },
  steel_nps1: { label: "Wheatland Schedule 40 steel / Anvil 351 — NPS 1", pipe: "wheatland/a53-sch40-black-nps1", elbow: "anvil/351-black-nps1", material: "steel" },
};

export function productSetOf(s: Pick<WorkPackageSnapshot, "baselinePlan" | "scope">): string {
  const active = s.baselinePlan?.entities.filter(e => s.scope?.includedEntityIds.includes(e.id));
  const pipes = active?.filter(e => e.kind === "pipe") ?? [];
  const fittings = active?.filter(e => e.kind === "fitting") ?? [];
  if (!pipes.length) return "none";
  return Object.entries(PRODUCT_SETS).find(([, pair]) =>
    pipes.every(e => e.productId === pair.pipe) && fittings.every(e => e.productId === pair.elbow))?.[0] ?? "none";
}

/** Product edits do not reproject the trace or move retained context, even by floating-point roundoff. */
export function applyRunProducts(plan: PackagePlan, includedEntityIds: string[], pair: { pipe: string | null; elbow: string | null }): PackagePlan {
  return { ...plan, confirmation: "proposed", entities: plan.entities.map(entity => {
    if (!includedEntityIds.includes(entity.id)) return entity;
    if (entity.kind === "pipe") return { ...entity, productId: pair.pipe };
    if (entity.kind === "fitting") return { ...entity, productId: pair.elbow };
    return entity;
  }) };
}
