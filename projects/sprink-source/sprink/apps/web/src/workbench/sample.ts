import type { PackageInputs } from "@sprink/core";
import { buildRun, upsertFacts, type FactSpec, type RunNode } from "./model.js";

/**
 * SAMPLE INPUT, NOT FIELD DATA.
 * Invented values for exercising the real API end to end.
 * Everything written here carries a "SAMPLE" source line, and the UI shows a Sample badge while
 * any sample fact is in the package. Production behaviour never reads this file.
 */
export const SAMPLE_SOURCE = "SAMPLE: invented test assumption, not field evidence";
export const SAMPLE_CURE = "SAMPLE: FG-3 pp27-28 new work, 70 F, dry normal fit, 1 inch, up to 225 psi, minimum 90 minutes. Invented, not a field confirmation.";

const PREPARE_RUN: RunNode[] = [{ kind: "tie_in", x: 0, y: 0 }, { kind: "elbow", x: 609.6, y: 0 }, { kind: "tie_in", x: 609.6, y: 457.2 }];
const ADAPT_RUN: RunNode[] = [{ kind: "tie_in", x: 0, y: 0 }, { kind: "tie_in", x: 10000, y: 0 }];

export function sampleInputs(kind: "prepare" | "adapt", assetId: string): Pick<PackageInputs, "sourceDrawing" | "baselinePlan" | "scope" | "detailing" | "siteFacts" | "changeRequest"> {
  const built = buildRun(kind === "prepare" ? PREPARE_RUN : ADAPT_RUN, "baseline", SAMPLE_SOURCE);
  if ("problems" in built) throw new Error(built.problems.join(" "));
  const assumed = (spec: Omit<FactSpec, "confirmation" | "context" | "source"> & { context?: FactSpec["context"] }): FactSpec =>
    ({ context: "detailing", ...spec, confirmation: "proposed", provenance: "synthetic_assumption", source: SAMPLE_SOURCE });
  const specs: FactSpec[] = built.datums.map(d => ({ ...d, confirmation: "proposed", provenance: "synthetic_assumption", source: SAMPLE_SOURCE }));
  for (const tie of built.scope.tieInEntityIds) specs.push(assumed({ field: "netCutOffset", value: 50, unit: "mm", subjectIds: [tie] }));
  for (const fit of built.plan.entities.filter(e => e.kind === "fitting"))
    for (const port of fit.ports) specs.push(assumed({ field: `movement.${port.id}`, value: true, subjectIds: [fit.id] }));
  specs.push(assumed({ field: "workAreaAccess", value: true }), assumed({ field: "curePlan", value: SAMPLE_CURE }));
  for (const [field, value] of [["jurisdiction", "san_francisco"], ["standard", "nfpa13"], ["permitKind", "revision"], ["originalNfpa13Edition", "2025"],
    ["originalFirePermitNumber", "SAMPLE-ONLY"], ["systemType", "wet"], ["sprinklerType", "standard_spray"], ["storage", "non_storage"]] as const)
    specs.push(assumed({ field, value }));
  if (kind === "adapt") {
    const box = (prefix: string, values: number[]) => ["min.x", "min.y", "min.z", "max.x", "max.y", "max.z"].forEach((k, i) =>
      specs.push(assumed({ field: `${prefix}.${k}`, value: values[i], unit: "mm", context: "observed" })));
    box("duct", [4000, -400, -500, 6000, 400, 500]);
    box("workEnvelope", [-200, -2800, -300, 10200, 2300, 300]);
    specs.push(assumed({ field: "requiredPipeClearance", value: 100, unit: "mm", context: "observed" }));
  }
  const facts = upsertFacts({ detailing: [], siteFacts: [] }, specs);
  return {
    sourceDrawing: { assetId, drawingId: "SAMPLE-FP-201", revision: "C", page: 1, approval: "unreviewed", scale: { value: 1, unit: "mm/pixel", basis: kind === "prepare" ? "proposed_inputs" : "confirmed_inputs", reason: null } },
    baselinePlan: { ...built.plan, confirmation: kind === "prepare" ? "proposed" : "confirmed" },
    scope: built.scope,
    ...facts,
    changeRequest: kind === "adapt"
      ? { id: "duct-conflict", description: "SAMPLE: measured duct blocks the existing branch", affectedEntityIds: ["p1"], factIds: facts.siteFacts.filter(f => f.field.startsWith("duct.")).map(f => f.id) }
      : null,
  };
}

/** True while any fact or the drawing came from the sample loader. */
export function hasSampleData(s: Pick<PackageInputs, "detailing" | "siteFacts" | "sourceDrawing">): boolean {
  return s.sourceDrawing?.drawingId.startsWith("SAMPLE") === true || [...s.detailing, ...s.siteFacts].some(f => f.source.description.startsWith("SAMPLE"));
}

/** A plain PNG marked SAMPLE DRAWING, drawn in the browser, so the sample has a real uploaded asset. */
export async function sampleDrawing(kind: "prepare" | "adapt"): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 1600; canvas.height = 1000;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, 1600, 1000);
  g.strokeStyle = "#c9ced6"; g.lineWidth = 1;
  for (let x = 0; x <= 1600; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1000); g.stroke(); }
  for (let y = 0; y <= 1000; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(1600, y); g.stroke(); }
  g.strokeStyle = "#1f2937"; g.lineWidth = 6;
  g.beginPath();
  if (kind === "prepare") { g.moveTo(400, 700); g.lineTo(1000, 700); g.lineTo(1000, 250); }
  else { g.moveTo(200, 500); g.lineTo(1400, 500); }
  g.stroke();
  if (kind === "adapt") { g.setLineDash([12, 8]); g.lineWidth = 3; g.strokeRect(680, 420, 240, 160); g.setLineDash([]); }
  g.fillStyle = "#b45309"; g.font = "bold 44px sans-serif"; g.fillText("SAMPLE DRAWING, NOT A REAL SHEET", 60, 90);
  g.fillStyle = "#374151"; g.font = "28px sans-serif"; g.fillText(`SAMPLE-FP-201 Rev C · ${kind === "prepare" ? "two-span branch between tie-ins" : "branch between two tie-ins"}`, 60, 140);
  g.strokeStyle = "#111827"; g.lineWidth = 3; g.strokeRect(1080, 820, 480, 140);
  g.font = "24px sans-serif"; g.fillText("Sprink demo sheet", 1100, 870); g.fillText("Invented for demonstration", 1100, 910);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("Could not draw the sample sheet")), "image/png"));
  return new File([blob], `sample-${kind}-drawing.png`, { type: "image/png" });
}
