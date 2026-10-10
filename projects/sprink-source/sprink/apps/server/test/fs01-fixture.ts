import type { PackagePlan, PackageInputs } from "@sprink/core";

// FS-01 P27 as the browser intake saves it: PDF points (Y down) mapped to a right-handed plan frame,
// N27 (12544.2133, 9620.5040) and N28 (12544.2133, 12668.1653) mm in the crop frame; heads H1/H3 and the
// adjacent pipes are unconnected context outside the scope.
export const MM_PER_PT = 33.8666666667;
const frame = { id: "drawing-plan", lengthUnit: "mm" as const, axes: "right_handed_z_up" as const };
const at = (x: number, y: number) => ({ x, y: -y, z: 0 });
const N27 = at(12544.2133, 9620.504), N28 = at(12544.2133, 12668.1653);
const port = (id: string, position: { x: number; y: number; z: number }) => ({ id, position, unknownReason: null });
export function fs01Trace(): Pick<PackageInputs, "baselinePlan" | "scope"> {
  const plan: PackagePlan = {
    id: "baseline", coordinateFrame: frame, confirmation: "confirmed",
    entities: [
      { id: "p1", kind: "pipe", productId: null, ports: [port("start", N27), port("end", N28)] },
      { id: "t1", kind: "tie_in", productId: null, ports: [port("socket", N27)] },
      { id: "t2", kind: "tie_in", productId: null, ports: [port("socket", N28)] },
      { id: "h1", kind: "head", productId: null, ports: [port("center", N27)] },
      { id: "h2", kind: "head", productId: null, ports: [port("center", N28)] },
      { id: "c1", kind: "pipe", productId: null, ports: [port("start", at(12544.2133, 9000)), port("end", at(12544.2133, 8000))] },
    ],
    connections: [
      { id: "t1-joint", from: { entityId: "p1", portId: "start" }, to: { entityId: "t1", portId: "socket" } },
      { id: "t2-joint", from: { entityId: "p1", portId: "end" }, to: { entityId: "t2", portId: "socket" } },
    ],
  };
  return { baselinePlan: plan, scope: { coordinateFrame: frame, includedEntityIds: ["p1", "t1", "t2"], excludedEntityIds: ["h1", "h2", "c1"], tieInEntityIds: ["t1", "t2"] } };
}
export const fs01View = {
  sheetUnit: "pdf_pt" as const, workArea: { x: 300, y: 230, width: 160, height: 190 },
  calibration: { method: "printed_scale" as const, a: null, b: null, realDistance: null, printedScale: "1/8 in = 1 ft", reference: "Printed scale on FS-01", pointUncertaintyMm: 5 },
  frame: { origin: { x: 0, y: 0 }, rotationDeg: 0 }, derivativeOf: "FM32361 FS-01 PDF crop (test copy)",
};
