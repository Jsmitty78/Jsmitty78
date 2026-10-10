import { integrationStream, integrationChoice } from "../../../packages/workflow/test/integration-stream.js";
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FieldService } from "../src/service.js";
import { WorkPackageStore } from "../src/work-packages/store.js";
import { createIntegratedServices } from "../src/integration/runtime.js";
import { integratedInput } from "./fixtures/integrated-package.js";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));

// Independent subject oracle: expected cuts come from the saved/generated graph, never profile.checks.
it.each([2, 3] as const)("executes every mandatory fabrication subject through the real scenario %s runtime", async scenario => {
  const dir = mkdtempSync(join(tmpdir(), "profile-subjects-"));
  const field = new FieldService(dir);
  const t = createIntegratedServices(new WorkPackageStore(field.store.db), dir, {testStream:integrationStream, choice:integrationChoice});
  cleanup.push(() => { t.packages.close(); field.store.close(); rmSync(dir, { recursive: true, force: true }); });
  const intent = scenario === 2 ? "prepare_from_drawing" : "adapt_to_site";
  let s = t.packages.create({ title: "Synthetic arithmetic and execution coverage control", projectId: "profile-control", intent });
  const asset = await t.packages.upload(s.id, Buffer.from("%PDF-1.4\nsynthetic"), "application/pdf", "control.pdf");
  s = t.packages.edit(s.id, { expectedRevision: s.inputRevision, patch: integratedInput(asset.id, scenario, scenario === 2) });
  t.packages.start(s.id, { expectedRevision: s.inputRevision, goal: intent });
  for (let i = 0; i < 300; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    s = t.packages.get(s.id);
    if (s.run?.status !== "running") break;
  }
  expect(s.run?.status).toBe(scenario === 2 ? "completed" : "waiting_input");
  const details = t.detailStore.get(s.id)!.details;
  expect(details).toHaveLength(scenario === 2 ? 1 : 3);
  for (const [index, detail] of details.entries()) {
    const profile = detail.profile!;
    expect(profile.profile).toBe(index === 0 ? "drawing_preparation" : "site_adaptation");
    const pipeIds = detail.plan.segments.map(p => p.id).sort();
    expect(pipeIds).toHaveLength(scenario === 2 ? 2 : index === 0 ? 1 : 5);
    if (scenario === 2) expect(pipeIds).toEqual(["p1", "p2"]);
    const expectedCuts = pipeIds.map(id => ({ id: `CUT-${id}`, subjectIds: [id] }));
    expect(profile.required.filter(c => c.id.startsWith("CUT-")).sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual(expectedCuts.sort((a, b) => a.id.localeCompare(b.id)));
    expect(profile.checks.filter(c => c.id.startsWith("CUT-")).map(({ id, subjectIds }) => ({ id, subjectIds })).sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual(expectedCuts);
    expect(profile.required.filter(c => c.id === "ASSEMBLY_CONDITIONS").map(c => [...c.subjectIds].sort())).toEqual([pipeIds]);
    expect(profile.checks.filter(c => c.id === "ASSEMBLY_CONDITIONS").map(c => [...c.subjectIds].sort())).toEqual([pipeIds]);
    expect(profile.checks.find(c => c.id === "SUBJECT_SCOPE")).toMatchObject({ status: "unknown", state: "input_missing" });
    expect(detail.ruleExecutions).toHaveLength(1);
    expect(profile.excluded).toEqual([]);
    // This run verifies exactly JEV's one choice; it does not preselect a regional pack.
    expect(profile.required.some(c => c.id === "SFFD_AB204_HYDRAULIC_RECALC_I22A2_V1")).toBe(false);
  }
});
