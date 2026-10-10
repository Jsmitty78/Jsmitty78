import { afterEach, describe, expect, it, vi } from "vitest";
import type { PackageResult } from "@sprink/core";
import { api, type Snapshot } from "./api.js";
import { copyForSiteChange, materialSelection, sourcePlanForDisplay } from "./workflows.js";
import type { Plan } from "./model.js";

afterEach(() => vi.restoreAllMocks());
describe("drawing workflow handoff", () => {
  it("resolves all matching drawing entities and keeps an individual selection without a result", () => {
    const result = { materials: [{ id: "elbows", entityIds: ["e1", "e2", "e1"] }] } as PackageResult;
    expect(materialSelection(result, "elbows", null)).toEqual(["e1", "e2"]);
    expect(materialSelection(result, "missing", null)).toEqual([]);
    expect(materialSelection(undefined, null, "p1")).toEqual(["p1"]);
  });

});

describe("workflow display state", () => {
  it("keeps stale route proposals off the source drawing unless the selected result is current", () => {
    const baseline = {} as Plan, proposal = {} as Plan;
    expect(sourcePlanForDisplay(true, false, false, baseline, proposal)).toBe(baseline);
    expect(sourcePlanForDisplay(true, true, false, baseline, proposal)).toBe(proposal);
    expect(sourcePlanForDisplay(true, false, true, baseline, proposal)).toBe(proposal);
    expect(sourcePlanForDisplay(false, false, false, baseline, proposal)).toBe(proposal);
  });
  it("requests an atomic site-change copy at the current revision in the selected locale", async () => {
    const original = { id: "old", title: "Branch", inputRevision: 5 };
    const copy = vi.spyOn(api, "copySiteChange").mockResolvedValue({ id: "new" } as Snapshot);
    await copyForSiteChange(original, "en");
    await copyForSiteChange(original, "ja");
    expect(copy.mock.calls).toEqual([["old", 5, "Branch — Site change"], ["old", 5, "Branch — 現場変更"]]);
  });
});
