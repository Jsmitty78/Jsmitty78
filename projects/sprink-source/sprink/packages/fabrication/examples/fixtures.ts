import { ELBOW_ID, PIPE_ID } from "../src/catalog.js";
import type { FabricationInput, Value } from "../src/types.js";
export function confirmed<T>(value: T): Value<T> {
  return { value, status: "confirmed", evidenceIds: ["example-inputs"], reason: null };
}
/** Manufacturer dimensions; invented drawing and confirmation inputs. Not field evidence. */
export function drawingExample(): FabricationInput {
  const input: FabricationInput = {
    projectId: "example-project", packageId: "example-spool", planId: "baseline", baselinePlanId: "baseline",
    intent: "prepare_from_drawing", inputRevision: 1, configVersion: "example-config-1",
    sourceDrawing: { id: "example-drawing", revision: "A", approval: "approved" }, planRole: "baseline",
    selectedPlanId: null, siteEvidenceIds: [], frame: { id: "example-room", lengthUnit: "in" },
    nodes: [
      { id: "a", datum: "physical_pipe_end", position: confirmed({ x: 0, y: 0, z: 0, unit: "in", frameId: "example-room" }) },
      { id: "b", datum: "fitting_center", position: confirmed({ x: 24, y: 0, z: 0, unit: "in", frameId: "example-room" }) },
      { id: "c", datum: "physical_pipe_end", position: confirmed({ x: 24, y: 18, z: 0, unit: "in", frameId: "example-room" }) },
    ],
    pieces: [
      { id: "p1", sourceSegmentIds: ["source-1"], productId: PIPE_ID, startNodeId: "a", endNodeId: "b", subassemblyId: "spool-1", disposition: "new" },
      { id: "p2", sourceSegmentIds: ["source-2"], productId: PIPE_ID, startNodeId: "b", endNodeId: "c", subassemblyId: "spool-1", disposition: "new" },
    ],
    fittings: [{ id: "f1", sourceEntityIds: ["source-elbow"], productId: ELBOW_ID, nodeId: "b", ports: [
      { id: "in", pieceId: "p1", end: "end", location: "shop" }, { id: "out", pieceId: "p2", end: "start", location: "shop" },
    ] }],
    accessories: [], evidence: [],
    assemblyConditions: {
      workAreaAccess: confirmed(true), jointMovement: { "f1/in": confirmed(true), "f1/out": confirmed(true) },
      curePlan: confirmed("Example only: new dry assembly, 70 F, normal fit; review moisture/humidity. FG-3 pp27-28 Table 1: minimum 90 minutes for 1 inch at up to 225 psi; initial unstressed set per Step 6. Qualified installer confirms actual conditions before use."),
    },
  };
  input.evidence = [{ id: "example-inputs", subjectIds: ["baseline", "a", "b", "c", "f1/in", "f1/out"],
    description: "Invented drawing and explicit confirmation fixture; not a site observation or approved real drawing." }];
  return input;
}
/** Selected proposal fixture, not a candidate generator or an as-built observation. */
export function adaptationExample(): FabricationInput {
  const input = drawingExample();
  input.planId = "candidate-a"; input.intent = "adapt_to_site"; input.planRole = "candidate";
  input.selectedPlanId = "candidate-a"; input.siteEvidenceIds = ["example-duct"];
  input.evidence.push({ id: "example-duct", subjectIds: ["duct-1"], description: "Synthetic discrepancy input; candidate generation is owned by #9." });
  input.evidence[0].subjectIds.push("candidate-a");
  input.nodes = [input.nodes[0],
    { id: "d", datum: "fitting_center", position: { value: { x: 0, y: 12, z: 0, unit: "in", frameId: "example-room" }, status: "proposed", evidenceIds: [], reason: "Candidate geometry" } },
    { id: "e", datum: "fitting_center", position: { value: { x: 24, y: 12, z: 0, unit: "in", frameId: "example-room" }, status: "proposed", evidenceIds: [], reason: "Candidate geometry" } },
    input.nodes[2]];
  input.pieces = [
    { ...input.pieces[0], id: "q1", endNodeId: "d" },
    { ...input.pieces[0], id: "q2", startNodeId: "d", endNodeId: "e" },
    { ...input.pieces[1], id: "q3", startNodeId: "e" },
  ];
  input.fittings = [
    { id: "f2", sourceEntityIds: ["source-elbow"], nodeId: "d", productId: ELBOW_ID, ports: [
      { id: "in", pieceId: "q1", end: "end", location: "shop" }, { id: "out", pieceId: "q2", end: "start", location: "shop" }] },
    { id: "f3", sourceEntityIds: [], nodeId: "e", productId: ELBOW_ID, ports: [
      { id: "in", pieceId: "q2", end: "end", location: "shop" }, { id: "out", pieceId: "q3", end: "start", location: "field" }] },
  ];
  input.assemblyConditions.jointMovement = {};
  return input;
}
