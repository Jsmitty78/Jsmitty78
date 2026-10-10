import type { Fact } from "./types.js";

export type LocalLengthUnit = "m" | "mm" | "ft" | "in";
export interface LocalPoint3 {
  x: number;
  y: number;
  z: number;
  unit: LocalLengthUnit;
  frameId: string;
}
export interface LocalLength {
  value: number;
  unit: LocalLengthUnit;
}

export interface LocalPlanNode {
  id: string;
  kind: "fitting_center" | "tie_in" | "other";
  position: Fact<LocalPoint3>;
  fittingId?: string;
  /** Offset from the tie-in center datum to the physical pipe cut end. */
  tieInNetCutOffset?: Fact<LocalLength>;
}

export interface LocalPipeSegment {
  id: string;
  startNodeId: string;
  endNodeId: string;
  outsideDiameter: Fact<LocalLength>;
  /** The cut calculation accepts center-to-center graph endpoints only; other datums are not normalized. */
  cutEndDatumAtStart: Fact<"center_to_center" | "physical_pipe_end">;
  cutEndDatumAtEnd: Fact<"center_to_center" | "physical_pipe_end">;
}

export interface LocalElbowPort {
  segmentId: string;
  endpoint: "start" | "end";
  nodeId: string;
  centerToFace: Fact<LocalLength>;
  insertionOrThreadMakeup: Fact<LocalLength>;
}

export interface LocalFitting {
  id: string;
  kind: Fact<"elbow_90" | "unsupported">;
  centerNodeId: string;
  ports: readonly [LocalElbowPort, LocalElbowPort];
}

export interface LocalDuctBox {
  id: string;
  roomId: string;
  geometry: Fact<
    | { kind: "axis_aligned_box"; min: LocalPoint3; max: LocalPoint3 }
    | { kind: "unsupported" }
  >;
}

/** Pure, source-neutral geometry input. Evidence scope/uniqueness is validated by the project evaluator. */
export interface LocalPlanGeometry {
  id: string;
  coordinateFrame: Fact<{ id: string; lengthUnit: LocalLengthUnit }>;
  nodes: readonly LocalPlanNode[];
  segments: readonly LocalPipeSegment[];
  fittings: readonly LocalFitting[];
  ducts: readonly LocalDuctBox[];
}

export interface LocalSegmentMetric {
  segmentId: string;
  centerlineLengthM: number | null;
  cutLengthM: number | null;
  outsideDiameterM: number | null;
  state: "verified" | "input_missing" | "unsupported";
  missingInputs: string[];
}

export interface LocalDuctClearance {
  segmentId: string;
  ductId: string;
  state: "collision" | "clear" | "input_missing" | "unsupported";
  distanceM?: number;
  radiusM?: number;
  marginM?: number;
  missingInputs: string[];
}

export interface LocalPlanGeometryResult {
  planId: string;
  state: "verified" | "input_missing" | "unsupported";
  segmentCount: number;
  elbowCount: number;
  totalCenterlineLengthM: number | null;
  totalCutLengthM: number | null;
  segments: LocalSegmentMetric[];
  ductClearances: LocalDuctClearance[];
  missingInputs: string[];
  unsupported: string[];
}

export interface LocalPlanGeometryDelta {
  baselinePlanId: string;
  proposedPlanId: string;
  state: "verified" | "input_missing" | "unsupported";
  pipeCountDelta: number | null;
  elbowCountDelta: number | null;
  centerlineLengthDeltaM: number | null;
  cutLengthDeltaM: number | null;
}

export class LocalGeometryInputError extends Error {
  constructor(message: string, readonly path: string) {
    super(message);
    this.name = "LocalGeometryInputError";
  }
}

const TO_METERS: Readonly<Record<LocalLengthUnit, number>> = Object.freeze({ m: 1, mm: 0.001, ft: 0.3048, in: 0.0254 });

function readFact<T>(fact: Fact<T> | undefined, path: string, missing: string[]): T | undefined {
  if (!fact || fact.value === null || !fact.confirmed || fact.source === "model" || fact.evidenceIds.length === 0) {
    missing.push(path);
    return undefined;
  }
  return fact.value;
}

function assertFiniteNonnegative(value: number, path: string, allowZero = true): void {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new LocalGeometryInputError(`${path} must be finite and ${allowZero ? "non-negative" : "positive"}.`, path);
  }
}

function toMeters(length: LocalLength, path: string, allowZero = true): number {
  assertFiniteNonnegative(length.value, `${path}.value`, allowZero);
  const converted = length.value * TO_METERS[length.unit];
  if (!Number.isFinite(converted)) throw new LocalGeometryInputError(`${path} cannot be normalized to metres.`, path);
  return converted;
}

function normalizedPoint(point: LocalPoint3, frameId: string, path: string): [number, number, number] {
  if (point.frameId !== frameId) throw new LocalGeometryInputError("Coordinate frame does not match the plan frame.", `${path}.frameId`);
  const coords = [point.x, point.y, point.z];
  coords.forEach((value, i) => {
    if (!Number.isFinite(value)) throw new LocalGeometryInputError("Coordinates must be finite.", `${path}.${["x", "y", "z"][i]}`);
  });
  const factor = TO_METERS[point.unit];
  const converted = coords.map(value => value * factor) as [number, number, number];
  if (!converted.every(Number.isFinite)) throw new LocalGeometryInputError("Coordinates cannot be normalized to metres.", path);
  return converted;
}

function axisForSegment(start: readonly number[], end: readonly number[], path: string): 0 | 1 | 2 | null {
  const changed = [0, 1, 2].filter(axis => start[axis] !== end[axis]);
  if (changed.length === 0) throw new LocalGeometryInputError("Pipe segment must have non-zero length.", path);
  if (changed.length > 1) return null;
  if (!Number.isFinite(end[changed[0]!]! - start[changed[0]!]!)) {
    throw new LocalGeometryInputError("Segment length overflowed numeric range.", path);
  }
  return changed[0] as 0 | 1 | 2;
}

function distanceBetweenAxisSegmentAndBox(
  start: readonly number[],
  end: readonly number[],
  min: readonly number[],
  max: readonly number[],
  path: string,
): number | null {
  const axis = axisForSegment(start, end, path);
  if (axis === null) return null;
  const low = Math.min(start[axis], end[axis]);
  const high = Math.max(start[axis], end[axis]);
  const gapOnAxis = high < min[axis] ? min[axis] - high : max[axis] < low ? low - max[axis] : 0;
  let squared = gapOnAxis * gapOnAxis;
  for (const otherAxis of [0, 1, 2] as const) {
    if (otherAxis === axis) continue;
    const coordinate = start[otherAxis];
    const gap = coordinate < min[otherAxis] ? min[otherAxis] - coordinate : coordinate > max[otherAxis] ? coordinate - max[otherAxis] : 0;
    squared += gap * gap;
  }
  const distance = Math.sqrt(squared);
  if (!Number.isFinite(distance)) throw new LocalGeometryInputError("Segment-to-box distance overflowed numeric range.", path);
  return distance;
}

interface SegmentInternal {
  input: LocalPipeSegment;
  startNode: LocalPlanNode;
  endNode: LocalPlanNode;
  start: [number, number, number];
  end: [number, number, number];
  axis: 0 | 1 | 2 | null;
  centerlineLengthM?: number;
  takeoutStartM?: number;
  takeoutEndM?: number;
  outsideDiameterM?: number;
  missing: string[];
  cutMissing: string[];
  unsupported: string[];
}

function assertUniqueIds(values: readonly { id: string }[], path: string): void {
  const ids = new Set<string>();
  values.forEach((item, index) => {
    if (!item.id.trim()) throw new LocalGeometryInputError("ID must not be empty.", `${path}[${index}].id`);
    if (ids.has(item.id)) throw new LocalGeometryInputError(`Duplicate ID '${item.id}'.`, `${path}[${index}].id`);
    ids.add(item.id);
  });
}

/** Calculates only confirmed axis-parallel centerline/cut metrics and pipe-envelope-vs-box clearance. */
export function evaluateLocalPlanGeometry(input: LocalPlanGeometry): LocalPlanGeometryResult {
  assertUniqueIds(input.nodes, "nodes");
  assertUniqueIds(input.segments, "segments");
  assertUniqueIds(input.fittings, "fittings");
  assertUniqueIds(input.ducts, "ducts");

  const missing: string[] = [];
  const unsupported: string[] = [];
  const frame = readFact(input.coordinateFrame, "coordinateFrame", missing);
  if (!frame) {
    return {
      planId: input.id, state: "input_missing", segmentCount: input.segments.length, elbowCount: input.fittings.length,
      totalCenterlineLengthM: null, totalCutLengthM: null, segments: [], ductClearances: [], missingInputs: missing, unsupported,
    };
  }
  if (!frame.id.trim()) throw new LocalGeometryInputError("Frame ID must not be empty.", "coordinateFrame.value.id");

  const nodes = new Map(input.nodes.map(node => [node.id, node]));
  const fittings = new Map(input.fittings.map(fitting => [fitting.id, fitting]));
  const segments = new Map(input.segments.map(segment => [segment.id, segment]));
  const nodePoints = new Map<string, [number, number, number]>();
  for (const [index, node] of input.nodes.entries()) {
    const path = `nodes[${index}]`;
    const point = readFact(node.position, `${path}.position`, missing);
    if (point) nodePoints.set(node.id, normalizedPoint(point, frame.id, `${path}.position.value`));
  }

  const internal: SegmentInternal[] = input.segments.map((segment, index) => {
    const path = `segments[${index}]`;
    const startNode = nodes.get(segment.startNodeId);
    const endNode = nodes.get(segment.endNodeId);
    if (!startNode) throw new LocalGeometryInputError(`Unresolved start node '${segment.startNodeId}'.`, `${path}.startNodeId`);
    if (!endNode) throw new LocalGeometryInputError(`Unresolved end node '${segment.endNodeId}'.`, `${path}.endNodeId`);
    if (segment.startNodeId === segment.endNodeId) throw new LocalGeometryInputError("Segment start and end nodes must differ.", path);
    const segmentMissing: string[] = [];
    const cutMissing: string[] = [];
    const segmentUnsupported: string[] = [];
    const start = nodePoints.get(startNode.id);
    const end = nodePoints.get(endNode.id);
    if (!start || !end) {
      const positionMissing = [...(!start ? [`${path}.start.position`] : []), ...(!end ? [`${path}.end.position`] : [])];
      segmentMissing.push(...positionMissing);
      cutMissing.push(...positionMissing);
    }
    let axis: 0 | 1 | 2 | null = null;
    let centerlineLengthM: number | undefined;
    if (start && end) {
      axis = axisForSegment(start, end, `${path}.geometry`);
      if (axis === null) segmentUnsupported.push(`${path}.geometry`);
      else centerlineLengthM = Math.abs(end[axis] - start[axis]);
    }
    const diameter = readFact(segment.outsideDiameter, `${path}.outsideDiameter`, segmentMissing);
    const outsideDiameterM = diameter ? toMeters(diameter, `${path}.outsideDiameter.value`, false) : undefined;
    const fittingNodes = [startNode, endNode].filter(node => node.kind === "fitting_center");
    for (const node of fittingNodes) {
      if (!node.fittingId || !fittings.has(node.fittingId)) throw new LocalGeometryInputError("Fitting-center node must reference exactly one fitting.", `${path}.nodeId`);
    }
    for (const node of [startNode, endNode]) {
      if (node.kind === "other") segmentUnsupported.push(`${path}.node:${node.id}`);
    }
    return {
      input: segment, startNode, endNode, start: start ?? [0, 0, 0], end: end ?? [0, 0, 0], axis,
      ...(centerlineLengthM !== undefined ? { centerlineLengthM } : {}),
      outsideDiameterM,
      missing: segmentMissing,
      cutMissing,
      unsupported: segmentUnsupported,
    };
  });

  const portMap = new Map<string, LocalElbowPort>();
  const usedSegmentEnds = new Set<string>();
  for (const [index, fitting] of input.fittings.entries()) {
    const path = `fittings[${index}]`;
    const kind = readFact(fitting.kind, `${path}.kind`, missing);
    const centerNode = nodes.get(fitting.centerNodeId);
    if (!centerNode) throw new LocalGeometryInputError(`Unresolved fitting center node '${fitting.centerNodeId}'.`, `${path}.centerNodeId`);
    if (centerNode.kind !== "fitting_center" || centerNode.fittingId !== fitting.id) {
      throw new LocalGeometryInputError("Fitting must resolve to its matching fitting-center node.", `${path}.centerNodeId`);
    }
    if (kind !== "elbow_90") {
      for (const port of fitting.ports) {
        const endKey = `${port.segmentId}:${port.endpoint}`;
        if (usedSegmentEnds.has(endKey)) throw new LocalGeometryInputError("Segment endpoint is attached to more than one fitting port.", `${path}.ports`);
        usedSegmentEnds.add(endKey);
        const segment = segments.get(port.segmentId);
        if (!segment) throw new LocalGeometryInputError(`Unresolved segment '${port.segmentId}'.`, `${path}.ports.segmentId`);
        const nodeId = port.endpoint === "start" ? segment.startNodeId : segment.endNodeId;
        if (port.nodeId !== centerNode.id || nodeId !== centerNode.id) throw new LocalGeometryInputError("Fitting port must reference the attached segment endpoint at this fitting center.", `${path}.ports.nodeId`);
        const segmentData = internal.find(entry => entry.input.id === segment.id)!;
        if (!kind) segmentData.missing.push(`${path}.kind`);
        else segmentData.unsupported.push(`${path}.kind`);
        portMap.set(endKey, port);
      }
      if (kind === "unsupported") unsupported.push(`${path}.kind`);
      continue;
    }
    const center = nodePoints.get(centerNode.id);
    if (!center) missing.push(`${path}.center`);
    const ports = fitting.ports;
    if (ports.length !== 2) throw new LocalGeometryInputError("A supported 90-degree elbow must have exactly two ports.", `${path}.ports`);
    const portAxes: number[] = [];
    for (const [portIndex, port] of ports.entries()) {
      const endKey = `${port.segmentId}:${port.endpoint}`;
      if (usedSegmentEnds.has(endKey)) throw new LocalGeometryInputError("Segment endpoint is attached to more than one fitting port.", `${path}.ports[${portIndex}]`);
      usedSegmentEnds.add(endKey);
      const segment = segments.get(port.segmentId);
      if (!segment) throw new LocalGeometryInputError(`Unresolved segment '${port.segmentId}'.`, `${path}.ports[${portIndex}].segmentId`);
      const nodeId = port.endpoint === "start" ? segment.startNodeId : segment.endNodeId;
      if (port.nodeId !== centerNode.id || nodeId !== centerNode.id) throw new LocalGeometryInputError("Fitting port must reference the attached segment endpoint at this fitting center.", `${path}.ports[${portIndex}].nodeId`);
      const segmentData = internal.find(entry => entry.input.id === segment.id)!;
      if (!center) segmentData.missing.push(`${path}.center`);
      if (!center) segmentData.cutMissing.push(`${path}.center`);
      if (segmentData.axis !== null) portAxes.push(segmentData.axis);
      const centerToFace = readFact(port.centerToFace, `${path}.ports[${portIndex}].centerToFace`, segmentData.cutMissing);
      const makeup = readFact(port.insertionOrThreadMakeup, `${path}.ports[${portIndex}].insertionOrThreadMakeup`, segmentData.cutMissing);
      if (centerToFace && makeup) {
        const net = toMeters(centerToFace, `${path}.ports[${portIndex}].centerToFace.value`) - toMeters(makeup, `${path}.ports[${portIndex}].insertionOrThreadMakeup.value`);
        if (net < 0) throw new LocalGeometryInputError("Insertion/thread makeup cannot exceed center-to-face dimension.", `${path}.ports[${portIndex}]`);
        if (port.endpoint === "start") segmentData.takeoutStartM = net;
        else segmentData.takeoutEndM = net;
      }
      portMap.set(endKey, port);
    }
    if (portAxes.length === 2 && portAxes[0] === portAxes[1]) {
      for (const port of ports) internal.find(entry => entry.input.id === port.segmentId)?.unsupported.push(`${path}.geometry`);
      unsupported.push(`${path}.geometry`);
    }
  }

  for (const segment of internal) {
    for (const node of [segment.startNode, segment.endNode]) {
      if (node.kind === "fitting_center" && !portMap.has(`${segment.input.id}:${node === segment.startNode ? "start" : "end"}`)) {
        throw new LocalGeometryInputError("Fitting-connected segment endpoint has no fitting port record.", `segments.${segment.input.id}`);
      }
      if (node.kind === "tie_in") {
        const fact = node.tieInNetCutOffset;
        const value = readFact(fact, `nodes.${node.id}.tieInNetCutOffset`, segment.cutMissing);
        if (value) {
          const net = toMeters(value, `nodes.${node.id}.tieInNetCutOffset.value`);
          if (node === segment.startNode) segment.takeoutStartM = net;
          else segment.takeoutEndM = net;
        }
      }
    }
  }

  const segmentResults: LocalSegmentMetric[] = internal.map(segment => {
    const missingForSegment = [...new Set([...segment.missing, ...segment.cutMissing])];
    const startDatum = readFact(segment.input.cutEndDatumAtStart, `segments.${segment.input.id}.cutEndDatumAtStart`, segment.cutMissing);
    const endDatum = readFact(segment.input.cutEndDatumAtEnd, `segments.${segment.input.id}.cutEndDatumAtEnd`, segment.cutMissing);
    if (startDatum && startDatum !== "center_to_center") {
      segment.unsupported.push(`segments.${segment.input.id}.cutEndDatumAtStart`);
      unsupported.push(`segments.${segment.input.id}.cutEndDatumAtStart`);
    }
    if (endDatum && endDatum !== "center_to_center") {
      segment.unsupported.push(`segments.${segment.input.id}.cutEndDatumAtEnd`);
      unsupported.push(`segments.${segment.input.id}.cutEndDatumAtEnd`);
    }
    const cutLengthM = segment.centerlineLengthM === undefined || segment.takeoutStartM === undefined || segment.takeoutEndM === undefined || segment.cutMissing.length > 0 || segment.unsupported.length > 0
      ? undefined
      : segment.centerlineLengthM - segment.takeoutStartM - segment.takeoutEndM;
    // Datum checks are appended above, so include them in this segment's emitted missing paths.
    missingForSegment.push(...segment.cutMissing);
    const uniqueMissingForSegment = [...new Set(missingForSegment)];
    if (segment.takeoutStartM === undefined || segment.takeoutEndM === undefined) {
      if (!uniqueMissingForSegment.includes(`segments.${segment.input.id}.takeout`)) uniqueMissingForSegment.push(`segments.${segment.input.id}.takeout`);
    }
    if (cutLengthM !== undefined && cutLengthM <= 0) {
      throw new LocalGeometryInputError("Net takeouts must leave a positive pipe cut length.", `segments.${segment.input.id}`);
    }
    const state = segment.unsupported.length ? "unsupported" : uniqueMissingForSegment.length ? "input_missing" : "verified";
    return {
      segmentId: segment.input.id,
      centerlineLengthM: segment.centerlineLengthM ?? null,
      cutLengthM: cutLengthM ?? null,
      outsideDiameterM: segment.outsideDiameterM ?? null,
      state,
      missingInputs: uniqueMissingForSegment,
    };
  });

  const clearances: LocalDuctClearance[] = [];
  for (const segment of internal) {
    for (const [ductIndex, duct] of input.ducts.entries()) {
      const path = `ducts[${ductIndex}]`;
      const clearanceMissing: string[] = [];
      const geometry = readFact(duct.geometry, `${path}.geometry`, clearanceMissing);
      const startNode = nodePoints.get(segment.startNode.id);
      const endNode = nodePoints.get(segment.endNode.id);
      const diameter = segment.outsideDiameterM;
      if (geometry?.kind === "unsupported") {
        clearances.push({ segmentId: segment.input.id, ductId: duct.id, state: "unsupported", missingInputs: [`${path}.geometry`] });
        continue;
      }
      if (!startNode || !endNode) clearanceMissing.push(`segments.${segment.input.id}.endpoints`);
      if (diameter === undefined) clearanceMissing.push(`segments.${segment.input.id}.outsideDiameter`);
      if (!geometry || clearanceMissing.length) {
        clearances.push({ segmentId: segment.input.id, ductId: duct.id, state: "input_missing", missingInputs: [...new Set(clearanceMissing)] });
        continue;
      }
      const min = normalizedPoint(geometry.min, frame.id, `${path}.geometry.value.min`);
      const max = normalizedPoint(geometry.max, frame.id, `${path}.geometry.value.max`);
      if ([0, 1, 2].some(axis => min[axis] > max[axis])) throw new LocalGeometryInputError("Duct box minimum must not exceed maximum.", path);
      try {
        const distanceM = distanceBetweenAxisSegmentAndBox(startNode!, endNode!, min, max, `segments.${segment.input.id}.geometry`);
        if (distanceM === null) {
          clearances.push({ segmentId: segment.input.id, ductId: duct.id, state: "unsupported", missingInputs: [`segments.${segment.input.id}.geometry`] });
          continue;
        }
        const radiusM = diameter! / 2;
        const marginM = distanceM - radiusM;
        if (!Number.isFinite(marginM)) throw new LocalGeometryInputError("Pipe-to-duct clearance overflowed numeric range.", `segments.${segment.input.id}.geometry`);
        clearances.push({
          segmentId: segment.input.id,
          ductId: duct.id,
          state: marginM <= 0 ? "collision" : "clear",
          distanceM,
          radiusM,
          marginM,
          missingInputs: [],
        });
      } catch (error) {
        if (error instanceof LocalGeometryInputError) {
          clearances.push({ segmentId: segment.input.id, ductId: duct.id, state: "unsupported", missingInputs: [error.path] });
        } else throw error;
      }
    }
  }

  const missingInputs = [...new Set([...missing, ...segmentResults.flatMap(result => result.missingInputs), ...clearances.flatMap(result => result.missingInputs)])];
  const allStates = [...segmentResults.map(result => result.state), ...clearances.map(result => result.state)];
  const state = unsupported.length || allStates.includes("unsupported") ? "unsupported" : missingInputs.length || allStates.includes("input_missing") ? "input_missing" : "verified";
  const totalCenterlineLengthM = segmentResults.every(result => result.centerlineLengthM !== null)
    ? segmentResults.reduce((sum, result) => sum + result.centerlineLengthM!, 0)
    : null;
  const totalCutLengthM = segmentResults.every(result => result.cutLengthM !== null)
    ? segmentResults.reduce((sum, result) => sum + result.cutLengthM!, 0)
    : null;
  if ((totalCenterlineLengthM !== null && !Number.isFinite(totalCenterlineLengthM)) || (totalCutLengthM !== null && !Number.isFinite(totalCutLengthM))) {
    throw new LocalGeometryInputError("Summed route length overflowed numeric range.", "segments");
  }
  return {
    planId: input.id,
    state,
    segmentCount: input.segments.length,
    elbowCount: input.fittings.filter(fitting => fitting.kind.value === "elbow_90" && fitting.kind.confirmed && fitting.kind.source !== "model").length,
    totalCenterlineLengthM,
    totalCutLengthM,
    segments: segmentResults,
    ductClearances: clearances,
    missingInputs,
    unsupported: [...new Set(unsupported)],
  };
}

export function compareLocalPlanGeometry(baseline: LocalPlanGeometryResult, proposed: LocalPlanGeometryResult): LocalPlanGeometryDelta {
  const elbowCountKnown = (result: LocalPlanGeometryResult) =>
    ![...result.missingInputs, ...result.unsupported].some(path => path.startsWith("fittings[") && path.includes("].kind"));
  const state = baseline.state === "unsupported" || proposed.state === "unsupported"
    ? "unsupported"
    : baseline.state !== "verified" || proposed.state !== "verified"
      ? "input_missing"
      : "verified";
  return {
    baselinePlanId: baseline.planId,
    proposedPlanId: proposed.planId,
    state,
    pipeCountDelta: proposed.segmentCount - baseline.segmentCount,
    elbowCountDelta: elbowCountKnown(baseline) && elbowCountKnown(proposed) ? proposed.elbowCount - baseline.elbowCount : null,
    centerlineLengthDeltaM: baseline.totalCenterlineLengthM !== null && proposed.totalCenterlineLengthM !== null
      ? proposed.totalCenterlineLengthM - baseline.totalCenterlineLengthM
      : null,
    cutLengthDeltaM: baseline.totalCutLengthM !== null && proposed.totalCutLengthM !== null
      ? proposed.totalCutLengthM - baseline.totalCutLengthM
      : null,
  };
}
