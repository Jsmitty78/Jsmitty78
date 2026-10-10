import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import type { WorkPackageSnapshot } from "@sprink/core";
import { deriveWorkPackage, fabricationCatalog } from "@sprink/fabrication";
import { fabricationInput, planningPlan } from "../src/integration/model.js";
import { deriveFabricationProfile } from "../src/integration/profiles.js";
import { exportSnapshot } from "../src/integration/snapshot.js";
import { csvFiles } from "../src/exports/csv.js";
import { validateSnapshot } from "../src/exports/snapshot.js";
import { renderPdf } from "../src/exports/pdf.js";

export async function sourceExport() {
  // Saved browser intake shape, including sourceLabel/materialRequirement rather than older fixture-only fields.
  const s: WorkPackageSnapshot = JSON.parse(await readFile(new URL("./fixtures/fs01-intake-snapshot.json", import.meta.url), "utf8"));
  const input = fabricationInput(s, s.baselinePlan!);
  const fabrication = deriveWorkPackage(input, fabricationCatalog(s.configVersion));
  const plan = planningPlan(s, input);
  const profile = deriveFabricationProfile(s, input, fabrication, plan, plan);
  return exportSnapshot(s, { inputRevision: s.inputRevision, configVersion: s.configVersion, refs: [], details: [{ id: "saved-intake-output", input, fabrication, plan, profile }] })!;
}
it("preserves saved drawing labels, requirements, context and unknown cuts in exports", async () => {
  const s = await sourceExport();
  validateSnapshot(s);
  expect(s.drawingReference).toContain("revision A, page 1, unreviewed");
  expect(s.selectedPlan.segments[0].sourceLabel).toBe("P27");
  expect(s.selectedPlan.context?.map(c => c.sourceLabel)).toEqual(expect.arrayContaining(["H1", "H3"]));
  expect(s.cuts.every(c => c.length === null)).toBe(true);
  expect(s.materials.filter(m => m.subjectIds.some(id => s.selectedPlan.context?.some(c => c.id === id))).every(m => m.quantity === null)).toBe(true);
  expect(s.inputFacts?.find(f => f.field === "nominalSize")?.value).toBe("2 inch");
  expect(s.inputFacts?.find(f => f.field === "materialRequirement")?.value).toContain("Schedule 40");
  const csv = csvFiles(s);
  for (const file of [csv.bom, csv.cuts]) {
    expect(file.toString()).toContain("P27");
    expect(file.toString()).toContain("H3");
    expect(file.toString()).toContain("Schedule 40");
    expect(file.toString()).toContain("protected_context_not_for_purchase");
  }
  const pdf = await renderPdf(s);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
});
