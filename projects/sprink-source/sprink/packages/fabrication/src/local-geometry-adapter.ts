import type { Catalog, FabricationInput, Length, Point3, Value } from "./types.js";
import { deriveWorkPackage } from "./engine.js";

/** Structural port matching the uncommitted core/local-change-geometry.ts inspected 2026-09-26.
 * No import from another checkout. Pass its result to evaluateLocalPlanGeometry after
 * the core lane lands. That evaluator rejects proposed positions by design.
 */
interface LocalFact<T> { value: T | null; confirmed: boolean; evidenceIds: string[]; source: "manual" | "model" | "fixture" }
interface LocalPort {
  segmentId: string; endpoint: "start" | "end"; nodeId: string;
  centerToFace: LocalFact<Length>; insertionOrThreadMakeup: LocalFact<Length>;
}
export interface LocalGeometryPort {
  id: string;
  coordinateFrame: LocalFact<{ id: string; lengthUnit: FabricationInput["frame"]["lengthUnit"] }>;
  nodes: { id: string; kind: "fitting_center" | "tie_in" | "other"; position: LocalFact<Point3>; fittingId?: string; tieInNetCutOffset?: LocalFact<Length> }[];
  segments: { id: string; startNodeId: string; endNodeId: string; outsideDiameter: LocalFact<Length>; cutEndDatumAtStart: LocalFact<"center_to_center" | "physical_pipe_end">; cutEndDatumAtEnd: LocalFact<"center_to_center" | "physical_pipe_end"> }[];
  fittings: { id: string; kind: LocalFact<"elbow_90" | "unsupported">; centerNodeId: string; ports: readonly [LocalPort, LocalPort] }[];
  ducts: [];
}
function fact<T>(value: T | null, evidenceIds: string[]): LocalFact<T> {
  return { value, confirmed: value !== null, evidenceIds, source: "manual" };
}
function valueFact<T>(input: FabricationInput, value: Value<T>, subjectId: string): LocalFact<T> {
  return { value: value.value, confirmed: value.status === "confirmed" && value.evidenceIds.length > 0
    && value.evidenceIds.every(id => input.evidence.some(e => e.id === id && e.subjectIds.includes(subjectId))),
    evidenceIds: [...value.evidenceIds], source: value.status === "proposed" ? "model" : "manual" };
}
export function toLocalPlanGeometry(input: FabricationInput, catalog: Catalog): LocalGeometryPort {
  const output = deriveWorkPackage(input, catalog);
  return {
    id: input.planId, coordinateFrame: fact(input.frame, [`plan:${input.planId}:explicit-frame`]),
    nodes: input.nodes.map(n => ({ id: n.id, kind: n.datum === "fitting_center" ? "fitting_center" : "tie_in",
      position: valueFact(input, n.position, n.id),
      ...(n.datum === "fitting_center" ? { fittingId: input.fittings.find(f => f.nodeId === n.id)!.id }
        : { tieInNetCutOffset: n.datum === "physical_pipe_end" ? fact({ value: 0, unit: "m" as const }, [`datum:${n.id}:physical-end`])
          : n.netCutOffset ? valueFact(input, n.netCutOffset, n.id) : fact<Length>(null, []) }) })),
    segments: input.pieces.map(p => {
      const product = catalog.products.find(c => c.id === p.productId);
      return { id: p.id, startNodeId: p.startNodeId, endNodeId: p.endNodeId,
        cutEndDatumAtStart: fact(input.nodes.find(n => n.id === p.startNodeId)!.datum === "physical_pipe_end" ? "physical_pipe_end" : "center_to_center", [`datum:${p.startNodeId}`]),
        cutEndDatumAtEnd: fact(input.nodes.find(n => n.id === p.endNodeId)!.datum === "physical_pipe_end" ? "physical_pipe_end" : "center_to_center", [`datum:${p.endNodeId}`]),
        outsideDiameter: fact(product?.kind === "pipe" ? product.outsideDiameter : null, product?.sourceIds ?? []) };
    }),
    fittings: input.fittings.map(f => ({ id: f.id, centerNodeId: f.nodeId,
      kind: fact(catalog.products.find(p => p.id === f.productId)?.kind === "elbow_90" ? "elbow_90" as const : "unsupported" as const,
        catalog.products.find(p => p.id === f.productId)?.sourceIds ?? []),
      ports: f.ports.map(p => {
        const t = output.cuts.find(c => c.pieceId === p.pieceId)!.takeouts[p.end === "start" ? 0 : 1];
        return { segmentId: p.pieceId, endpoint: p.end, nodeId: f.nodeId,
          centerToFace: fact(t.centerToFaceM === null ? null : { value: t.centerToFaceM, unit: "m" as const }, t.sourceIds),
          insertionOrThreadMakeup: {
            value: t.insertionM === null ? null : { value: t.insertionM, unit: "m" as const },
            confirmed: t.insertionM !== null && t.netTakeout.basis === "confirmed_inputs",
            evidenceIds: [...t.sourceIds, ...t.netTakeout.evidenceIds],
            source: t.netTakeout.basis === "proposed_inputs" ? "model" as const : "manual" as const,
          } };
      }) as [LocalPort, LocalPort] })),
    ducts: [],
  };
}
