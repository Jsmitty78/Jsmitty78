import { isSyntheticPackageFact, adaptationFrame, getProjectRuleCatalog, type WorkPackageSnapshot } from "@sprink/core";
import type { FabricationOutput } from "@sprink/fabrication";
import {
  ExportError,
  type ExportSnapshot,
  type PlanView,
  type ExportBinding,
  type ChangeRow,
} from "../exports/types.js";
import type { Detail, IntegratedState } from "./runtime.js";
import { materialDescription, retainedContext } from "./describe.js";
import { reviewFingerprint } from "../work-packages/site-work.js";
import { siteEnvelopeChecks } from "./site-envelope.js";

const isAssumption = (description: string) =>
  description.startsWith("ASSUMPTION:");

function view(d: Detail, s: WorkPackageSnapshot): PlanView {
  const point = (v: FabricationOutput["cuts"][number]["start"]) => {
    if (!v.value)
      throw new ExportError(
        422,
        "Drawing coordinates are unresolved; supply them before rendering a plan.",
      );
    const p = v.value,
      k = { m: 1000, mm: 1, ft: 304.8, in: 25.4 }[p.unit];
    const raw = { x: p.x * k, y: p.y * k, z: p.z * k };
    const q = s.intent === "adapt_to_site" ? adaptationFrame(s).toDrawing(raw) : raw;
    return [q.x, q.y, q.z] as [number, number, number];
  };
  const label = (id: string) => s.detailing.find(f => f.field === "sourceLabel" && f.subjectIds.includes(id))?.value?.toString();
  const active = s.intent === "adapt_to_site" ? s.changeRequest!.affectedEntityIds : s.scope?.includedEntityIds ?? [];
  return {
    id: d.plan.id,
    title: d.plan.id,
    unit: "mm",
    segments: d.fabrication.cuts.map((c) => ({
      id: c.pieceId,
      sourceLabel: label(c.pieceId),
      pieceIds: [c.pieceId],
      from: point(c.start),
      to: point(c.end),
    })),
    context: s.baselinePlan!.entities.filter(e => !active.includes(e.id)).map(e => ({
      id: e.id, sourceLabel: label(e.id), kind: e.kind,
      positions: e.ports.flatMap(p => p.position ? [[p.position.x, p.position.y, p.position.z] as [number, number, number]] : []),
    })),
    joints: d.fabrication.joints.map((j) => {
      const c = d.fabrication.cuts.find((c) => c.pieceId === j.pieceId)!;
      return { id: j.id, position: point(j.end === "start" ? c.start : c.end) };
    }),
  };
}
/** Read only saved engine outputs. Never recalculate or stamp old outputs with current versions. */
export function exportSnapshot(
  s: WorkPackageSnapshot,
  state: IntegratedState,
): ExportSnapshot | null {
  const selected = s.selectedPlan?.id ?? s.baselinePlan?.id;
  const d = state.details.find((d) => d.fabrication.planId === selected),
    baseline = state.details.find(
      (d) => d.fabrication.planId === s.baselinePlan?.id,
    );
  if (!d || !baseline || !s.sourceDrawing) return null;
  // A calculated draft can be exported before verification, but every catalog rule
  // remains explicitly unexecuted/unknown. This never evaluates a rule for JEV.
  const checks = d.profile?.checks ?? getProjectRuleCatalog().map(rule=>({
    id:`UNEXECUTED-${rule.id}`,subjectIds:[],status:'unknown' as const,state:'not_executed',
    reason:`No verification execution is recorded. ${rule.title}: applicability and required evidence remain unconfirmed.`,sourceRefs:[] as string[],
  }));
  const f = d.fabrication;
  const binding = (
    revision: number,
    config: string,
    selection: string,
  ): ExportBinding => ({
    packageId: s.id,
    inputRevision: revision,
    configVersion: config,
    modelVersion: config,
    selectionId: selection,
    catalogVersion: config,
    engineVersion: config,
    rulesVersion: config,
    evidenceVersion: String(revision),
    outputVersion: d.id,
  });
  const sources = new Map(
    f.sources.map((x) => [
      x.id,
      {
        id: x.id,
        title: x.document,
        reference: `${x.url}; ${x.revision}; ${x.pages}`,
      },
    ]),
  );
  for (const e of f.evidence) sources.set(e.id, { id: e.id, title: e.id, reference: e.description });
  const inputFacts = [...s.detailing, ...s.siteFacts].map(f => ({ ...f, provenance: f.provenance ?? "unspecified_legacy" }));
  for (const fact of inputFacts) sources.set(fact.id, { id: fact.id, title: `${fact.field}: ${fact.value ?? "unknown"} ${fact.unit ?? ""}`, reference: `${fact.confirmation}; ${fact.provenance}; ${fact.source.description}; asset ${fact.source.assetId ?? "none"}; page ${fact.source.page ?? "unknown"}` });
  for (const c of checks)
    for (const ref of c.sourceRefs)
      if (!sources.has(ref))
        sources.set(ref, { id: ref, title: ref, reference: ref });
  const reason = (values: string[], fallback: string) =>
    values.join("; ") || fallback;
  const changes: ChangeRow[] = [];
  if (s.intent === "adapt_to_site" && d.delta) {
    for (const row of d.delta.materials)
      changes.push({
        id: `material-${row.id}`,
        kind:
          row.baselineQuantity === 0
            ? "added"
            : row.candidateQuantity === 0
              ? "removed"
              : "changed",
        entityType: "material",
        subjectIds: [row.id],
        before: String(row.baselineQuantity ?? "unknown"),
        after: String(row.candidateQuantity ?? "unknown"),
        description: `Quantity delta ${row.quantityDelta ?? "unknown"}; cut delta ${row.cutLengthDeltaM ?? "unknown"} m`,
        sourceIds: [],
      });
    for (const row of d.delta.pieces)
      changes.push({
        id: `cut-${row.pieceId}`,
        kind: row.proposedReuse
          ? "proposed_reuse"
          : row.state === "unchanged"
            ? "retained"
            : row.state === "unknown"
              ? "changed"
              : (row.state as ChangeRow["kind"]),
        entityType: "cut",
        subjectIds: [row.pieceId],
        before:
          baseline.fabrication.cuts
            .find((c) => c.pieceId === row.pieceId)
            ?.cutLength.value?.toString() ?? null,
        after:
          f.cuts
            .find((c) => c.pieceId === row.pieceId)
            ?.cutLength.value?.toString() ?? null,
        description: `Cut delta ${row.cutLengthDeltaM ?? "unknown"} m; geometry remains proposed`,
        sourceIds: [],
      });
    changes.push(
      {
        id: "joint-count",
        kind: "changed",
        entityType: "joint",
        subjectIds: [],
        before: String(baseline.fabrication.joints.length),
        after: String(f.joints.length),
        description: "Joint count, not approval of field closure",
        sourceIds: [],
      },
      {
        id: "operation-count",
        kind: "changed",
        entityType: "operation",
        subjectIds: [],
        before: String(baseline.fabrication.operations.length),
        after: String(f.operations.length),
        description: "Operation count including unresolved steps",
        sourceIds: [],
      },
    );
  }
  return {
    binding: binding(s.inputRevision, s.configVersion, selected!),
    derivedBinding: binding(f.inputRevision, f.configVersion, f.planId),
    intent: s.intent,
    title: s.title,
    scope: `${(s.intent === "adapt_to_site" ? s.changeRequest?.affectedEntityIds : s.scope?.includedEntityIds)?.join(", ") || "Scope unresolved"}; ${f.quantityBasis}; no construction approval`,
    drawingReference: `${s.sourceDrawing.drawingId} revision ${s.sourceDrawing.revision}, page ${s.sourceDrawing.page}, ${s.sourceDrawing.approval}; asset ${s.sourceDrawing.assetId}`,
    inputFacts,
    selectedPlan: view(d, s),
    ...(s.intent === "adapt_to_site" ? { baselinePlan: view(baseline, s) } : {}),
    materials: f.materials.map((m) => ({
      id: m.id,
      description: materialDescription(s, m),
      quantity: m.quantity.value,
      unit: m.quantity.unit,
      status: m.quantity.value === null ? "unresolved" : "known",
      subjectIds: m.entityIds,
      sourceIds:
        f.selectedProducts.find((p) => p.id === m.productId)?.sourceIds ?? [],
      unresolvedReason:
        m.reasons.length || m.quantity.value === null
          ? reason(m.reasons, "Quantity unresolved")
          : null,
    })),
    cuts: f.cuts.map((c) => ({
      pieceId: c.pieceId,
      segmentIds: [c.pieceId],
      jointIds: f.joints
        .filter((j) => j.pieceId === c.pieceId)
        .map((j) => j.id),
      length: c.cutLength.value,
      unit: "m",
      centerline: c.centerline.value,
      status: c.cutLength.value === null ? "unresolved" : "known",
      sourceIds: [...new Set([...c.centerline.evidenceIds, ...c.takeouts.flatMap(t => [...t.sourceIds, ...t.netTakeout.evidenceIds])])],
      unresolvedReason:
        c.cutLength.value === null
          ? reason(c.cutLength.reasons, "Cut unresolved")
          : null,
    })),
    assembly: f.operations.map((o) => ({
      id: o.id,
      instruction: o.instruction,
      pieceIds: o.pieceIds,
      jointIds: o.jointIds,
      sourceIds: o.sourceIds,
      status:
        o.status === "planned"
          ? "known"
          : o.status === "unsupported"
            ? "unsupported"
            : "unresolved",
      unresolvedReason:
        o.status === "planned"
          ? null
          : reason(o.reasons, "Unsupported procedure"),
    })),
    changes,
    ...(s.siteWork ? { siteReview: { alternatives:(s.outputs.candidates?.candidates??[]).map((c,index)=>{
      const result=s.outputs.results.filter(r=>r.planId===c.plan.id).at(-1);
      return {label:`Route ${String.fromCharCode(65+index)}${s.selectedPlan?.id===c.plan.id?' (selected)':''} / ${c.plan.id}`,
        metrics:[...c.metrics.map(m=>`${m.name}: ${m.quantity.value??'unknown'} ${m.quantity.unit??''}`),`Fittings: ${c.plan.entities.filter(e=>e.kind==='fitting').length}`].join('\n'),
        cuts:result?result.cuts.map(cut=>`${cut.pieceId}: ${cut.length.value??'UNKNOWN'} ${cut.length.unit??''}`).join('\n'):'Not calculated',
        binding:`Candidate revision ${s.outputs.candidates!.inputRevision}; calculation revision ${result?.inputRevision??'none'}; ${result?.inputRevision===s.inputRevision&&result.configVersion===s.configVersion?'current calculation':'historical calculation — revalidation required'}`};
    }), reason:s.changeRequest?.description ?? '', evidence:s.siteWork.evidence.map(e=>({label:e.label,page:e.page,synthetic:e.synthetic})), readings:s.siteWork.readings.map(r=>`${r.reviewedAt?'Reviewed':'Unconfirmed'} reading ${r.id}: ${r.notes}`), reviews:s.siteWork.reviews.map(r=>({...r,current:r.fingerprint===reviewFingerprint(s)})) } } : {}),
    findings: [...checks, ...siteEnvelopeChecks(s,s.selectedPlan ?? s.baselinePlan!)].map((c) => ({
      id: c.id,
      status: c.status,
      description: `${c.state}: ${c.reason}`,
      subjectIds: c.subjectIds,
      sourceIds: c.sourceRefs,
    })),
    unresolvedItems: [
      ...(s.intent === "adapt_to_site" ? ["Full quantities and delta cover only the active interval. Protected context is retained, excluded from purchase quantities, and not checked for clearance or constructability.", ...s.baselinePlan!.entities.filter(e => !s.changeRequest!.affectedEntityIds.includes(e.id) && !e.ports.some(p => p.position)).map(e => `Protected context ${e.id}: position unknown; retained in saved plan but cannot be drawn.`)] : []),
      ...s.siteFacts.map(f => `${f.field}: ${f.value ?? "unknown"} ${f.unit ?? ""}; ${f.confirmation}; ${f.provenance ?? "unspecified_legacy"}; ${f.source.description}`),
      ...s.detailing.filter(f => /fixture|fictional|invented|assum/i.test(f.source.description)).map(f => `${f.field}: ${f.source.description}`),
      ...f.gaps.map((g) => `${g.subjectId}: ${g.reason}`),
      ...(f.planRole === "candidate"
        ? [
            "Candidate geometry is proposed, not confirmed or approved. All numeric cuts are provisional.",
          ]
        : []),
      ...(f.joints.some((j) => !j.procedureId)
        ? [
            "Fixed tie-in closure is unsupported by the current catalog and procedure.",
          ]
        : []),
    ],
    sources: [...sources.values()],
    retainedContext: retainedContext(s),
    inputs: [...s.siteFacts, ...s.detailing].map((x) => ({
      id: x.id,
      field: x.field,
      subjectIds: x.subjectIds,
      value: x.value,
      unit: x.unit,
      status: x.value === null ? "unknown" : x.confirmation,
      basis: isSyntheticPackageFact(x) || isAssumption(x.source.description)
        ? "test_assumption"
        : x.source.description.startsWith("SAMPLE")
          ? "sample"
          : "recorded",
      source: x.source.description,
      evidenceAssetId: x.source.assetId,
    })),
  };
}
