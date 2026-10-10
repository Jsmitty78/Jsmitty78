import { deriveWorkPackage, toMeters } from "./engine.js";
import type { Catalog, FabricationInput, FabricationOutput, Point3, Source, Value } from "./types.js";

export const FLANGED_UNION_SOURCE: Source = {
  id: "asc-487-v02", document: "Anvil Fig. 366 & 487 submittal",
  revision: "PS-SUB-366-487-v02 20220619", pages: "2-4",
  url: "https://www.asc-es.com/resource/366%20%26%20487%20Hex%20Coupling%20%26%20Flanged%20Union%20Submittal",
  sha256: "5047dd356b9ec5b241346e98d0ecb08d6c202db01b353ce1e7e1e40a56057019",
};

/** Research candidates, NOT catalog-approved connections or dimensional takeouts. */
export const FLANGED_UNION_CANDIDATES = [
  { id: "anvil/487-black-nps2", nominalSize: "NPS 2", boltCount: 4, flangeDiameterMm: 127 },
  { id: "anvil/487-black-nps1", nominalSize: "NPS 1", boltCount: 3, flangeDiameterMm: 82.55 },
] as const;
export interface ClosureProposal {
  id: string;
  binding: Pick<FabricationInput, "projectId" | "packageId" | "planId" | "inputRevision" | "configVersion">;
  /** Rebind after a product change, even if the caller forgot to increment the revision. */
  pipeProductId: string;
  unionCandidateId: string;
  splitPieceId: string;
  /** Proposed axial reference only; not a measured face or physical pipe end. */
  station: Value<Point3>;
  /** Product selection for which the following confirmations were obtained. */
  conditionProducts?: { pipeProductId: string; unionCandidateId: string };
  conditions: {
    physicalInterfaces: Value<boolean>;
    productCompatibility: Value<boolean>;
    rotationAndMovement: Value<boolean>;
    toolAndBoltAccess: Value<boolean>;
  };
}

const coordinates = (p: Point3, frame: string) => {
  if (p.frameId !== frame) throw new Error("Closure station frame mismatch");
  return [p.x, p.y, p.z].map(v => Math.sign(v) * toMeters({ value: Math.abs(v), unit: p.unit }));
};

/** Bounded draft: one flanged union splits one straight piece. No construction-ready path yet.
 * Reuses the public engine for counts, cuts and callouts; never injects guessed union datums.
 */
export function deriveFixedEndClosure(input: FabricationInput, catalog: Catalog, proposal: ClosureProposal): FabricationOutput {
  for (const key of ["projectId", "packageId", "planId", "inputRevision", "configVersion"] as const) {
    if (proposal.binding[key] !== input[key]) throw new Error(`Stale or foreign closure binding: ${key}`);
  }
  if (!proposal.id.trim()) throw new Error("Closure ID is required");
  const candidate = FLANGED_UNION_CANDIDATES.find(p => p.id === proposal.unionCandidateId);
  if (!candidate) throw new Error("Unsupported closure method/product; no implicit substitution");
  const index = input.pieces.findIndex(p => p.id === proposal.splitPieceId);
  if (index < 0) throw new Error("Closure piece not found");
  const original = input.pieces[index];
  if (original.productId !== proposal.pipeProductId) throw new Error("Closure pipe selection changed");
  const pipe = catalog.products.find(p => p.id === original.productId);
  // String comparison also accepts the steel connection contract supplied by #10.
  if (pipe && (pipe.kind !== "pipe" || String(pipe.connection) !== "steel_threaded" || pipe.nominalSize !== candidate.nominalSize)) {
    throw new Error("Closure requires a matching steel/threaded pipe; CPVC is a separate strategy");
  }
  if (input.pieces.some(p => p.productId !== original.productId)) throw new Error("Mixed pipe products require separate closure review");
  // Validate the original run before changing its connectivity.
  deriveWorkPackage(input, catalog);
  const start = input.nodes.find(n => n.id === original.startNodeId)!, end = input.nodes.find(n => n.id === original.endNodeId)!;
  if (!start.position.value || start.position.status === "unknown" || !end.position.value || end.position.status === "unknown"
    || !proposal.station.value || proposal.station.status === "unknown") throw new Error("A located straight piece and closure station are required");
  const a = coordinates(start.position.value, input.frame.id), b = coordinates(end.position.value, input.frame.id);
  const c = coordinates(proposal.station.value, input.frame.id);
  const axes = [0, 1, 2].filter(i => Math.abs(a[i] - b[i]) > 1e-10);
  if (axes.length !== 1 || [0, 1, 2].some(i => i !== axes[0] && Math.abs(c[i] - a[i]) > 1e-10)
    || c[axes[0]] <= Math.min(a[axes[0]], b[axes[0]]) || c[axes[0]] >= Math.max(a[axes[0]], b[axes[0]])) {
    throw new Error("Closure station must lie strictly inside an axis-aligned piece");
  }
  const nodeId = `${proposal.id}/station`, fittingId = `${proposal.id}/union`;
  const leftId = `${original.id}/before-${proposal.id}`, rightId = `${original.id}/after-${proposal.id}`;
  const gasketId = `${proposal.id}/gasket`, boltsId = `${proposal.id}/bolts`;
  const generated = [nodeId, fittingId, leftId, rightId, gasketId, boltsId];
  const existing = [...input.nodes, ...input.pieces, ...input.fittings, ...input.accessories].map(e => e.id);
  if (generated.some(id => existing.includes(id))) throw new Error("Closure IDs collide with existing entities");
  const proposalEvidenceId = `${proposal.id}/proposal`;
  if (input.evidence.some(e => e.id === proposalEvidenceId)) throw new Error("Closure evidence ID collides with existing evidence");
  const detailed = structuredClone(input);
  detailed.nodes.push({ id: nodeId, datum: "fitting_center",
    position: { ...structuredClone(proposal.station), status: "proposed", reason: "Proposed union reference, not a surveyed joint" } });
  const halves = [
    { ...original, id: leftId, endNodeId: nodeId },
    { ...original, id: rightId, startNodeId: nodeId },
  ];
  const previous = input.pieces[index - 1], next = input.pieces[index + 1];
  const touches = (piece: typeof original, node: string) => piece.startNodeId === node || piece.endNodeId === node;
  // Run order is independent of each piece's stored start/end orientation.
  if (previous ? touches(previous, original.endNodeId) : next && touches(next, original.startNodeId)) halves.reverse();
  detailed.pieces.splice(index, 1, ...halves);
  // Preserve the orientation of every existing fitting port and accessory link.
  for (const fitting of detailed.fittings) for (const port of fitting.ports) {
    if (port.pieceId === original.id) port.pieceId = port.end === "start" ? leftId : rightId;
  }
  for (const accessory of detailed.accessories) accessory.attachedPieceIds = accessory.attachedPieceIds.flatMap(id => id === original.id ? [leftId, rightId] : [id]);
  detailed.fittings.push({ id: fittingId, sourceEntityIds: [...original.sourceSegmentIds], productId: candidate.id, nodeId,
    ports: [{ id: "before", pieceId: leftId, end: "end", location: "field" }, { id: "after", pieceId: rightId, end: "start", location: "field" }] });
  // Included-component requirements: do not interpret these as additional kit purchases.
  for (const [id, count, description] of [[gasketId, 1, "Included gasket: material, thickness and supply scope unresolved"],
    [boltsId, candidate.boltCount, "Included bolts: grade, size, nuts and supply scope unresolved"]] as const) {
    detailed.accessories.push({ id, kind: "other", productId: null,
      quantity: { value: count, status: "proposed", evidenceIds: [], reason: description }, attachedPieceIds: [leftId, rightId], reason: description });
  }
  // Union axial length/makeup is absent from the dossier. Never let another catalog record
  // with the same ID accidentally turn this draft into a dimensioned union.
  const safeCatalog = { ...catalog, products: catalog.products.filter(p => p.id !== candidate.id) };
  const result = deriveWorkPackage(detailed, safeCatalog);
  const reasons = [
    "Draft closure proposal; fixed-end assembly sequence has not been reviewed by a practitioner",
    "Union axial datums, engagement and independently measured dimensional oracle are missing",
    "Gasket/fastener specifications, tightening procedure and project compatibility remain unresolved",
  ];
  for (const [name, fact] of Object.entries(proposal.conditions)) {
    const selectionMatches = proposal.conditionProducts?.pipeProductId === original.productId
      && proposal.conditionProducts.unionCandidateId === candidate.id;
    const evidenced = selectionMatches && fact.status === "confirmed" && fact.value === true && fact.evidenceIds.length > 0
      && fact.evidenceIds.every(id => input.evidence.some(e => e.id === id && e.subjectIds.includes(proposal.id)));
    if (!evidenced) reasons.push(`Confirm closure ${name}: ${fact.reason ?? "subject-scoped evidence missing"}`);
  }
  if (!pipe) reasons.push(`Pipe product compatibility is unsupported: ${original.productId}`);
  const gasketJointId = `${fittingId}/gasket-interface`;
  result.joints.push({ id: gasketJointId, callout: result.joints.length + 1, pieceId: leftId, end: "end", nodeId,
    fittingId, portId: null, subassemblyId: original.subassemblyId, location: "field", orientation: null,
    procedureId: null, reasons: [...reasons] });
  result.fittings.find(f => f.id === fittingId)!.jointIds.push(gasketJointId);
  result.subassemblies.find(s => s.id === original.subassemblyId)!.jointIds.push(gasketJointId);
  const steps = [
    "Review both physical interface locations, thread condition, elevations and support/isolation requirements; scope stations do not prove pipe ends.",
    "Review a split assembly sequence: assemble each side toward the union; identify every part that rotates and the swept/tool envelope before fixing either side.",
    "Review union-half thread preparation and makeup against the selected product instructions; confirm axial datums without converting nominal thread turns into measured engagement.",
    "Review final face alignment, gasket insertion movement and bolt/tool access; obtain the selected gasket and fastener tightening procedure before closure.",
  ];
  for (const instruction of steps) {
    const number = result.operations.length + 1;
    result.operations.push({ id: `op-${number}`, number, code: "review_fixed_end_closure", pieceIds: [leftId, rightId],
      jointIds: [`${fittingId}/before`, `${fittingId}/after`, gasketJointId], predecessorId: result.operations.at(-1)?.id ?? null,
      instruction, sourceIds: [FLANGED_UNION_SOURCE.id], status: "needs_confirmation", reasons: [...reasons] });
  }
  result.gaps.push(...reasons.map(reason => ({ subjectId: fittingId, reason })));
  if (!result.sources.some(s => s.id === FLANGED_UNION_SOURCE.id)) result.sources.push(structuredClone(FLANGED_UNION_SOURCE));
  result.evidence.push({ id: proposalEvidenceId, subjectIds: [fittingId, nodeId, leftId, rightId, gasketId, boltsId],
    description: "Developer-authored closure proposal, not performed work or practitioner approval. Gasket and bolt rows are included-component requirements, not extra purchases." });
  return result;
}
