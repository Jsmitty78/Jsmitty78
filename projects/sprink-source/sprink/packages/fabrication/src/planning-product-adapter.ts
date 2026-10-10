import { toMeters } from "./engine.js";
import type { Catalog, Length } from "./types.js";

interface Fact<T> { value: T | null; confirmed: boolean; evidenceIds: string[]; source: "manual" | "model" | "fixture" }
/** Structural match to planning GenerateInput.product. Catalog facts are not site facts. */
export interface PlanningProductPort {
  compatibility: Fact<{ pipeProductId: string; elbowProductId: string; connectionMethod: string }>;
  centerToFace: Fact<Length>;
  insertionOrThreadMakeup: Fact<Length>;
}
/** A one-pair catalog remains convenient for controls; an aggregate requires selection. */
export function toPlanningProduct(catalog: Catalog, pipeProductId?: string | null, elbowProductId?: string | null): PlanningProductPort {
  const pipes = catalog.products.filter(p => p.kind === "pipe");
  const pipe = pipeProductId === undefined && pipes.length === 1 ? pipes[0] : pipes.find(p => p.id === pipeProductId);
  const elbows = catalog.products.filter(p => p.kind === "elbow_90" && pipe && p.compatiblePipeIds.includes(pipe.id));
  const elbow = elbowProductId === undefined && elbows.length === 1 ? elbows[0] : elbows.find(p => p.id === elbowProductId);
  const sourceIds = [...new Set([...(pipe?.sourceIds ?? []), ...(elbow?.sourceIds ?? [])])];
  const sourceBacked = sourceIds.length > 0 && catalog.evidenceClass === "manufacturer_document"
    && sourceIds.every(id => catalog.sources.some(s => s.id === id));
  const compatible = sourceBacked && pipe?.kind === "pipe" && elbow?.kind === "elbow_90"
    && elbow.compatiblePipeIds.includes(pipe.id) && pipe.nominalSize === elbow.nominalSize
    && pipe.connection === elbow.connection && pipe.connection !== "unsupported";
  const fact = <T>(value: T | null): Fact<T> => ({ value, confirmed: value !== null,
    evidenceIds: value === null ? [] : sourceIds, source: "manual" });
  const h = compatible && elbow.centerToFace ? toMeters(elbow.centerToFace) : null;
  const g = compatible && elbow.connection === "cpvc_socket_solvent" && elbow.centerToSocketBottom ? toMeters(elbow.centerToSocketBottom) : null;
  if (g !== null && h !== null && h <= g) throw new Error("Socket H must exceed G");
  return {
    compatibility: fact(compatible ? { pipeProductId: pipe.id, elbowProductId: elbow.id, connectionMethod: pipe.connection } : null),
    centerToFace: fact(h === null ? null : { value: h, unit: "m" }),
    // A catalog never supplies field thread engagement to a newly generated joint.
    insertionOrThreadMakeup: fact(h === null || g === null ? null : { value: h - g, unit: "m" }),
  };
}
