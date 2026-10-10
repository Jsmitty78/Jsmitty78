import { CEMENT_ID, PROCEDURE_SOURCE } from "./catalog.js";
import { STEEL_ELBOW_SOURCE } from "./steel-catalog.js";
import type {
  Catalog, CutRow, EndpointTakeout, FabricationInput, FabricationOutput, Joint,
  Length, Metric, Node, Operation, Piece, Value,
} from "./types.js";

const FACTORS = { m: 1, mm: 0.001, ft: 0.3048, in: 0.0254 } as const;
const unique = <T>(items: T[]) => [...new Set(items)];
/** The product id adapters give a piece or fitting whose product has not been selected yet. */
export const UNSELECTED_PRODUCT = "unsupported";
const pipeReason = (productId: string) => productId === UNSELECTED_PRODUCT ? "Pipe product not selected" : `Unsupported pipe: ${productId}`;
export function toMeters(length: Length): number {
  const result = length.value * FACTORS[length.unit];
  if (!Number.isFinite(result) || length.value < 0) throw new Error("Length must be finite, nonnegative, and have a supported unit");
  return result;
}
function metric(value: number | null, basis: Metric["basis"], reasons: string[] = [], evidenceIds: string[] = [], unit: Metric["unit"] = "m"): Metric {
  if (value !== null && !Number.isFinite(value)) throw new Error("Non-finite derived quantity");
  return { value, unit, basis: value === null ? "unknown" : basis, reasons: unique(reasons), evidenceIds: unique(evidenceIds) };
}
function total(values: Metric[]): Metric {
  return metric(values.some(v => v.value === null) ? null : values.reduce((sum, v) => sum + v.value!, 0),
    values.some(v => v.basis === "proposed_inputs") ? "proposed_inputs" : "confirmed_inputs",
    values.flatMap(v => v.reasons), values.flatMap(v => v.evidenceIds));
}
function indexById<T extends { id: string }>(items: T[], name: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (!item.id.trim() || map.has(item.id)) throw new Error(`Empty or duplicate ${name} ID: ${item.id}`);
    map.set(item.id, item);
  }
  return map;
}
/** Missing, model-proposed, and confirmed values remain distinguishable. */
function read<T>(input: FabricationInput, fact: Value<T> | undefined, subjectId: string): { value: T | null; basis: Metric["basis"]; reasons: string[]; evidenceIds: string[] } {
  if (!fact || fact.value === null || fact.status === "unknown") return {
    value: null, basis: "unknown", reasons: [fact?.reason || `Missing value for ${subjectId}`], evidenceIds: fact?.evidenceIds ?? [],
  };
  if (fact.status === "confirmed" && (!fact.evidenceIds.length || fact.evidenceIds.some(id =>
    !input.evidence.some(e => e.id === id && e.subjectIds.includes(subjectId))))) return {
    value: null, basis: "unknown", reasons: [`Confirmation evidence missing or belongs to another subject: ${subjectId}`], evidenceIds: fact.evidenceIds,
  };
  return { value: fact.value, basis: fact.status === "confirmed" ? "confirmed_inputs" : "proposed_inputs", reasons: [], evidenceIds: fact.evidenceIds };
}
function position(input: FabricationInput, node: Node): { point: [number, number, number] | null; metric: Metric } {
  const result = read(input, node.position, node.id);
  if (!result.value) return { point: null, metric: metric(null, result.basis, result.reasons, result.evidenceIds) };
  const p = result.value;
  if (p.frameId !== input.frame.id) throw new Error(`Coordinate frame mismatch: ${node.id}`);
  const point = [p.x, p.y, p.z].map(v => v * FACTORS[p.unit]) as [number, number, number];
  if (!point.every(Number.isFinite)) throw new Error(`Non-finite coordinates or invalid unit: ${node.id}`);
  return { point, metric: metric(0, result.basis, [], result.evidenceIds) };
}
const axisOf = (a: number[], b: number[]) => [0, 1, 2].filter(i => Math.abs(a[i] - b[i]) > 1e-10);

export function deriveWorkPackage(input: FabricationInput, catalog: Catalog): FabricationOutput {
  if (input.configVersion !== catalog.configVersion) throw new Error("Input/catalog configVersion mismatch");
  for (const value of [input.projectId, input.packageId, input.planId, input.baselinePlanId, input.configVersion, input.frame.id]) {
    if (!value.trim()) throw new Error("Identity and version strings must not be empty");
  }
  if (!Number.isSafeInteger(input.inputRevision) || input.inputRevision < 0) throw new Error("Invalid inputRevision");
  if (!Object.hasOwn(FACTORS, input.frame.lengthUnit)) throw new Error("Unsupported frame unit");
  if (!input.pieces.length) throw new Error("A fabrication run needs at least one piece");
  const nodes = indexById(input.nodes, "node");
  const pieces = indexById(input.pieces, "piece");
  const fittings = indexById(input.fittings, "fitting");
  indexById(input.accessories, "accessory");
  indexById(input.evidence, "evidence");
  const products = indexById(catalog.products, "product");
  const sources = indexById(catalog.sources, "source");
  for (const product of catalog.products) {
    if (product.sourceIds.some(id => !sources.has(id))) throw new Error(`Missing catalog source: ${product.id}`);
  }
  const allEntityIds = [...input.pieces, ...input.fittings, ...input.accessories].map(e => e.id);
  if (new Set(allEntityIds).size !== allEntityIds.length) throw new Error("Part IDs must be unique across part kinds");
  const points = new Map(input.nodes.map(n => [n.id, position(input, n)]));
  const portMap = new Map<string, { fitting: FabricationInput["fittings"][number]; port: FabricationInput["fittings"][number]["ports"][number] }>();
  const degree = new Map<string, number>();
  for (const [i, piece] of input.pieces.entries()) {
    if (!piece.sourceSegmentIds.length || piece.sourceSegmentIds.some(id => !id.trim()) || !piece.subassemblyId.trim()) throw new Error(`Missing lineage or subassembly: ${piece.id}`);
    for (const id of [piece.startNodeId, piece.endNodeId]) {
      if (!nodes.has(id)) throw new Error(`Unresolved node ${id}`);
      degree.set(id, (degree.get(id) ?? 0) + 1);
    }
    if (piece.startNodeId === piece.endNodeId) throw new Error(`Identical endpoints: ${piece.id}`);
    if (i > 0) {
      const prev = input.pieces[i - 1];
      if (![prev.startNodeId, prev.endNodeId].some(n => n === piece.startNodeId || n === piece.endNodeId)) throw new Error("Pieces must follow one connected ordered run");
    }
  }
  if ([...degree.values()].some(d => d > 2) || [...degree.values()].filter(d => d === 1).length !== 2) throw new Error("Only a nonbranching open run is supported");
  const fittingNodes = new Set<string>();
  for (const fitting of fittings.values()) {
    if (nodes.get(fitting.nodeId)?.datum !== "fitting_center" || fittingNodes.has(fitting.nodeId)) throw new Error(`Invalid fitting center: ${fitting.id}`);
    fittingNodes.add(fitting.nodeId);
    indexById(fitting.ports, "port");
    if (fitting.ports.length !== 2) throw new Error(`Exactly two ports required: ${fitting.id}`);
    for (const port of fitting.ports) {
      const piece = pieces.get(port.pieceId);
      if (!piece || (port.end === "start" ? piece.startNodeId : piece.endNodeId) !== fitting.nodeId) throw new Error(`Port does not meet piece endpoint: ${fitting.id}/${port.id}`);
      const key = `${port.pieceId}/${port.end}`;
      if (portMap.has(key)) throw new Error(`Duplicate connection at ${key}`);
      portMap.set(key, { fitting, port });
    }
  }
  for (const node of nodes.values()) {
    if (!degree.has(node.id)) throw new Error(`Unused node ${node.id}`);
    if (node.datum === "fitting_center" ? !fittingNodes.has(node.id) || degree.get(node.id) !== 2 : degree.get(node.id) !== 1) throw new Error(`Invalid node connectivity: ${node.id}`);
  }
  for (const a of input.accessories) {
    if (a.attachedPieceIds.some(id => !pieces.has(id))) throw new Error(`Unknown accessory piece: ${a.id}`);
  }
  function takeout(piece: Piece, end: "start" | "end"): EndpointTakeout {
    const node = nodes.get(end === "start" ? piece.startNodeId : piece.endNodeId)!;
    const base: EndpointTakeout = { nodeId: node.id, datum: node.datum, fittingId: null, portId: null,
      centerToFaceM: null, insertionM: null, netTakeout: metric(null, "unknown", []), sourceIds: [] };
    if (node.datum === "physical_pipe_end") {
      // Zero is justified by the explicit physical-end datum, not a missing-data default.
      base.netTakeout = metric(0, "confirmed_inputs");
      return base;
    }
    if (node.datum === "scope_interface") {
      base.netTakeout = metric(null, "unknown", ["Scope interface is not a physical pipe end or confirmed joint datum", "Thread engagement/product evidence and physical length/elevation require detailing"]);
      return base;
    }
    if (node.datum === "tie_in") {
      const offset = read(input, node.netCutOffset, node.id);
      base.netTakeout = metric(offset.value ? toMeters(offset.value) : null, offset.basis, offset.reasons, offset.evidenceIds);
      return base;
    }
    const connection = portMap.get(`${piece.id}/${end}`);
    if (!connection) throw new Error(`Missing fitting port for ${piece.id}/${end}`);
    const { fitting, port } = connection;
    base.fittingId = fitting.id; base.portId = port.id;
    const product = products.get(fitting.productId);
    const pipe = products.get(piece.productId);
    if (!product || product.kind !== "elbow_90" || !pipe || pipe.kind !== "pipe" || !product.compatiblePipeIds.includes(pipe.id) || product.nominalSize !== pipe.nominalSize || product.connection !== pipe.connection) {
      base.netTakeout = metric(null, "unknown", [`Unsupported product connection: ${piece.productId} -> ${fitting.productId}`]); return base;
    }
    base.sourceIds = product.sourceIds;
    const axes = fitting.ports.map(p => {
      const linked = pieces.get(p.pieceId)!;
      const a = points.get(linked.startNodeId)!.point, b = points.get(linked.endNodeId)!.point;
      return a && b ? axisOf(a, b) : [];
    });
    if (axes.some(a => a.length !== 1) || axes[0][0] === axes[1][0]) {
      base.netTakeout = metric(null, "unknown", [`90-degree fitting orientation unresolved or unsupported: ${fitting.id}`]); return base;
    }
    if (product.connection === "steel_threaded") {
      const h = product.centerToFace;
      if (h) base.centerToFaceM = toMeters(h);
      const bound = port.threadMakeup;
      if (!bound || bound.pipeProductId !== pipe.id || bound.fittingProductId !== product.id) {
        base.netTakeout = metric(null, "unknown", ["Missing thread engagement bound to this pipe/fitting pair"]);
        return base;
      }
      const engagement = read(input, bound.axialEngagement, `${fitting.id}/${port.id}`);
      if (engagement.value && h) {
        base.insertionM = toMeters(engagement.value);
        if (base.insertionM <= 0 || base.insertionM >= base.centerToFaceM!) throw new Error(`Invalid thread engagement: ${fitting.id}/${port.id}`);
        base.netTakeout = metric(base.centerToFaceM! - base.insertionM, engagement.basis, engagement.reasons, engagement.evidenceIds);
      } else base.netTakeout = metric(null, "unknown", [...engagement.reasons, ...(!h ? ["Missing threaded center-to-face datum"] : [])], engagement.evidenceIds);
      return base;
    }
    if (product.connection !== "cpvc_socket_solvent") {
      base.netTakeout = metric(null, "unknown", ["Unsupported connection method"]); return base;
    }
    const g = product.centerToSocketBottom, h = product.centerToFace;
    if (!g || !h) { base.netTakeout = metric(null, "unknown", [`Missing socket datum: ${fitting.productId}`]); return base; }
    base.centerToFaceM = toMeters(h);
    base.insertionM = toMeters(h) - toMeters(g);
    if (base.insertionM <= 0) throw new Error(`Invalid socket depth: ${product.id}`);
    base.netTakeout = metric(toMeters(g), "confirmed_inputs");
    return base;
  }
  const cuts: CutRow[] = input.pieces.map((piece, i) => {
    const start = nodes.get(piece.startNodeId)!, end = nodes.get(piece.endNodeId)!;
    const a = points.get(start.id)!, b = points.get(end.id)!;
    const merged = total([a.metric, b.metric]);
    let centerline = metric(null, "unknown", merged.reasons, merged.evidenceIds);
    if (a.point && b.point) {
      const axes = axisOf(a.point, b.point);
      if (axes.length === 0) throw new Error(`Zero-length piece: ${piece.id}`);
      centerline = axes.length === 1
        ? metric(Math.abs(a.point[axes[0]] - b.point[axes[0]]), merged.basis, [], merged.evidenceIds)
        : metric(null, "unknown", ["Only axis-aligned straight pieces are supported"], merged.evidenceIds);
    }
    const ends: [EndpointTakeout, EndpointTakeout] = [takeout(piece, "start"), takeout(piece, "end")];
    const combined = total([centerline, ...ends.map(t => t.netTakeout)]);
    const pipe = products.get(piece.productId);
    const supported = pipe?.kind === "pipe" && pipe.connection !== "unsupported";
    const cut = !supported || combined.value === null ? null : centerline.value! - ends[0].netTakeout.value! - ends[1].netTakeout.value!;
    if (cut !== null && cut <= 0) throw new Error(`Takeouts leave no positive cut: ${piece.id}`);
    return { pieceId: piece.id, callout: i + 1, sourceSegmentIds: [...piece.sourceSegmentIds], productId: piece.productId,
      subassemblyId: piece.subassemblyId, disposition: piece.disposition, start: structuredClone(start.position), end: structuredClone(end.position),
      centerline, cutLength: metric(cut, combined.basis, [...combined.reasons, ...(!supported ? [pipeReason(piece.productId)] : [])], combined.evidenceIds),
      takeouts: ends, formula: "centerline - start.netTakeout - end.netTakeout" };
  });
  const joints: Joint[] = [];
  for (const piece of input.pieces) for (const end of ["start", "end"] as const) {
    const node = nodes.get(end === "start" ? piece.startNodeId : piece.endNodeId)!;
    if (node.datum === "physical_pipe_end" || node.datum === "scope_interface") continue;
    const connection = portMap.get(`${piece.id}/${end}`);
    const id = connection ? `${connection.fitting.id}/${connection.port.id}` : `${piece.id}/${end}/tie-in`;
    const cut = cuts.find(c => c.pieceId === piece.id)!;
    const a = points.get(piece.startNodeId)!.point, b = points.get(piece.endNodeId)!.point;
    const axes = a && b ? axisOf(a, b) : [];
    const axis = axes.length === 1 ? axes[0] : null;
    const direction = axis === null ? null : `${(end === "start" ? b![axis] - a![axis] : a![axis] - b![axis]) > 0 ? "+" : "-"}${["X", "Y", "Z"][axis]}`;
    const pipe = products.get(piece.productId), elbow = connection && products.get(connection.fitting.productId);
    const procedure = elbow?.kind === "elbow_90" ? elbow.procedureId : undefined;
    const isSupported = catalog.evidenceClass === "manufacturer_document" && pipe?.kind === "pipe" && elbow?.kind === "elbow_90"
      && elbow.compatiblePipeIds.includes(pipe.id) && elbow.nominalSize === pipe.nominalSize && elbow.connection === pipe.connection
      && (procedure === "spears-fg3-socket-1in" ? pipe.connection === "cpvc_socket_solvent" && sources.has(PROCEDURE_SOURCE) && elbow.sourceIds.includes(PROCEDURE_SOURCE)
        : procedure === "anvil-351-threaded" && pipe.connection === "steel_threaded" && sources.has(STEEL_ELBOW_SOURCE) && elbow.sourceIds.includes(STEEL_ELBOW_SOURCE));
    joints.push({ id, callout: joints.length + 1, pieceId: piece.id, end, nodeId: node.id,
      fittingId: connection?.fitting.id ?? null, portId: connection?.port.id ?? null,
      subassemblyId: piece.subassemblyId, location: connection?.port.location ?? "field", orientation: direction,
      procedureId: isSupported ? procedure! : null,
      reasons: unique([...cut.cutLength.reasons, ...(!isSupported ? ["Connection procedure not supported; field closure requires separate detailing"] : [])]),
    });
  }
  const materials: FabricationOutput["materials"] = [];
  indexById(joints, "joint");
  for (const productId of unique(input.pieces.map(p => p.productId))) {
    const rows = cuts.filter(p => p.productId === productId);
    const supported = products.get(productId)?.kind === "pipe";
    // Modeled pieces are not purchased lengths; without a selected product there is nothing to count.
    materials.push({ id: `pipe:${productId}`, kind: "pipe", productId, entityIds: rows.map(r => r.pieceId),
      quantity: productId !== UNSELECTED_PRODUCT ? metric(rows.length, supported ? "confirmed_inputs" : "unknown", supported ? [] : [pipeReason(productId)], [], "each")
        : metric(null, "unknown", [`${pipeReason(productId)}; purchase quantity is not established`], [], "each"),
      centerlineLength: total(rows.map(r => r.centerline)),
      cutLength: total(rows.map(r => r.cutLength)), status: !supported ? "unsupported" : rows.some(r => r.cutLength.value === null) ? "unresolved" : "supported",
      reasons: unique(rows.flatMap(r => r.cutLength.reasons)) });
  }
  for (const productId of unique(input.fittings.map(f => f.productId))) {
    const rows = input.fittings.filter(f => f.productId === productId);
    const supported = products.get(productId)?.kind === "elbow_90";
    materials.push({ id: `fitting:${productId}`, kind: "fitting", productId, entityIds: rows.map(r => r.id),
      quantity: metric(rows.length, "confirmed_inputs", [], [], "each"), centerlineLength: null, cutLength: null,
      status: supported ? "supported" : "unsupported", reasons: supported ? [] : [productId === UNSELECTED_PRODUCT ? "Fitting product not selected" : `Unsupported fitting ${productId}`] });
  }
  for (const accessory of input.accessories) {
    const value = read(input, accessory.quantity, accessory.id);
    if (value.value !== null && (!Number.isSafeInteger(value.value) || value.value < 0)) throw new Error(`Invalid accessory count: ${accessory.id}`);
    materials.push({ id: accessory.id, kind: accessory.kind, productId: accessory.productId, entityIds: [accessory.id],
      quantity: metric(value.value, value.basis, value.reasons, value.evidenceIds, "each"), centerlineLength: null, cutLength: null,
      status: "unsupported", reasons: [accessory.reason || "Accessory installation is outside this catalog", ...value.reasons] });
  }
  if (input.nodes.some(n => n.datum === "scope_interface")) {
    for (const kind of ["other", "support"] as const) materials.push({
      id: `unresolved-${kind}`, kind, productId: null, entityIds: input.pieces.map(p => p.id),
      quantity: metric(null, "unknown", [kind === "other" ? "Physical joints, closure components and purchasing stock unresolved" : "Support requirements and quantities unresolved"], [], "each"),
      centerlineLength: null, cutLength: null, status: "unresolved", reasons: ["Drawing scope does not establish physical fabrication quantities"],
    });
  }
  if (joints.some(j => j.procedureId === "spears-fg3-socket-1in")) materials.push({ id: "consumable:cement", kind: "consumable", productId: CEMENT_ID,
    entityIds: joints.filter(j => j.procedureId === "spears-fg3-socket-1in").map(j => j.id), quantity: metric(null, "unknown", ["Cement purchase quantity is not estimated"], [], "each"),
    centerlineLength: null, cutLength: null, status: "unresolved", reasons: ["No stock or consumables optimization"] });
  const operations = buildOperations(input, cuts, joints, catalog);
  const gaps = [
    ...cuts.flatMap(c => c.cutLength.reasons.map(reason => ({ subjectId: c.pieceId, reason }))),
    ...materials.flatMap(m => m.reasons.map(reason => ({ subjectId: m.id, reason }))),
    ...operations.flatMap(o => o.reasons.map(reason => ({ subjectId: o.id, reason }))),
  ];
  return {
    schemaVersion: "fabrication/v1", projectId: input.projectId, packageId: input.packageId, planId: input.planId,
    baselinePlanId: input.baselinePlanId, intent: input.intent, inputRevision: input.inputRevision, configVersion: input.configVersion,
    sourceDrawing: { ...input.sourceDrawing }, planRole: input.planRole, selectedPlanId: input.selectedPlanId,
    siteEvidenceIds: [...input.siteEvidenceIds], evidenceClass: catalog.evidenceClass, frame: { ...input.frame },
    selectedProducts: structuredClone(catalog.products.filter(p => [...input.pieces, ...input.fittings].some(e => e.productId === p.id))),
    rounding: "none; metres in calculation; renderer must declare display rounding",
    quantityBasis: "modeled pieces/spans; physical splits and purchasing stock require separate detailing",
    fittings: input.fittings.map((f, i) => ({ ...structuredClone(f), callout: `F${i + 1}`,
      position: structuredClone(nodes.get(f.nodeId)!.position), jointIds: joints.filter(j => j.fittingId === f.id).map(j => j.id) })),
    materials, cuts, joints, operations,
    subassemblies: unique(input.pieces.map(p => p.subassemblyId)).map(id => ({ id,
      pieceIds: input.pieces.filter(p => p.subassemblyId === id).map(p => p.id), jointIds: joints.filter(j => j.subassemblyId === id).map(j => j.id) })),
    gaps, sources: structuredClone(catalog.sources.filter(source =>
      catalog.products.some(p => p.sourceIds.includes(source.id) && [...input.pieces, ...input.fittings].some(e => e.productId === p.id))
      || operations.some(o => o.sourceIds.includes(source.id)))), evidence: structuredClone(input.evidence), constructionApproval: "not_assessed",
  };
}

function buildOperations(input: FabricationInput, cuts: CutRow[], joints: Joint[], catalog: Catalog): Operation[] {
  const operations: Operation[] = [];
  const access = read(input, input.assemblyConditions.workAreaAccess, input.planId);
  const cure = read(input, input.assemblyConditions.curePlan, input.planId);
  const accessReasons = access.value === true && access.basis === "confirmed_inputs" ? [] : ["Confirm work-area access", ...access.reasons];
  const add = (code: string, pieceIds: string[], jointIds: string[], instruction: string, reasons: string[], supported = true, sourceIds = [PROCEDURE_SOURCE]) => {
    operations.push({ id: `op-${operations.length + 1}`, number: operations.length + 1, code, pieceIds, jointIds,
      predecessorId: operations.at(-1)?.id ?? null, instruction, sourceIds: supported ? sourceIds : [],
      status: !supported ? "unsupported" : reasons.length ? "needs_confirmation" : "planned", reasons: unique(reasons) });
  };
  for (const cut of cuts) {
    const product = catalog.products.find(p => p.id === cut.productId);
    const supported = product?.kind === "pipe" && product.preparation === "spears-fg3";
    const reasons = [...accessReasons, ...cut.cutLength.reasons,
      ...(cut.cutLength.basis === "proposed_inputs" ? ["Confirm proposed geometry before fabrication"] : []),
      ...(cut.disposition === "proposed_reuse" ? ["Reuse feasibility and condition require separate confirmation"] : [])];
    if (!supported) {
      add("resolve_preparation", [cut.pieceId], [], product ? "Confirm end preparation, threading method, tools and physical cut dimensions for the selected pipe."
        : `Detail cutting and end preparation for piece ${cut.callout} once its product and connection are selected.`,
        [...reasons, product ? "Pipe preparation needs a reviewed product-specific plan" : pipeReason(cut.productId)], false);
      continue;
    }
    add("cut_square", [cut.pieceId], [], `Cut piece ${cut.callout} square to the cut-list length with a suitable plastic-pipe tool.`, reasons, supported);
    add("deburr_bevel", [cut.pieceId], [], "Remove internal/external burrs and bevel the end approximately 10-15 degrees.", reasons, supported);
  }
  for (const joint of joints) {
    if (!joint.procedureId) {
      add("resolve_connection", [joint.pieceId], [joint.id], "Detail this connection and its installation procedure.", joint.reasons, false); continue;
    }
    const movement = read(input, input.assemblyConditions.jointMovement[joint.id], joint.id);
    const cut = cuts.find(c => c.pieceId === joint.pieceId)!;
    const reasons = [...accessReasons, ...joint.reasons,
      ...(cut.cutLength.basis === "proposed_inputs" ? ["Confirm proposed geometry before fabrication"] : []),
      ...(cut.disposition === "proposed_reuse" ? ["Reuse feasibility and condition require separate confirmation"] : []),
      ...(movement.value === true && movement.basis === "confirmed_inputs" ? [] : ["Confirm full insertion and quarter-turn movement in the stated sequence", ...movement.reasons]),
      ...(cure.value?.trim() && cure.basis === "confirmed_inputs" ? [] : ["Confirm the set/cure plan for temperature, fit, moisture, test pressure, and new-work versus cut-in conditions", ...cure.reasons])];
    if (joint.procedureId === "anvil-351-threaded") {
      const review = input.assemblyConditions.threadedJointPlan?.[joint.id];
      const fitting = input.fittings.find(f => f.id === joint.fittingId);
      const boundReview = review?.pipeProductId === cut.productId && review?.fittingProductId === fitting?.productId ? review : undefined;
      const plan = read(input, boundReview?.plan, joint.id);
      const threadMovement = read(input, boundReview?.movement, joint.id);
      // Fixed-end assembly is deliberately a separate owner/strategy (#29).
      const threadedReasons = [...accessReasons, ...joint.reasons,
        ...(cut.cutLength.basis === "proposed_inputs" ? ["Confirm proposed geometry before fabrication"] : []),
        ...(threadMovement.value === true && threadMovement.basis === "confirmed_inputs" ? [] : ["Confirm product-bound threaded-joint rotation and wrench access", ...threadMovement.reasons]),
        ...(plan.value?.trim() && plan.basis === "confirmed_inputs" ? [] : ["Confirm NPT end preparation, selected sealant, tools and product suitability", ...plan.reasons]),
        ...(cut.disposition === "proposed_reuse" ? ["Confirm reuse condition"] : [])];
      add("inspect_threads", [joint.pieceId], [joint.id], "Inspect and clean male/female threads; replace damaged components. Refer to Fig.351 page 4.", threadedReasons, true, [STEEL_ELBOW_SOURCE]);
      add("apply_thread_sealant", [joint.pieceId], [joint.id], "Apply the selected compatible sealant to male threads as specified by Fig.351 page 4 and the sealant manufacturer.", threadedReasons, true, [STEEL_ELBOW_SOURCE]);
      add("thread_joint", [joint.pieceId], [joint.id], `Assemble ${joint.id} in orientation ${joint.orientation ?? "unresolved"} under the reviewed joint plan; Fig.351 page 4 governs makeup. Rotation is not an axial cut datum.`, threadedReasons, true, [STEEL_ELBOW_SOURCE]);
      continue;
    }
    add("inspect_dry_fit_clean", [joint.pieceId], [joint.id], `Inspect ${joint.pieceId} and ${joint.fittingId}/${joint.portId}; check dry-fit interference, then clean and dry mating surfaces.`, reasons);
    add("apply_cement", [joint.pieceId], [joint.id], "Apply FS-5 to pipe and socket per FG-3; prevent cement pooling.", reasons);
    add("insert_rotate_hold", [joint.pieceId], [joint.id], `Immediately insert fully, rotating 1/4 turn during insertion. Align ${joint.orientation ?? "the orientation"}; hold 30 seconds. Inspect the continuous bead and remove exterior excess.`, reasons);
    add("set_and_cure", [joint.pieceId], [joint.id], `Keep the joint unstressed and follow the reviewed cure plan: ${cure.value ?? "unresolved"}. FG-3 governs handling and testing.`, reasons);
  }
  for (const accessory of input.accessories) add("resolve_accessory", accessory.attachedPieceIds, [],
    `Detail ${accessory.kind} ${accessory.id} and its installation.`, [accessory.reason], false);
  return operations;
}

export function isFresh(output: FabricationOutput, current: Pick<FabricationInput, "projectId" | "packageId" | "planId" | "inputRevision" | "configVersion">): boolean {
  return output.projectId === current.projectId && output.packageId === current.packageId && output.planId === current.planId
    && output.inputRevision === current.inputRevision && output.configVersion === current.configVersion;
}
