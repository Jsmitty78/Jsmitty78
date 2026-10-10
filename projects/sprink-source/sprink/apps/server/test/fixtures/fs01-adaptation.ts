import { readFileSync } from "node:fs";
import type { PackageInputs, PackagePlan } from "@sprink/core";
import { STEEL_PAIRS } from "@sprink/fabrication";

/** Source projection + explicitly fictional horizontal/duct/work-space supplement from #1.
 * This is a test/input seed, never a production extractor or approved product selection.
 */
export function fs01Adaptation(assetId: string): PackageInputs {
  const source = JSON.parse(readFileSync(new URL("../../../../packages/core/src/reference/itd-mezzanine.json", import.meta.url), "utf8"));
  const model = source.model as { nodes: { id: string; x: number; y: number }[]; pipes: { id: string; from: string; to: string }[]; heads: { id: string; nodeId: string }[] };
  const frame: PackagePlan["coordinateFrame"] = { id: "FS01-projected-mm", lengthUnit: "mm", axes: "right_handed_z_up" };
  const position = (id: string) => { const p = model.nodes.find(n => n.id === id)!; return { x: p.x, y: p.y, z: 0 }; };
  const hub = (id: string) => model.heads.find(h => h.nodeId === id)?.id ?? id;
  const plan: PackagePlan = { id: "FS01-baseline", confirmation: "confirmed", coordinateFrame: frame, entities: [], connections: [] };
  for (const n of model.nodes) plan.entities.push({ id: hub(n.id), kind: model.heads.some(h => h.nodeId === n.id) ? "head" : "tie_in", productId: null, ports: [{ id: "station", position: position(n.id), unknownReason: null }] });
  for (const p of model.pipes) {
    plan.entities.push({ id: p.id, kind: "pipe", productId: p.id === "P27" ? STEEL_PAIRS[0].pipeId : null, ports: [{ id: "start", position: position(p.from), unknownReason: null }, { id: "end", position: position(p.to), unknownReason: null }] });
    for (const [end, node] of [["start", p.from], ["end", p.to]]) plan.connections.push({ id: `${p.id}-${end}`, from: { entityId: p.id, portId: end }, to: { entityId: hub(node), portId: "station" } });
  }
  const detailing: PackageInputs["detailing"] = [];
  const add = (field: string, value: number | string, unit: string | null, subjects: string[] = []) => detailing.push({ id: `fs-${detailing.length}`, field, value, unit, subjectIds: subjects, confirmation: "confirmed", context: "detailing", unknownReason: null, source: { description: "SAMPLE supplement: fictional horizontal geometry, obstacle and work-space assumptions from #1. Not measured site facts or approved product selection.", assetId: null, page: null } });
  for (const end of ["start", "end"]) add(`datum.${end}`, "scope_interface", null, ["P27"]);
  add("requiredConnectionMethod", "steel_threaded", null, ["P27"]);
  add("requiredPipeSpecification", "Schedule 40 black steel, threaded cast-iron fittings", null, ["P27"]);
  for (const f of detailing) f.source = { description: f.field.startsWith("datum.")
    ? "FS-01 source P27 projected endpoint stations. Physical end assemblies, joints and elevation remain unresolved."
    : "FS-02 general notes: Schedule 40 black steel/threaded cast-iron fittings. Public design source; exact product and current approval unknown. See parent #1 source packet.", assetId: null, page: f.field.startsWith("datum.") ? 1 : 2 };
  for (const [field, n] of [["origin.x", 12544.2133], ["origin.y", 9620.504], ["origin.z", 0], ["yaw", 90]] as const) add(`adaptationFrame.${field}`, n, field === "yaw" ? "deg" : "mm");
  for (const [prefix, values] of [["duct", [1200, -250, -300, 1800, 250, 300]], ["workEnvelope", [-150, -1400, -200, 3197.6613, 1200, 200]]] as const)
    ["min.x", "min.y", "min.z", "max.x", "max.y", "max.z"].forEach((key, i) => add(`${prefix}.${key}`, values[i], "mm"));
  add("requiredPipeClearance", 100, "mm");
  return {
    title: "FS-01 projection + FICTIONAL duct (not field acceptance)",
    sourceDrawing: { assetId, drawingId: "FS-01", revision: "2023-06-05", page: 1, approval: "unreviewed", scale: { value: 16.93333333335, unit: "mm/pixel", basis: "confirmed_inputs", reason: null } },
    baselinePlan: plan, scope: { coordinateFrame: frame, includedEntityIds: ["P27"], excludedEntityIds: plan.entities.filter(e => e.id !== "P27").map(e => e.id), tieInEntityIds: ["H1", "H3"] },
    siteFacts: [], detailing,
    changeRequest: { id: "fictional-duct", description: "Explicitly fictional duct/work envelope over source P27; actual dimensions, elevations and physical interfaces unknown", affectedEntityIds: ["P27"], factIds: detailing.filter(f => f.field.startsWith("duct.")).map(f => f.id) },
  };
}
