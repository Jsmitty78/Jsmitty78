import { adaptationFrame, type WorkPackageSnapshot } from "@sprink/core";
import { integratedInput } from "./integrated-package.js";
/** Synthetic CPVC algorithm control only, not FS-01/MSU material or field acceptance. */
export function adaptationFixture(angle = 0, inFeet = false): WorkPackageSnapshot {
  const input = integratedInput("asset", 3);
  const s = { ...input, id: "job", projectId: "synthetic", intent: "adapt_to_site", inputRevision: 2, configVersion: "test" } as WorkPackageSnapshot;
  const b = s.baselinePlan!;
  b.entities.find(e => e.id === "a")!.kind = "head";
  const end = b.entities.find(e => e.id === "b")!;
  end.kind = "fitting";
  end.ports.push({ id: "adjacent", position: { x: 10000, y: 0, z: 0 }, unknownReason: null });
  b.entities.push({ id: "remaining-leg", kind: "pipe", productId: null, ports: [
    { id: "start", position: { x: 10000, y: 0, z: 0 }, unknownReason: null },
    { id: "end", position: { x: 10000, y: 1500, z: 0 }, unknownReason: null },
  ] }, { id: "terminal", kind: "head", productId: null, ports: [{ id: "in", position: { x: 10000, y: 1500, z: 0 }, unknownReason: null }] });
  b.connections.push({ id: "remaining-joint", from: { entityId: "b", portId: "adjacent" }, to: { entityId: "remaining-leg", portId: "start" } }, { id: "terminal-joint", from: { entityId: "remaining-leg", portId: "end" }, to: { entityId: "terminal", portId: "in" } });
  s.scope!.includedEntityIds = ["pipe"];
  s.scope!.excludedEntityIds = ["remaining-leg", "terminal"];
  // Explicit local-to-source frame, never inferred from the drawing angle.
  for (const [field, value, unit] of [["origin.x", 1200, "mm"], ["origin.y", -500, "mm"], ["origin.z", 50, "mm"], ["yaw", angle, "deg"]] as const) {
    s.detailing.push({ id: `frame-${field}`, field: `adaptationFrame.${field}`, value, unit, subjectIds: [], confirmation: "confirmed", context: "detailing", unknownReason: null, source: { description: "Fictional transform for software test", assetId: null, page: null } });
  }
  const transform = adaptationFrame(s);
  b.entities.forEach(e => e.ports.forEach(p => { if (p.position) p.position = transform.toDrawing(p.position); }));
  if (inFeet) for (const f of s.detailing.filter(f => f.unit === "mm")) { f.value = (f.value as number) / 304.8; f.unit = "ft"; }
  // Head stations are not physical tie-ins with known cut offsets.
  s.detailing = s.detailing.filter(f => f.field !== "netCutOffset");
  return s;
}
