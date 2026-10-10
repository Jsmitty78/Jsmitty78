import { describe, expect, it } from "vitest";
import type { PackageInputs } from "@sprink/core";
import { adaptationFrame, geometryFactUsable } from "@sprink/core";
import { findFact, upsertFacts } from "../model.js";
import { sampleInputs } from "../sample.js";
import { planToSheet, sheetToPlan } from "../intake/sheet.js";
import { hasFootprint, rectangle, shapePatch, shapeValues } from "./shapes.js";
const inputs = () => ({ ...sampleInputs("adapt", "sample"), title: "Shape test" }) satisfies PackageInputs;
describe("site shape inputs", () => {
  it("round trips a rotated sheet and pinned local frame without expanding a rotated rectangle", () => {
    const s = inputs();
    Object.assign(s, upsertFacts(s, [
      ...["x", "y", "z"].map((a, i) => ({ field: `adaptationFrame.origin.${a}`, value: [1250, -500, 20][i], unit: "mm", confirmation: "proposed" as const, provenance: "synthetic_assumption" as const, context: "detailing" as const, source: "test" })),
      { field: "adaptationFrame.yaw", value: 37, unit: "deg", confirmation: "proposed", provenance: "synthetic_assumption", context: "detailing", source: "test" },
    ]));
    const frame = adaptationFrame(s), sheet = { scale: 25.4, origin: { x: 67, y: 300 }, rotationDeg: -23 };
    const a = { x: 120, y: -300, z: 0 }, b = { x: 880, y: 60, z: 0 };
    const back = (p: typeof a) => frame.toLocal(sheetToPlan(planToSheet(frame.toDrawing(p), sheet), sheet));
    const v = rectangle(back(b), back(a), [null, null, null, null, null, null]);
    expect(v[0]).toBeCloseTo(120, 4); expect(v[1]).toBeCloseTo(-300, 4);
    expect(v[3]).toBeCloseTo(880, 4); expect(v[4]).toBeCloseTo(60, 4);
    expect(v[2]).toBeNull(); expect(v[5]).toBeNull(); expect(hasFootprint(v)).toBe(true);
  });
  it("preserves height evidence, unconfirms moved XY and keeps photos and request references", () => {
    const s = inputs();
    s.siteFacts = s.siteFacts.map(f => ({ ...f, provenance: "confirmed_evidence", source: { ...f.source, description: "Tape measurement", assetId: "photo" } }));
    const draft = shapeValues(s); draft.duct = rectangle({ x: 4100, y: -300 }, { x: 6300, y: 400 }, draft.duct);
    const updated = { ...s, ...shapePatch(s, draft) };
    expect(findFact(updated, "duct.min.x")).toMatchObject({ value: 4100, confirmation: "proposed", provenance: "user_entered", source: { assetId: "photo" } });
    expect(geometryFactUsable(findFact(updated, "duct.min.x"))).toBe(false);
    expect(findFact(updated, "duct.min.z")).toEqual(findFact(s, "duct.min.z"));
    expect(updated.changeRequest!.factIds.every(id => [...updated.siteFacts, ...updated.detailing].some(f => f.id === id))).toBe(true);
  });
  it("creates explicit unknown height facts for a new footprint", () => {
    const s = inputs(); s.siteFacts = s.siteFacts.filter(f => !f.field.startsWith("duct."));
    const draft = shapeValues(s); draft.duct = [100, 200, null, 400, 600, null];
    const updated = { ...s, ...shapePatch(s, draft) };
    expect(findFact(updated, "duct.min.z")).toMatchObject({ value: null, confirmation: "proposed", provenance: "user_entered" });
    expect(findFact(updated, "duct.max.z")?.unknownReason).toBeTruthy();
  });
  it("saves deletion as unknown and never promotes a synthetic value", () => {
    const s = inputs(), draft = shapeValues(s); draft.duct = [null, null, null, null, null, null];
    const deleted = { ...s, ...shapePatch(s, draft) };
    expect(shapeValues(deleted).duct).toEqual(draft.duct);
    expect(findFact(deleted, "duct.min.x")).toMatchObject({ value: null, provenance: "synthetic_assumption", confirmation: "proposed" });
    expect(findFact(deleted, "duct.min.x")?.unknownReason).toBeTruthy();
  });
});
