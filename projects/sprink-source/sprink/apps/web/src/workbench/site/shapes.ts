import type { PackageInputs } from "@sprink/core";
import { BOX_KEYS, evidenceSpec, findFact, readBox, upsertFacts } from "../model.js";
export const SHAPES = ["duct", "workEnvelope"] as const;
export type ShapeId = typeof SHAPES[number];
export type Shapes = Record<ShapeId, Array<number | null>>;
export type XY = { x: number; y: number };
export const shapeValues = (s: Pick<PackageInputs, "detailing" | "siteFacts">): Shapes => ({ duct: readBox(s, "duct").values, workEnvelope: readBox(s, "workEnvelope").values });
export const hasFootprint = (v: Array<number | null>) => [0, 1, 3, 4].every(i => v[i] !== null) && v[3]! > v[0]! && v[4]! > v[1]!;
export function rectangle(a: XY, b: XY, previous: Array<number | null>) {
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), previous[2], Math.max(a.x, b.x), Math.max(a.y, b.y), previous[5]];
}
/** Only changed faces lose confirmation; photos and untouched heights retain their evidence. */
export function shapePatch(s: PackageInputs, draft: Shapes): Partial<PackageInputs> {
  const saved = shapeValues(s);
  const specs = SHAPES.flatMap(id => saved[id].every((v, i) => v === draft[id][i]) ? [] : BOX_KEYS.flatMap((key, i) => {
    const old = findFact(s, `${id}.${key}`);
    if (old && saved[id][i] === draft[id][i]) return [];
    return [{ field: `${id}.${key}`, value: draft[id][i], unit: "mm", context: "observed" as const,
      ...evidenceSpec(old, "user_entered", "Placed or adjusted in the site shape editor; verify against field measurements"),
      assetId: old?.source.assetId, page: old?.source.page, unknownReason: "Face not entered in the site shape editor" }];
  }));
  const facts = upsertFacts(s, specs);
  return { ...facts, ...(s.changeRequest ? { changeRequest: { ...s.changeRequest, factIds: [...new Set([...s.changeRequest.factIds.filter(id => ![...s.siteFacts, ...s.detailing].some(f => f.id === id && f.field.startsWith("duct."))), ...facts.siteFacts.concat(facts.detailing).filter(f => f.field.startsWith("duct.")).map(f => f.id)])] } } : {}) };
}
