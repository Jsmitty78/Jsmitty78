import { scriptedSearch } from './fixtures/source-search.js';
import { deriveFixedEndClosure, spearsCatalog } from "@sprink/fabrication";
import { fs01View, MM_PER_PT } from "./fs01-fixture.js";
import { fs01Adaptation } from "./fixtures/fs01-adaptation.js";
import { adaptationFixture } from "./fixtures/adaptation-package.js";
import { exportSnapshot } from "../src/integration/snapshot.js";
import { validateSnapshot } from "../src/exports/snapshot.js";
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FieldService } from "../src/service.js";
import { createApp } from "../src/api.js";
import { WorkPackageStore } from "../src/work-packages/store.js";
import { createIntegratedServices } from "../src/integration/runtime.js";
import { integratedInput } from "./fixtures/integrated-package.js";
import { sampleInputs } from "../../web/src/workbench/sample.js";
import { integrationStream, integrationChoice } from "../../../packages/workflow/test/integration-stream.js";
import { SourceStore } from "../src/sources/store.js";
import { scriptedStream } from "../../../packages/workflow/test/fixtures/scripted-stream.js";
import { getProjectRuleCatalog } from "@sprink/core";
import { evaluateProfile } from "../src/integration/profiles.js";
import type { ChoiceClient } from "@sprink/workflow";
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));
function setup(choice?: ChoiceClient, testStream = integrationStream) {
  const dir = mkdtempSync(join(tmpdir(), "real-pi-integration-"));
  const field = new FieldService(dir);
  const events: string[] = [];
  const sourceQueries: Array<{ query: string; keys: string[] }> = [];
  const toolResults: { name: string; result: unknown }[] = [];
  const integrated = createIntegratedServices(
    new WorkPackageStore(field.store.db),
    dir,
    { sourceSearch: { async select(query, rows) { sourceQueries.push({ query, keys: rows.map(p => p.doc.id) }); return scriptedSearch.select(query, rows); } }, choice: choice ?? integrationChoice, testStream, onEvent: (_id, e) => { events.push(e.type); if (e.type === "tool_execution_end") toolResults.push({name:e.toolName,result:e.result}); } },
  );
  const app = createApp(field, {
    token: "integration-test-token",
    workPackages: integrated.packages,
    workPackageExports: integrated.exports,
    workPackageDetails: integrated.details,
  });
  cleanup.push(() => {
    integrated.packages.close();
    field.store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { ...integrated, field, events, toolResults, sourceQueries, app };
}
async function create(
  t: ReturnType<typeof setup>,
  scenario: 2 | 3 = 2,
  open = false,
  change?: (input: ReturnType<typeof integratedInput>) => void,
) {
  const s = t.packages.create({
    projectId: "test-project",
    title: "input",
    intent: scenario === 2 ? "prepare_from_drawing" : "adapt_to_site",
  });
  const asset = await t.packages.upload(
    s.id,
    Buffer.from("%PDF-1.4\nfixture"),
    "application/pdf",
    "drawing.pdf",
  );
  return t.packages.edit(s.id, {
    expectedRevision: 1,
    patch: (() => {
      const input = integratedInput(asset.id, scenario, open);
      change?.(input);
      return input;
    })(),
  });
}
async function run(t: ReturnType<typeof setup>, id: string, goal?: string) {
  const s = t.packages.get(id);
  const response = await t.app.request(`/api/work-packages/${id}/runs`, {
    method: "POST",
    headers: {
      Authorization: "Bearer integration-test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expectedRevision: s.inputRevision,
      goal: goal ?? s.intent,
    }),
  });
  expect(response.status).toBe(202);
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 5));
    const current = t.packages.get(id);
    if (current.run?.status !== "running") return current;
  }
  throw new Error("Run did not stop");
}
it("runs the browser's synthetic preparation sample without treating its values as field evidence", async () => {
  const t = setup();
  const created = t.packages.create({ projectId: "sample-project", title: "sample preparation", intent: "prepare_from_drawing" });
  const asset = await t.packages.upload(created.id, Buffer.from("%PDF-1.4\nfixture"), "application/pdf", "sample.pdf");
  const input = sampleInputs("prepare", asset.id);
  expect([...input.detailing, ...input.siteFacts].every(f => f.provenance === "synthetic_assumption" && f.confirmation === "proposed")).toBe(true);
  expect(input.baselinePlan?.confirmation).toBe("proposed");
  expect(input.sourceDrawing?.scale.basis).toBe("proposed_inputs");
  t.packages.edit(created.id, { expectedRevision: 1, patch: input });

  for (const field of ["workAreaAccess", "curePlan"]) {
    const waiting = await run(t, created.id);
    expect(waiting.run?.status).toBe("waiting_input");
    const request = waiting.outputs.requests.find(r => r.question.toLowerCase().includes(field === "curePlan" ? "cure plan" : "work-area access"));
    expect(request).toBeDefined();
    t.packages.answer(created.id, { expectedRevision: waiting.inputRevision, requestId: request!.id, value: null, unavailableReason: "Synthetic sample has no field confirmation" });
  }
  const prepared = await run(t, created.id);
  expect(prepared.run?.status).toBe("completed");
  expect(prepared.outputs.results[0]).toMatchObject({ materials: expect.any(Array), cuts: expect.any(Array), assembly: expect.any(Array) });
  expect(prepared.outputs.results[0].cuts.every(c => c.length.value === null)).toBe(true);
  const exported = await run(t, created.id, "export_selected_package");
  expect(exported.run?.status).toBe("completed");
  expect(exported.outputs.artifacts.map(a => a.kind)).toEqual(expect.arrayContaining(["pdf", "bom_csv", "cut_csv"]));
});
it("runs real Pi for a drawing-only open spool and exports the authoritative saved outputs", async () => {
  const t = setup(),
    s = await create(t, 2, true);
  const result = await run(t, s.id);
  expect(
    result.run?.status,
    JSON.stringify(t.detailStore.get(s.id)?.latestRun),
  ).toBe("completed");
  const d = t.detailStore.get(s.id)!.details[0];
  expect(d.fabrication.cuts.map((c) => c.cutLength.value)).toEqual([
    0.5762625, 0.4238625,
  ]);
  expect(d.fabrication.operations.every((o) => o.status === "planned")).toBe(
    true,
  );
  expect(d.profile?.profile).toBe("drawing_preparation");
  expect(d.profile?.project.localChange).toBeUndefined();
  expect(d.profile?.required.length).toBeGreaterThan(0);
  expect(d.ruleExecutions).toHaveLength(1);
  expect(t.events).toContain("tool_execution_end");
  validateSnapshot(
    exportSnapshot(t.packages.get(s.id), t.detailStore.get(s.id)!)!,
  );
  const exported = await run(t, s.id, "export_selected_package");
  expect(
    exported.run?.status,
    JSON.stringify(t.detailStore.get(s.id)?.latestRun),
  ).toBe("completed");
  expect(exported.outputs.artifacts).toHaveLength(4);
  const pdf = exported.outputs.artifacts.find((a) => a.kind === "pdf")!;
  expect(
    t.packages.artifact(s.id, pdf.id).bytes.subarray(0, 5).toString(),
  ).toBe("%PDF-");
  const csv = exported.outputs.artifacts.find((a) => a.kind === "cut_csv")!;
  expect(t.packages.artifact(s.id, csv.id).bytes.toString()).toContain(
    "0.5762625",
  );
  t.packages.edit(s.id, {
    expectedRevision: exported.inputRevision,
    patch: { title: "changed" },
  });
  expect(() => t.packages.artifact(s.id, pdf.id)).toThrow("stale_artifact");
});
it("generates two real CPVC alternatives without a supplied reroute, waits for human selection, and preserves fixed-end limits", async () => {
  const t = setup(),
    s = await create(t, 3);
  const result = await run(t, s.id);
  expect(
    result.run?.status,
    JSON.stringify(t.detailStore.get(s.id)?.latestRun),
  ).toBe("waiting_input");
  expect(result.outputs.candidates?.candidates).toHaveLength(2);
  expect(result.selectedPlan).toBeNull();
  const state = t.detailStore.get(s.id)!;
  expect(state.details).toHaveLength(3);
  expect(
    state.details[1].fabrication.cuts.reduce(
      (n, c) => n + c.cutLength.value!,
      0,
    ),
  ).toBeCloseTo(12.4333, 8);
  expect(
    state.details[2].fabrication.cuts.reduce(
      (n, c) => n + c.cutLength.value!,
      0,
    ),
  ).toBeCloseTo(12.9333, 8);
  for (const d of state.details.slice(1)) {
    expect(d.profile?.profile).toBe("site_adaptation");
    expect(d.ruleExecutions).toHaveLength(1);
    expect(d.profile?.required.map(r => r.id)).toContain("ASSEMBLY_CONDITIONS");
    // Region and product no longer trigger an entire fixed pack behind JEV's selection.
    expect(d.profile?.checks.some(c => c.id === "SFFD_AB204_HYDRAULIC_RECALC_I22A2_V1")).toBe(false);
    expect(
      d.fabrication.operations.some(
        (o) => o.code === "resolve_connection" && o.status === "unsupported",
      ),
    ).toBe(true);
    expect(
      d.profile?.checks.find((c) => c.id === "ASSEMBLY_CONDITIONS")?.status,
    ).toBe("unknown");
  }
  t.packages.select(s.id, {
    expectedRevision: result.inputRevision,
    planId: result.outputs.candidates!.candidates[0].plan.id,
  });
  const selected = await run(t, s.id);
  expect(
    selected.run?.status,
    JSON.stringify(t.detailStore.get(s.id)?.latestRun),
  ).toBe("completed");
  validateSnapshot(
    exportSnapshot(t.packages.get(s.id), t.detailStore.get(s.id)!)!,
  );
  const exported = await run(t, s.id, "export_selected_package");
  expect(
    exported.run?.status,
    JSON.stringify(t.detailStore.get(s.id)?.latestRun),
  ).toBe("completed");
  expect(exported.outputs.artifacts).toHaveLength(4);
});
it("uses a recorded rule Choice, persists wait/answer and resumes in a fresh Pi Agent", async () => {
  let calls = 0;
  const choice: ChoiceClient = {
    async choose(request) {
      calls++;
      const ids = Object.keys(request.questions.next_action.criteria);
      expect(ids).not.toContain("request_input:workAreaAccess");
      expect(ids).toContain("selection_complete");
      return integrationChoice.choose(request, new AbortController().signal);
    },
  };
  const t = setup(choice),
    s = await create(t, 2, true);
  t.packages.edit(s.id, {
    expectedRevision: s.inputRevision,
    patch: {
      detailing: s.detailing.filter(
        (f) => !["workAreaAccess", "curePlan"].includes(f.field),
      ),
    },
  });
  const first = await run(t, s.id);
  expect(first.run?.status).toBe("waiting_input");
  expect(calls).toBe(1);
  expect(first.outputs.results.length).toBeGreaterThan(0);
  expect(t.detailStore.get(s.id)?.latestRun?.latestDecision?.source).toBe(
    "jev",
  );
  t.packages.answer(s.id, {
    expectedRevision: first.inputRevision,
    requestId: first.outputs.requests.at(-1)!.id,
    value: null,
    unavailableReason: "Not available today",
  });
  const second = await run(t, s.id);
  expect(second.run?.id).not.toBe(first.run?.id);
  expect(second.run?.status).toBe("waiting_input");
  expect(second.outputs.requests.at(-1)?.question).toContain("cure");
  expect(
    t.detailStore
      .get(s.id)!
      .details[0].fabrication.operations.some(
        (o) => o.status === "needs_confirmation",
      ),
  ).toBe(true);
});
it("keeps missing datum cuts null without losing known counts or centerline", async () => {
  const t = setup(),
    s = await create(t);
  t.packages.edit(s.id, {
    expectedRevision: s.inputRevision,
    patch: { detailing: s.detailing.filter((f) => f.field !== "datum.start") },
  });
  const result = await run(t, s.id);
  expect(
    result.run?.status,
    JSON.stringify(t.detailStore.get(s.id)?.latestRun),
  ).toBe("completed");
  const d = t.detailStore.get(s.id)!.details[0];
  expect(d.fabrication.cuts[0].cutLength.value).toBeNull();
  expect(d.fabrication.cuts[0].centerline.value).toBe(10);
  expect(d.fabrication.materials[0].quantity.value).toBe(1);
  expect(d.fabrication.materials[0].cutLength?.value).toBeNull();
});
it.each(["cancel", "edit"] as const)(
  "prevents late Choice publication after %s and reuses only matching starts",
  async (mode) => {
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>((r) => (entered = r));
    const choice: ChoiceClient = {
      async choose(request) {
        entered();
        await new Promise<void>((r) => (release = r));
        throw new Error("late unavailable response");
      },
    };
    const t = setup(choice),
      s = await create(t, 2, true, (input) => {
        input.detailing = input.detailing.filter(
          (f) => !["workAreaAccess", "curePlan"].includes(f.field),
        );
      });
    const first = t.packages.start(s.id, {
      expectedRevision: s.inputRevision,
      goal: s.intent,
    });
    const duplicate = t.packages.start(s.id, {
      expectedRevision: s.inputRevision,
      goal: s.intent,
    });
    expect(duplicate.run.id).toBe(first.run.id);
    expect(duplicate.reused).toBe(true);
    expect(() =>
      t.packages.start(s.id, {
        expectedRevision: s.inputRevision,
        goal: "export_selected_package",
      }),
    ).toThrow("active_run_goal_conflict");
    await waiting;
    const before = t.detailStore.get(s.id)!;
    expect(before.details.length).toBeGreaterThan(0);
    if (mode === "cancel") t.packages.cancel(s.id, first.run.id);
    else
      t.packages.edit(s.id, {
        expectedRevision: s.inputRevision,
        patch: { title: "edited during Choice" },
      });
    release();
    await new Promise((r) => setTimeout(r, 20));
    const after = t.packages.get(s.id);
    expect(after.run?.status).toBe(
      mode === "cancel" ? "cancelled" : "interrupted",
    );
    expect(after.outputs.requests).toHaveLength(0);
    expect(t.detailStore.get(s.id)?.latestRun?.question).toBeUndefined();
    if (mode === "edit")
      expect(after.freshness.results.every((r) => !r.current)).toBe(true);
  },
);
it("keeps unsupported product cuts unresolved and retains context without adding purchase items", async () => {
  const t = setup(),
    s = await create(t, 2, false, (input) => {
      input.baselinePlan!.entities.find((e) => e.kind === "pipe")!.productId =
        "unlisted-pipe";
    });
  const result = await run(t, s.id);
  expect(result.run?.status).toBe("completed");
  const d = t.detailStore.get(s.id)!.details[0];
  expect(d.fabrication.cuts[0].cutLength.value).toBeNull();
  expect(d.fabrication.materials[0].quantity.value).toBe(1);
  expect(d.fabrication.operations.some((o) => o.status === "unsupported")).toBe(
    true,
  );
  const p = await create(t, 3, false, (input) => {
    input.baselinePlan!.entities.push({
      id: "protected-head",
      kind: "head",
      productId: "TY3231",
      ports: [],
    });
    input.scope!.includedEntityIds.push("protected-head");
  });
  const blocked = await run(t, p.id);
  expect(blocked.run?.status).toBe("waiting_input");
  expect(blocked.outputs.candidates?.candidates).toHaveLength(2);
  for (const c of blocked.outputs.candidates!.candidates) {
    expect(c.plan.entities.find(e => e.id === "protected-head")).toEqual(p.baselinePlan!.entities.find(e => e.id === "protected-head"));
  }
  expect(blocked.outputs.results.every(r => !r.materials.some(m => m.entityIds.includes("protected-head")))).toBe(true);
  expect(blocked.outputs.results[0].gaps.some(g => g.id === "protected-context")).toBe(true);
});
it("requests missing geometry, resumes after a saved correction, and exposes source-bound detail through the authenticated API", async () => {
  const t = setup(),
    s = await create(t, 3, false, (input) => {
      input.detailing = input.detailing.filter(
        (f) => f.field !== "workEnvelope.min.x",
      );
    });
  const result = await run(t, s.id);
  expect(result.run?.status).toBe("waiting_input");
  expect(result.outputs.candidates?.candidates).toHaveLength(0);
  const request = result.outputs.requests.at(-1)!;
  expect(request.question).toContain("workEnvelope");
  expect(request.question).toContain("Work boundary");
  t.packages.answer(s.id, { expectedRevision: result.inputRevision, requestId: request.id, value: null, unavailableReason: "Measurement unavailable" });
  expect((await run(t, s.id)).run?.status).toBe("blocked");
  const missing = integratedInput(s.sourceDrawing!.assetId, 3).detailing.find(f => f.field === "workEnvelope.min.x")!;
  t.packages.edit(s.id, { expectedRevision: t.packages.get(s.id).inputRevision, patch: { detailing: [...result.detailing, missing] } });
  const recovered = await run(t, s.id);
  expect(recovered.outputs.candidates?.candidates.length).toBeGreaterThan(0);
  expect(recovered.run?.status).toBe("waiting_input");
  const good = await create(t, 2, true);
  await run(t, good.id);
  const path = `/api/work-packages/${good.id}/detail`;
  expect((await t.app.request(path)).status).toBe(401);
  const response = await t.app.request(path, {
    headers: { Authorization: "Bearer integration-test-token" },
  });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.current).toBe(true);
  expect(data.state.details[0].profile.required).toEqual(
    data.state.details[0].profile.checks.map(
      (c: { id: string; subjectIds: string[] }) => ({
        id: c.id,
        subjectIds: c.subjectIds,
      }),
    ),
  );
  expect(data.exportBinding.outputVersion).toBe(data.state.details[0].id);
});

it("runs an independently created rotated interval with retained context through selection, export and invalidation", async () => {
  const t = setup();
  const s = await create(t, 3, false, input => {
    const fixture = adaptationFixture(31, true);
    input.baselinePlan = fixture.baselinePlan;
    input.scope = fixture.scope;
    input.siteFacts = fixture.siteFacts;
    input.detailing = fixture.detailing;
    input.changeRequest = fixture.changeRequest;
  });
  const generated = await run(t, s.id);
  expect(generated.run?.status, JSON.stringify(t.detailStore.get(s.id)?.latestRun)).toBe("waiting_input");
  expect(generated.outputs.candidates?.candidates).toHaveLength(2);
  const candidate = generated.outputs.candidates!.candidates[0];
  t.packages.select(s.id, { expectedRevision: generated.inputRevision, planId: candidate.plan.id });
  const selected = await run(t, s.id);
  expect(selected.run?.status).toBe("completed");
  const snapshot = exportSnapshot(selected, t.detailStore.get(s.id)!)!;
  validateSnapshot(snapshot);
  expect(snapshot.selectedPlan.context?.find(c => c.id === "terminal")?.kind).toBe("head");
  expect(snapshot.cuts).toHaveLength(5);
  expect(snapshot.cuts[0].length).toBeNull();
  expect(snapshot.materials.some(m => m.subjectIds.includes("terminal"))).toBe(false);
  const start = s.baselinePlan!.entities.find(e => e.id === "pipe")!.ports[0].position!;
  expect(snapshot.selectedPlan.segments[0].from[0]).toBeCloseTo(start.x, 8);
  expect(snapshot.selectedPlan.segments[0].from[1]).toBeCloseTo(start.y, 8);
  const exported = await run(t, s.id, "export_selected_package");
  expect(exported.run?.status).toBe("completed");
  expect(exported.outputs.artifacts).toHaveLength(4);
  const artifact = exported.outputs.artifacts[0];
  const changed = t.packages.edit(s.id, { expectedRevision: exported.inputRevision, patch: { detailing: exported.detailing.map(f => f.field === "duct.max.y" ? { ...f, value: 2 } : f) } });
  expect(changed.baselinePlan).toEqual(s.baselinePlan);
  expect(() => t.packages.artifact(s.id, artifact.id)).toThrow("stale_artifact");
  expect(() => t.packages.select(s.id, { expectedRevision: changed.inputRevision, planId: candidate.plan.id })).toThrow("stale_candidates");
});

it("persists FS-01 steel alternatives with unknown physical closure and no SF/CPVC default", async () => {
  const t = setup(), s = await create(t, 3, false, input => Object.assign(input, fs01Adaptation(input.sourceDrawing!.assetId)));
  const generated = await run(t, s.id);
  expect(generated.outputs.candidates?.candidates, JSON.stringify(t.detailStore.get(s.id)?.latestRun)).toHaveLength(2);
  const details = t.detailStore.get(s.id)!.details;
  expect(details).toHaveLength(3);
  for (const d of details) {
    expect(d.input.nodes.filter(n => n.datum === "scope_interface")).toHaveLength(2);
    expect(d.fabrication.cuts.every(c => c.cutLength.value === null)).toBe(true);
    expect(d.fabrication.materials.some(m => m.productId?.startsWith("spears/"))).toBe(false);
    expect(d.profile?.project.basis).toBeUndefined();
  }
  expect(generated.baselinePlan).toEqual(s.baselinePlan);
});

// Synthetic export contract check only; no steel material/field acceptance claimed.
it("exports closure component identities and unresolved specifications even when counts are known", async () => {
  const t = setup(), s = await create(t, 2, true);
  await run(t, s.id);
  const state = t.detailStore.get(s.id)!;
  const d = state.details[0], input = structuredClone(d.input);
  input.pieces.forEach(p => { p.productId = "unresolved-steel"; });
  input.fittings.forEach(f => { f.productId = "unresolved-steel-elbow"; });
  const piece = input.pieces[0], start = input.nodes.find(n => n.id === piece.startNodeId)!.position.value!;
  const end = input.nodes.find(n => n.id === piece.endNodeId)!.position.value!;
  const condition = { value: null, status: "unknown" as const, evidenceIds: [], reason: "Synthetic fixture; no review" };
  d.fabrication = deriveFixedEndClosure(input, spearsCatalog(input.configVersion), {
    id: "closure", binding: input, pipeProductId: "unresolved-steel", unionCandidateId: "anvil/487-black-nps2", splitPieceId: piece.id,
    station: { value: { ...start, x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, z: (start.z + end.z) / 2 },
      status: "proposed", evidenceIds: [], reason: "Synthetic midpoint; not a measured union datum" },
    conditions: { physicalInterfaces: condition, productCompatibility: condition, rotationAndMovement: condition, toolAndBoltAccess: condition },
  });
  const snapshot = exportSnapshot(t.packages.get(s.id), state)!;
  validateSnapshot(snapshot);
  expect(snapshot.materials.find(m => m.id === "closure/gasket")).toMatchObject({
    description: "closure/gasket", quantity: 1, status: "known", unresolvedReason: expect.stringContaining("supply scope unresolved"),
  });
  expect(snapshot.materials.find(m => m.id === "closure/bolts")).toMatchObject({ quantity: 4, status: "known" });
  expect(snapshot.cuts.filter(c => c.pieceId.includes("closure")).every(c => c.length === null)).toBe(true);
  expect(snapshot.assembly.filter(o => o.instruction.startsWith("Review")).every(o => o.status === "unresolved")).toBe(true);
});


it("does not request CPVC cure for a steel interval with CPVC retained elsewhere in scope", async () => {
  const t = setup(), s = await create(t, 3, false, input => {
    const access = input.detailing.find(f => f.field === "workAreaAccess")!;
    const cpvc = input.baselinePlan!.entities.find(e => e.kind === "pipe")!.productId;
    Object.assign(input, fs01Adaptation(input.sourceDrawing!.assetId));
    input.detailing.push(access);
    input.baselinePlan!.entities.find(e => e.id === "P28")!.productId = cpvc;
    input.scope!.excludedEntityIds = input.scope!.excludedEntityIds.filter(id => id !== "P28");
    input.scope!.includedEntityIds.push("P28");
  });
  const result = await run(t, s.id);
  expect(result.outputs.candidates?.candidates).toHaveLength(2);
  t.packages.select(s.id, { expectedRevision: result.inputRevision, planId: result.outputs.candidates!.candidates[0].plan.id });
  const selected = await run(t, s.id);
  expect(selected.outputs.requests.some(r => /cure/i.test(r.question))).toBe(false);
});

it("labels only baseline cuts as drawing projections, not generated alternatives", async () => {
  const t = setup(), s = await create(t, 3, false, input => {
    Object.assign(input, fs01Adaptation(input.sourceDrawing!.assetId));
    input.sourceDrawing!.view = fs01View;
    input.sourceDrawing!.scale.value = MM_PER_PT;
  });
  await run(t, s.id);
  const details = t.detailStore.get(s.id)!.details;
  expect(details).toHaveLength(3);
  const projection = "Projected plan length from the drawing, so physical length and elevation are not verified";
  expect(details[0].fabrication.cuts[0].cutLength.reasons).toContain(projection);
  for (const d of details.slice(1)) {
    expect(d.fabrication.cuts.length).toBeGreaterThan(0);
    for (const c of d.fabrication.cuts) {
      expect(c.cutLength.value).toBeNull();
      expect(c.cutLength.reasons).not.toContain(projection);
    }
  }
});

it("does not label a typed run as a drawing projection when a sheet view is saved", async () => {
  const t = setup(), s = await create(t, 3, false, input => {
    Object.assign(input, fs01Adaptation(input.sourceDrawing!.assetId));
    input.sourceDrawing!.view = fs01View;
    input.sourceDrawing!.scale.value = MM_PER_PT;
    const room = { ...input.baselinePlan!.coordinateFrame, id: "room" };
    input.baselinePlan!.coordinateFrame = room;
    input.scope!.coordinateFrame = room;
  });
  await run(t, s.id);
  const projection = "Projected plan length from the drawing, so physical length and elevation are not verified";
  expect(t.detailStore.get(s.id)!.details[0].fabrication.cuts[0].cutLength.reasons).not.toContain(projection);
});

it("lists every entity outside the affected span as retained context in adaptation", async () => {
  const t = setup(), s = await create(t, 3, false, input => {
    Object.assign(input, fs01Adaptation(input.sourceDrawing!.assetId));
    input.scope!.excludedEntityIds = input.scope!.excludedEntityIds.filter(id => id !== "P28");
    input.scope!.includedEntityIds.push("P28");
  });
  await run(t, s.id);
  const ids = exportSnapshot(t.packages.get(s.id), t.detailStore.get(s.id)!)!.retainedContext.map(r => r.id);
  expect(ids).toContain("P28");
  expect(ids).not.toContain("P27");
  expect(ids).not.toContain("H1");
  expect(ids).not.toContain("H3");
});

it("returns scoped registered passages and detailed saved results to Pi without artifact bytes", async () => {
  const t = setup();
  const s = await create(t, 2, true);
  const library = new SourceStore(t.field.store.db);
  for (const [id, projectId] of [["this-project", s.projectId], ["other-project", "another-project"]]) library.import({
    id, title: id, publisher: "Test author", type: "project_document", edition: "1", scope: {projectId},
    demonstration: true, authorization: {basis:"Authored fixture", storeAndIndex:true,useWithAi:true,display:"full"},
    content: "## 1.1 Cut instructions\nInspect physical ends before cutting the pipe.", filename: id + ".md",
  });
  await run(t, s.id);
  const text = JSON.stringify(t.toolResults);
  expect(text).toContain("this-project");
  expect(text).toContain("Inspect physical ends before cutting");
  expect(text).not.toContain("other-project");
  expect(t.sourceQueries).toContainEqual({ query: "cut", keys: ["this-project"] });
  expect(text).toContain("cutLength");
  expect(text).toContain("ruleExecutions");
  expect(text).toContain("sourceRefs");
  t.toolResults.splice(0);
  await run(t, s.id, "export_selected_package");
  const exported = t.toolResults.find(r => r.name === "export_work_package");
  expect(JSON.stringify(exported)).toContain("work-package.pdf");
  expect(JSON.stringify(exported)).toContain("byteLength");
  expect(JSON.stringify(exported)).not.toContain('"type":"Buffer"');
});


it("does not advertise an arbitrary derive subject as a valid rule target", async () => {
  const steps: {name:string;arguments:Record<string,unknown>}[] = [];
  const t = setup(undefined, scriptedStream(steps));
  const s = await create(t,3);
  const wrongTarget = s.changeRequest!.id;
  const ruleId = getProjectRuleCatalog().find(r=>r.id.startsWith("TFP171"))!.id;
  steps.push(
    {name:"generate_change_candidates",arguments:{subjectId:s.id}},
    {name:"derive_work_package",arguments:{subjectId:wrongTarget}},
    {name:"select_verification_rule",arguments:{context:"Synthetic regression selects one catalog rule"}},
    {name:"evaluate_work_package",arguments:{subjectId:wrongTarget,ruleId}},
    {name:"finish_work",arguments:{status:"blocked",explanation:"Invalid rule target must be recoverable."}},
  );
  const result = await run(t,s.id);
  expect(result.run?.status, JSON.stringify(t.detailStore.get(s.id)?.latestRun)).toBe("blocked");
  expect(t.detailStore.get(s.id)?.latestRun?.error).toBeUndefined();
  expect(t.detailStore.get(s.id)?.refs.some(r=>r.kind === "package" && r.subjectId === wrongTarget)).toBe(false);
  expect(JSON.stringify(t.toolResults.find(r=>r.name === "evaluate_work_package"))).toContain("allowedSubjectIds");
});

it("executes each catalog adapter on every synthetic site plan without domain exceptions", async () => {
  const t = setup(), s = await create(t,3);
  await run(t,s.id);
  const details = t.detailStore.get(s.id)!.details;
  expect(details).toHaveLength(3);
  const errors: {ruleId:string;planId:string;error:string}[] = [];
  const catalog = getProjectRuleCatalog();
  expect(catalog.length).toBe(47);
  for (const rule of catalog) for (const d of details) {
    try { evaluateProfile(s,d.input,d.fabrication,d.plan,details[0].plan,rule.id); }
    catch(error) { errors.push({ruleId:rule.id,planId:d.plan.id,error:error instanceof Error ? error.message : String(error)}); }
  }
  expect(errors).toEqual([]);
});


it.each(["uncalculated", "unevaluated", "baseline-only", "one-candidate", "pending-rule", "unimplemented-rule", "stale-evaluation", "stale-state", "unknown-reviewed"] as const)("guards comparison, adoption questions and the selection API: %s", async mode => {
  const steps: {name:string;arguments:Record<string,unknown>}[] = [];
  const stateFilter = mode === "pending-rule" ? "source_pending" : mode === "unimplemented-rule" ? "unimplemented" : undefined;
  const ruleId = stateFilter ? getProjectRuleCatalog().find(r=>r.implementationStatus === stateFilter)!.id : "N01_SF_EDITION_BASIS";
  const choice: ChoiceClient = {async choose(request) {
    const ids = Object.keys(request.questions.next_action.criteria);
    return {...request.state,response:{model:request.model,answers:{next_action:{type:"choice",choice:ruleId,confidence:1,probabilities:Object.fromEntries(ids.map(id=>[id,id===ruleId?1:0]))}}}};
  }};
  const t = setup(choice, scriptedStream(steps)), initial = await create(t,3);
  const call = (name:string,args:Record<string,unknown>={}) => ({name,arguments:args});
  const stop = () => call("finish_work",{status:"blocked",explanation:"Regression phase boundary"});
  steps.push(call("generate_change_candidates",{subjectId:initial.changeRequest!.id}));
  if(mode !== "uncalculated") steps.push(call("derive_work_package",{subjectId:initial.baselinePlan!.id}));
  steps.push(stop());
  const generated = await run(t,initial.id), candidates = generated.outputs.candidates!;
  expect(candidates.candidates).toHaveLength(2);
  if(!["uncalculated","unevaluated"].includes(mode)) {
    const subjectId = mode === "baseline-only" ? initial.baselinePlan!.id : mode === "one-candidate" ? candidates.candidates[0].plan.id : initial.id;
    steps.push(call("select_verification_rule",{context:"Select the test rule"}),call("evaluate_work_package",{subjectId,ruleId}),stop());
    await run(t,initial.id);
  }
  const state = t.detailStore.get(initial.id)!;
  if(mode === "stale-evaluation") state.refs.filter(r=>r.kind === "evaluation").forEach(r=>r.inputRevision--);
  if(mode === "stale-state") state.inputRevision--;
  // A pre-existing empty comparison reference must not bypass the new guard.
  if(mode !== "unknown-reviewed") state.refs.push({id:"old-empty-comparison",kind:"comparison",subjectId:candidates.id,inputRevision:generated.inputRevision,configVersion:generated.configVersion});
  t.detailStore.save(initial.id,state);
  steps.push(call("compare_candidates",{subjectId:candidates.id}),...['drawing','sources','results','answers'].map(kind=>call("inspect_saved_information",{kind})),call("request_input",{id:"adopt",text:"Choose a candidate",subjectId:initial.changeRequest!.id,kind:"candidate_selection"}),stop());
  const result = await run(t,initial.id);
  const reviewed = mode === "unknown-reviewed";
  expect(result.run?.status).toBe(reviewed ? "waiting_input" : "blocked");
  expect(t.detailStore.get(initial.id)?.latestRun?.question?.kind).toBe(reviewed ? "candidate_selection" : undefined);
  const comparison = t.toolResults.filter(r=>r.name === "compare_candidates").at(-1)!;
  if(!reviewed) expect(JSON.stringify(comparison)).toContain("candidate_review_incomplete");
  else expect(t.detailStore.get(initial.id)!.details.every(d=>d.profile!.checks.some(c=>c.status === "unknown"))).toBe(true);
  const response = await t.app.request(`/api/work-packages/${initial.id}/selection`,{
    method:"POST",headers:{Authorization:"Bearer integration-test-token","Content-Type":"application/json"},
    body:JSON.stringify({expectedRevision:result.inputRevision,planId:candidates.candidates[0].plan.id}),
  });
  expect(response.status).toBe(reviewed ? 200 : 409);
  if(!reviewed) {expect(await response.text()).toContain("candidate_review_incomplete");expect(t.packages.get(initial.id).selectedPlan).toBeNull();}
  else expect(t.packages.get(initial.id).selectedPlan?.id).toBe(candidates.candidates[0].plan.id);
});

it("keeps synthetic open-end topology usable without confirming fabrication dimensions", async () => {
  const t = setup();
  const s = await create(t, 2, true, input => {
    input.detailing = input.detailing.map(f => f.field.startsWith("datum.")
      ? { ...f, confirmation: "proposed", provenance: "synthetic_assumption", source: { ...f.source, description: "SAMPLE: fictional endpoint datum" } }
      : f);
  });
  const result = await run(t, s.id);
  expect(result.run?.status).not.toBe("failed");
  const cuts = t.detailStore.get(s.id)!.details[0].fabrication.cuts;
  expect(cuts).toHaveLength(2);
  expect(cuts.every(c => c.cutLength.value === null)).toBe(true);
  expect(result.outputs.results.some(r => r.materials.length > 0)).toBe(true);
});
