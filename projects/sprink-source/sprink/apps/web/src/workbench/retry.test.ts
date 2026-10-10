import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { Snapshot } from "./api.js";
import { setLocale } from "./locale.js";
import { Workbench } from "./Workbench.js";

let snapshot: Snapshot;
vi.mock("./usePackage.js", () => ({ usePackage: () => ({ snapshot, loading: false, detail: null, busy: "", error: "", notice: "", act: vi.fn(), setNotice: vi.fn() }) }));
afterEach(() => setLocale("ja"));
it.each(["failed", "interrupted", "waiting_input"])("keeps selected-route retry available after %s with stale candidates", status => {
  const example = (kind: string) => JSON.parse(readFileSync(new URL(`../../../../docs/contracts/examples/scenario-3.${kind}.json`, import.meta.url), "utf8"));
  const inputs = example("create"), outputs = example("outputs");
  snapshot = {
    ...inputs, id: "retry-package", sourceDrawing: null, inputRevision: 2, configVersion: "test",
    selectedPlan: outputs.candidates.candidates[0].plan, outputs: { requests: [], artifacts: [], ...outputs },
    run: { id: "run", status }, answers: [],
    freshness: { candidates: false, results: outputs.results.map((r: {id: string}) => ({ id: r.id, current: false })), requests: [], artifacts: [] },
  } as Snapshot;
  setLocale("en");
  const html = renderToStaticMarkup(createElement(Workbench, { id: snapshot.id, onHome() {}, onOpen() {}, onAuthFailure() {} }));
  expect(html).toContain("Retry selected route");
  expect(html).toContain("Regenerate routes");
});
