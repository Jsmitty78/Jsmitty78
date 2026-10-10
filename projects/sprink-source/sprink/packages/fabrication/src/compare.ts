import type { FabricationOutput, Metric, Point3 } from "./types.js";
import { toMeters } from "./engine.js";
const delta = (before: number | null, after: number | null) => before === null || after === null ? null : after - before;
const pointKey = (p: Point3 | null) => p && [p.frameId, ...[p.x, p.y, p.z].map(v => Math.sign(v) * toMeters({ value: Math.abs(v), unit: p.unit }))];

/** Part changes and lineage groups are separate: a fabrication split is not route removal. */
export function compareWorkPackages(baseline: FabricationOutput, candidate: FabricationOutput) {
  if (baseline.projectId !== candidate.projectId || baseline.packageId !== candidate.packageId
    || baseline.configVersion !== candidate.configVersion || baseline.frame.id !== candidate.frame.id) {
    throw new Error("Comparison requires the same project, package, configVersion, and coordinate frame");
  }
  const ids = [...new Set([...baseline.materials, ...candidate.materials].map(m => m.id))];
  const materials = ids.map(id => {
    const before = baseline.materials.find(m => m.id === id), after = candidate.materials.find(m => m.id === id);
    // Absence in the model is zero. An existing unresolved row is still null.
    const quantity = (row: typeof before) => row ? row.quantity.value : 0;
    const length = (row: typeof before, key: "centerlineLength" | "cutLength") => row ? row[key]?.value ?? null : 0;
    return { id, baselineQuantity: quantity(before), candidateQuantity: quantity(after), quantityDelta: delta(quantity(before), quantity(after)),
      centerlineDeltaM: delta(length(before, "centerlineLength"), length(after, "centerlineLength")),
      cutLengthDeltaM: delta(length(before, "cutLength"), length(after, "cutLength")) };
  });
  const pieceIds = [...new Set([...baseline.cuts, ...candidate.cuts].map(p => p.pieceId))];
  const signature = (p: FabricationOutput["cuts"][number]) => JSON.stringify([
    p.productId, pointKey(p.start.value), pointKey(p.end.value), p.cutLength.value,
    p.takeouts.map(t => [t.nodeId, t.datum, t.fittingId, t.portId, t.netTakeout.value]),
  ]);
  const pieces = pieceIds.map(pieceId => {
    const before = baseline.cuts.find(p => p.pieceId === pieceId), after = candidate.cuts.find(p => p.pieceId === pieceId);
    const state = !before ? "added" : !after ? "removed"
      : before.cutLength.value === null || after.cutLength.value === null ? "unknown"
      : signature(before) === signature(after) ? "unchanged" : "changed";
    return { pieceId, state, proposedReuse: after?.disposition === "proposed_reuse",
      cutLengthDeltaM: delta(before ? before.cutLength.value : 0, after ? after.cutLength.value : 0) };
  });
  const segmentIds = [...new Set([...baseline.cuts, ...candidate.cuts].flatMap(p => p.sourceSegmentIds))];
  const lineage = segmentIds.map(sourceSegmentId => {
    const before = baseline.cuts.filter(p => p.sourceSegmentIds.includes(sourceSegmentId));
    const after = candidate.cuts.filter(p => p.sourceSegmentIds.includes(sourceSegmentId));
    return { sourceSegmentId, baselinePieceIds: before.map(p => p.pieceId), candidatePieceIds: after.map(p => p.pieceId),
      state: !before.length ? "added" : !after.length ? "removed" : before.length !== after.length ? "piece_split_or_merge"
        : after.every(p => pieces.find(c => c.pieceId === p.pieceId)?.state === "unchanged") ? "unchanged" : "changed" };
  });
  const sum = (metrics: Metric[]) => metrics.some(m => m.value === null) ? null : metrics.reduce((s, m) => s + m.value!, 0);
  return {
    baseline: { planId: baseline.planId, inputRevision: baseline.inputRevision, configVersion: baseline.configVersion },
    candidate: { planId: candidate.planId, inputRevision: candidate.inputRevision, configVersion: candidate.configVersion },
    materials, pieces, lineage,
    centerlineDeltaM: delta(sum(baseline.cuts.map(p => p.centerline)), sum(candidate.cuts.map(p => p.centerline))),
    cutLengthDeltaM: delta(sum(baseline.cuts.map(p => p.cutLength)), sum(candidate.cuts.map(p => p.cutLength))),
    jointCountDelta: candidate.joints.length - baseline.joints.length,
    operationCountDelta: candidate.operations.length - baseline.operations.length,
  };
}
