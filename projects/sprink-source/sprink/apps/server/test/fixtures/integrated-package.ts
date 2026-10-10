import type { PackageInputs, PackagePlan } from "@sprink/core";
import { PIPE_ID, ELBOW_ID } from "@sprink/fabrication";
const point = (x: number, y = 0, z = 0) => ({ x, y, z });
const frame = {
  id: "room",
  lengthUnit: "mm" as const,
  axes: "right_handed_z_up" as const,
};
const port = (id: string, x: number, y = 0) => ({
  id,
  position: point(x, y),
  unknownReason: null,
});
const pipe = (
  id: string,
  a: ReturnType<typeof point>,
  b: ReturnType<typeof point>,
) => ({
  id,
  kind: "pipe" as const,
  productId: PIPE_ID,
  ports: [
    { id: "start", position: a, unknownReason: null },
    { id: "end", position: b, unknownReason: null },
  ],
});
/** Actual manufacturer dimensions, invented drawing/site confirmations. No field approval. */
export function integratedInput(
  assetId: string,
  scenario: 2 | 3 = 2,
  openSpool = false,
): PackageInputs {
  const baseline: PackagePlan = {
    id: "baseline",
    coordinateFrame: frame,
    confirmation: "confirmed",
    entities: [],
    connections: [],
  };
  if (openSpool) {
    baseline.entities = [
      pipe("p1", point(0), point(609.6)),
      pipe("p2", point(609.6), point(609.6, 457.2)),
      {
        id: "f1",
        kind: "fitting",
        productId: ELBOW_ID,
        ports: [port("in", 609.6), port("out", 609.6)],
      },
    ];
    baseline.connections = [
      {
        id: "j1",
        from: { entityId: "p1", portId: "end" },
        to: { entityId: "f1", portId: "in" },
      },
      {
        id: "j2",
        from: { entityId: "p2", portId: "start" },
        to: { entityId: "f1", portId: "out" },
      },
    ];
  } else {
    baseline.entities = [
      pipe("pipe", point(0), point(10000)),
      { id: "a", kind: "tie_in", productId: null, ports: [port("socket", 0)] },
      {
        id: "b",
        kind: "tie_in",
        productId: null,
        ports: [port("socket", 10000)],
      },
    ];
    baseline.connections = [
      {
        id: "a-joint",
        from: { entityId: "pipe", portId: "start" },
        to: { entityId: "a", portId: "socket" },
      },
      {
        id: "b-joint",
        from: { entityId: "pipe", portId: "end" },
        to: { entityId: "b", portId: "socket" },
      },
    ];
  }
  const facts: PackageInputs["detailing"] = [];
  const add = (
    field: string,
    value: string | boolean | number,
    subjects: string[] = [],
    unit: string | null = null,
  ) => {
    facts.push({
      id: `fact-${facts.length}`,
      field,
      value,
      subjectIds: subjects,
      unit,
      unknownReason: null,
      confirmation: "confirmed",
      context: "detailing",
      source: {
        description:
          "Invented acceptance fixture confirmation, not field evidence",
        assetId: null,
        page: null,
      },
    });
  };
  for (const p of baseline.entities.filter((e) => e.kind === "pipe")) {
    add(
      "datum.start",
      openSpool && p.id === "p1" ? "physical_pipe_end" : "center_to_center",
      [p.id],
    );
    add(
      "datum.end",
      openSpool && p.id === "p2" ? "physical_pipe_end" : "center_to_center",
      [p.id],
    );
  }
  if (!openSpool) {
    add("netCutOffset", 50, ["a"], "mm");
    add("netCutOffset", 50, ["b"], "mm");
  }
  add("workAreaAccess", true);
  add(
    "curePlan",
    "Invented new-work fixture: FG-3 pp27-28, 70 F, dry normal fit, 1 inch, up to 225 psi, minimum 90 minutes. Not a field confirmation.",
  );
  if (openSpool) {
    add("movement.in", true, ["f1"]);
    add("movement.out", true, ["f1"]);
  }
  add("jurisdiction", "san_francisco");
  add("standard", "nfpa13");
  add("permitKind", "revision");
  add("originalNfpa13Edition", "2025");
  add("originalFirePermitNumber", "FIXTURE-ONLY");
  add("systemType", "wet");
  add("sprinklerType", "standard_spray");
  add("storage", "non_storage");
  if (scenario === 3) {
    for (const [prefix, values] of [
      ["duct", [4000, -400, -500, 6000, 400, 500]],
      ["workEnvelope", [-200, -2800, -300, 10200, 2300, 300]],
    ] as const) {
      ["min.x", "min.y", "min.z", "max.x", "max.y", "max.z"].forEach((k, i) =>
        add(`${prefix}.${k}`, values[i], [], "mm"),
      );
    }
    add("requiredPipeClearance", 100, [], "mm");
  }
  return {
    title: openSpool
      ? "Assumed open-end CPVC spool"
      : "Fixed-end CPVC work area",
    sourceDrawing: {
      assetId,
      drawingId: "fixture-drawing",
      revision: "A",
      page: 1,
      approval: "approved",
      scale: {
        value: 1,
        unit: "mm/pixel",
        basis: "confirmed_inputs",
        reason: null,
      },
    },
    baselinePlan: baseline,
    scope: {
      coordinateFrame: frame,
      includedEntityIds: baseline.entities.map((e) => e.id),
      excludedEntityIds: [],
      tieInEntityIds: openSpool ? [] : ["a", "b"],
    },
    detailing: facts,
    siteFacts: [],
    changeRequest:
      scenario === 3
        ? {
            id: "duct-conflict",
            description: "Measured duct blocks the baseline",
            affectedEntityIds: ["pipe"],
            factIds: facts
              .filter((f) => f.field.startsWith("duct."))
              .map((f) => f.id),
          }
        : null,
  };
}
