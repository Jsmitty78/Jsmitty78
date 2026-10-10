import type { Fact, GenerateInput, Point } from "../src/index.js";

/** Synthetic arithmetic fixture, NOT manufacturer dimensions or a construction detail. */
export const fact = <T>(value: T): Fact<T> => ({ value, confirmed: true, source: "fixture", evidenceIds: ["synthetic-arithmetic-v1"] });
export const p = (x: number, y: number, z: number): Point => ({ x, y, z, unit: "m", frameId: "room-frame" });
export function ductFixture(): GenerateInput {
  return {
    projectId: "project", packageId: "package", inputRevision: 7, configVersion: "synthetic-config-1",
    intent: "adapt_to_site", targetSegmentId: "pipe", fixedConnectionNodeIds: ["a", "b"], protectedSegmentIds: [],
    baseline: {
      id: "approved-plan", coordinateFrame: fact({ id: "room-frame", lengthUnit: "m" }),
      nodes: [
        { id: "a", kind: "tie_in", position: fact(p(0, 0, 0)), tieInNetCutOffset: fact({ value: 0.05, unit: "m" }) },
        { id: "b", kind: "tie_in", position: fact(p(10, 0, 0)), tieInNetCutOffset: fact({ value: 0.05, unit: "m" }) },
      ],
      segments: [{ id: "pipe", startNodeId: "a", endNodeId: "b", outsideDiameter: fact({ value: 0.2, unit: "m" }), cutEndDatumAtStart: fact("center_to_center"), cutEndDatumAtEnd: fact("center_to_center"), productId: "synthetic-pipe" }],
      fittings: [],
      ducts: [{ id: "duct", roomId: "room", geometry: fact({ kind: "axis_aligned_box", min: p(4, -0.4, -0.5), max: p(6, 0.4, 0.5) }) }],
      heads: [{ headId: "head", attachedNodeId: "b", position: fact(p(10, 0, 0)) }],
    },
    workEnvelope: fact({ kind: "axis_aligned_box", min: p(-0.2, -2.8, -0.3), max: p(10.2, 2.3, 0.3) }),
    requiredPipeClearance: fact({ value: 0.1, unit: "m" }),
    product: {
      compatibility: fact({ pipeProductId: "synthetic-pipe", elbowProductId: "synthetic-elbow", connectionMethod: "synthetic-test-only" }),
      centerToFace: fact({ value: 0.15, unit: "m" }), insertionOrThreadMakeup: fact({ value: 0.05, unit: "m" }),
    },
  };
}

// Independent hand calculations; these constants are never produced by the generator.
export const EXPECTED = {
  baseline: { centerline: 10, cut: 9.9 },
  "detour:y+": {
    points: [[0, 0, 0], [1.9, 0, 0], [1.9, 1.4, 0], [8.1, 1.4, 0], [8.1, 0, 0], [10, 0, 0]],
    lengths: [1.9, 1.4, 6.2, 1.4, 1.9], cuts: [1.75, 1.2, 6, 1.2, 1.75], centerline: 12.8, cut: 11.9, delta: 2.8,
  },
  "detour:y-": {
    points: [[0, 0, 0], [1.9, 0, 0], [1.9, -1.65, 0], [8.1, -1.65, 0], [8.1, 0, 0], [10, 0, 0]],
    lengths: [1.9, 1.65, 6.2, 1.65, 1.9], cuts: [1.75, 1.45, 6, 1.45, 1.75], centerline: 13.3, cut: 12.4, delta: 3.3,
  },
} as const;
