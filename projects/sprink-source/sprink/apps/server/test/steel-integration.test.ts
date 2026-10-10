import { integrationStream, integrationChoice } from "../../../packages/workflow/test/integration-stream.js";
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PackageInputs, WorkPackageSnapshot } from "@sprink/core";
import { deriveWorkPackage, fabricationCatalog, STEEL_PAIRS } from "@sprink/fabrication";
import { fabricationInput, generationInput, planningPlan } from "../src/integration/model.js";
import { deriveFabricationProfile } from "../src/integration/profiles.js";
import { integratedInput } from "./fixtures/integrated-package.js";
import { FieldService } from "../src/service.js";
import { WorkPackageStore } from "../src/work-packages/store.js";
import { createIntegratedServices } from "../src/integration/runtime.js";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(f => f()));
function add(input: PackageInputs, field: string, value: string | number | boolean, subjects: string[], unit: string | null = null) {
  input.detailing.push({ id: `steel-fact-${input.detailing.length}`, field, value, subjectIds: subjects, unit,
    confirmation: "confirmed", context: "detailing", unknownReason: null,
    source: { description: "Invented dimensional fixture, not a field measurement", assetId: null, page: null } });
}
function steelInputs(asset: string) {
  const input = integratedInput(asset, 2, true), pair = STEEL_PAIRS[0];
  input.title = "Synthetic steel open spool; not field acceptance";
  input.sourceDrawing!.approval = "unreviewed";
  input.detailing = input.detailing.filter(f => f.field.startsWith("datum.") || f.field.startsWith("movement.") || f.field === "workAreaAccess");
  for (const e of input.baselinePlan!.entities) e.productId = e.kind === "pipe" ? pair.pipeId : pair.elbowId;
  for (const [port, engagement] of [["in", 12], ["out", 15]] as const) {
    add(input, `threadMakeup.${port}`, engagement, ["f1"], "mm");
    add(input, `threadMakeup.${port}.pipeProductId`, pair.pipeId, ["f1"]);
    add(input, `threadMakeup.${port}.fittingProductId`, pair.elbowId, ["f1"]);
  }
  return input;
}
function snapshot(input: PackageInputs): WorkPackageSnapshot {
  return { ...input, id: "test-package", projectId: "idaho", intent: "prepare_from_drawing", inputRevision: 2,
    configVersion: "steel-test", selectedPlan: null, outputs: { candidates: null, results: [], requests: [], artifacts: [] },
    answers: [], run: null, createdAt: "2026-09-27T00:00:00Z", updatedAt: "2026-09-27T00:00:00Z" };
}
function sourceOnly(asset: string) {
  const input = integratedInput(asset, 2);
  input.title = "FS-01 R2 source projection; not physical dimensions";
  input.sourceDrawing!.drawingId = "FS-01";
  input.sourceDrawing!.approval = "unreviewed";
  input.baselinePlan!.entities.forEach(e => {
    e.productId = null; // FS-02 specifies a material family, not an actual SKU.
    if (e.kind === "tie_in") e.kind = "head";
    e.ports.forEach(p => { if (p.position!.x !== 0) p.position!.x = 3047.6613; });
  });
  input.detailing = [];
  add(input, "datum.start", "scope_interface", ["pipe"]);
  add(input, "datum.end", "scope_interface", ["pipe"]);
  add(input, "requiredConnectionMethod", "steel_threaded", ["pipe"]);
  add(input, "requiredPipeSpecification", "Schedule 40 black steel / threaded cast-iron fittings (FS-02)", ["pipe"]);
  return input;
}

it("carries scoped steel datums through production model, geometry and scenario profile", () => {
  const s = snapshot(steelInputs("source-asset"));
  const input = fabricationInput(s, s.baselinePlan!), catalog = fabricationCatalog(s.configVersion);
  const output = deriveWorkPackage(input, catalog), plan = planningPlan(s, input);
  expect(output.cuts.map(c => c.cutLength.value)).toEqual([0.56445, 0.41505]);
  expect(plan.fittings[0].ports[1].insertionOrThreadMakeup.value?.value).toBe(0.015);
  const profile = deriveFabricationProfile(s, input, output, plan, plan);
  expect(profile.project.basis).toBeUndefined();
  expect(profile.checks.some(c => /2025/.test(c.reason))).toBe(false);
  expect(profile.excluded).toEqual([]);
  expect(profile.checks.filter(c => c.id.startsWith("PRODUCT-SUITABILITY")).every(c => c.status === "unknown")).toBe(true);
  s.baselinePlan!.entities.forEach(e => e.productId = e.kind === "pipe" ? STEEL_PAIRS[1].pipeId : STEEL_PAIRS[1].elbowId);
  expect(deriveWorkPackage(fabricationInput(s, s.baselinePlan!), catalog).cuts.every(c => c.cutLength.value === null)).toBe(true);
});

it("rejects unconfirmed binding and does not copy product facts between projects", () => {
  const s = snapshot(steelInputs("source-asset"));
  s.detailing.find(f => f.field === "threadMakeup.in.pipeProductId")!.confirmation = "proposed";
  expect(deriveWorkPackage(fabricationInput(s, s.baselinePlan!), fabricationCatalog(s.configVersion)).cuts[0].cutLength.value).toBeNull();
  const msu = snapshot(steelInputs("msu-asset")); msu.projectId = "msu"; msu.id = "msu-package";
  msu.detailing = msu.detailing.filter(f => f.field.startsWith("datum."));
  msu.baselinePlan!.entities.forEach(e => e.productId = null);
  const out = deriveWorkPackage(fabricationInput(msu, msu.baselinePlan!), fabricationCatalog(msu.configVersion));
  expect(out.selectedProducts).toEqual([]);
  expect(out.cuts).toHaveLength(2);
  expect(out.cuts.every(c => c.centerline.value !== null && c.cutLength.value === null)).toBe(true);
  expect(s.baselinePlan!.entities[0].productId).toBe(STEEL_PAIRS[0].pipeId);
});

it("retains R2 source-only span/context and reports an explicit CPVC material conflict", () => {
  const s = snapshot(sourceOnly("source-asset"));
  const input = fabricationInput(s, s.baselinePlan!), catalog = fabricationCatalog(s.configVersion);
  const out = deriveWorkPackage(input, catalog);
  expect(out.cuts[0].centerline.value).toBeCloseTo(3.0476613, 10);
  expect(out.cuts[0].cutLength.value).toBeNull();
  expect(out.materials.filter(m => m.kind === "head")).toHaveLength(2);
  expect(out.materials.filter(m => m.kind === "head").every(m => m.quantity.value === null && m.reasons.join().includes("Retained context"))).toBe(true);
  expect(out.materials.find(m => m.kind === "support")?.quantity.value).toBeNull();
  expect(out.materials.find(m => m.id === "unresolved-other")?.quantity.value).toBeNull();
  expect(out.joints).toEqual([]); // Scope stations do not establish physical joint identities/counts.
  input.pieces[0].productId = "spears/CP-010";
  const changed = deriveWorkPackage(input, catalog), plan = planningPlan(s, input);
  expect(deriveFabricationProfile(s, input, changed, plan, plan).checks.find(c => c.id === "MATERIAL-CONFLICT-pipe")?.status).toBe("fail");
});

it("uses selected target product for generation without inventing steel makeup", () => {
  const s = snapshot(integratedInput("asset", 3)); s.intent = "adapt_to_site";
  s.baselinePlan!.entities.find(e => e.kind === "pipe")!.productId = STEEL_PAIRS[0].pipeId;
  const request = generationInput(s);
  expect(request.product.compatibility.value?.pipeProductId).toBe(STEEL_PAIRS[0].pipeId);
  expect(request.product.insertionOrThreadMakeup.value).toBeNull();
});

it.each(["source-only", "synthetic-steel"])("runs and exports %s through real persisted services without SF or cure defaults", async kind => {
  const dir = mkdtempSync(join(tmpdir(), "steel-production-")), field = new FieldService(dir);
  const t = createIntegratedServices(new WorkPackageStore(field.store.db), dir, {testStream:integrationStream, choice:integrationChoice});
  cleanup.push(() => { t.packages.close(); field.store.close(); rmSync(dir, { recursive: true, force: true }); });
  let s = t.packages.create({ projectId: "idaho", intent: "prepare_from_drawing", title: "Source-only API contract test" });
  const asset = await t.packages.upload(s.id, Buffer.from("%PDF-1.4\nfixture"), "application/pdf", "source.pdf");
  const input = kind === "source-only" ? sourceOnly(asset.id) : steelInputs(asset.id);
  // Acknowledge only invented access for this software run; no cut/product facts are supplied.
  if (kind === "source-only") add(input, "workAreaAccess", true, []);
  s = t.packages.edit(s.id, { expectedRevision: s.inputRevision, patch: input });
  const run = async (goal: "prepare_from_drawing" | "export_selected_package") => {
    t.packages.start(s.id, { expectedRevision: s.inputRevision, goal });
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 5));
      s = t.packages.get(s.id);
      if (s.run?.status !== "running") return;
    }
    throw new Error("Run timeout");
  };
  await run("prepare_from_drawing");
  expect(s.run?.status, s.run?.stopReason ?? "").toBe("completed");
  const result = t.detailStore.get(s.id)!.details[0];
  if (kind === "source-only") {
    expect(result.fabrication.cuts[0].centerline.value).toBeCloseTo(3.0476613, 10);
    expect(result.fabrication.cuts[0].cutLength.value).toBeNull();
  } else {
    expect(result.fabrication.cuts.map(c => c.cutLength.value)).toEqual([0.56445, 0.41505]);
  }
  expect(result.profile?.project.basis).toBeUndefined();
  expect(s.outputs.requests.some(r => /cure/i.test(r.question))).toBe(false);
  const preview = (await import("../src/integration/snapshot.js")).exportSnapshot(s, t.detailStore.get(s.id)!)!;
  (await import("../src/exports/snapshot.js")).validateSnapshot(preview);
  await run("export_selected_package");
  expect(s.run?.status, s.run?.stopReason ?? "").toBe("completed");
  expect(s.outputs.artifacts).toHaveLength(4);
  const cut = s.outputs.artifacts.find(a => a.kind === "cut_csv")!;
  expect(t.packages.artifact(s.id, cut.id).bytes.toString()).toContain(kind === "source-only" ? "unknown" : "0.56445");
});
