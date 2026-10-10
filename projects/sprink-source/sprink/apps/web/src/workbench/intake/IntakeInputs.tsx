import { tr } from "../locale.js";
import { useEffect, useState } from "react";
import type { DrawingRef, DrawingView, PackageInputs } from "@sprink/core";
import { api, type Snapshot } from "../api.js";
import { lengthText } from "../format.js";
import { factStatus, patchClearing, type Act, type Unit } from "../inputs.js";
import { dropOrphanFacts, dropSubjectFacts, evidenceSpec, factProvenance, findFact, PROVENANCE_LABELS, upsertFacts, type FactSpec, type Provenance } from "../model.js";
import { PRODUCT_SETS, productSetOf, applyRunProducts } from "../products.js";
import { Badge, Button, Callout, Field, Icon, Section } from "../ui.js";
import { buildTracePlan, FRAME_ID, sheetDistance, spanLengths, type LengthUnit, type TraceNodeKind, type BuiltTrace } from "./sheet.js";
import type { Intake, IntakeTool } from "./useIntake.js";

interface Props { s: Snapshot; act: Act; busy: string; unit: Unit; setNotice: (t: string) => void; intake: Intake; showSheet: () => void }

export const MATERIALS: Array<[string, string]> = [["steel", "Steel"], ["cpvc", "CPVC"], ["copper", "Copper"], ["other", "Other"]];
const UNITS: LengthUnit[] = ["ft", "in", "mm", "m"];
const KIND_LABEL: Record<TraceNodeKind, string> = { interface: "Interface", elbow: "Turn (elbow)", open_end: "Open end" };

const safeId = (text: string) => (text.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^[^a-zA-Z0-9]+/, "") || "drawing").slice(0, 100);
/** Product selections do not invalidate source facts or site geometry. */
export function intakeTracePatch(cur: Snapshot, built: BuiltTrace): Partial<PackageInputs> {
  const geometry = (entities: BuiltTrace["plan"]["entities"]) => entities.map(({ productId: _productId, ...entity }) => entity);
  const graphChanged = JSON.stringify(geometry(built.plan.entities)) !== JSON.stringify(geometry(cur.baselinePlan?.entities ?? []))
    || JSON.stringify(built.plan.connections) !== JSON.stringify(cur.baselinePlan?.connections)
    || JSON.stringify(built.plan.coordinateFrame) !== JSON.stringify(cur.baselinePlan?.coordinateFrame);
  const base = graphChanged ? dropSubjectFacts(cur) : cur;
  const kept = { detailing: base.detailing.filter(f => f.field !== "sourceLabel"), siteFacts: base.siteFacts.filter(f => f.field !== "sourceLabel") };
  const labels: FactSpec[] = built.labels.map(l => ({ field: "sourceLabel", value: l.label, subjectIds: [l.subjectId], confirmation: "confirmed", provenance: "confirmed_evidence", context: "detailing", source: `Label read by you from ${cur.sourceDrawing!.drawingId} p${cur.sourceDrawing!.page}; application IDs are separate`, assetId: cur.sourceDrawing!.assetId, page: cur.sourceDrawing!.page }));
  // The nominal size applies to the traced spans, whatever their new ids are.
  const nominal = findFact(cur, "nominalSize", cur.scope?.includedEntityIds.find(id => id.startsWith("p")));
  const pipes = built.scope.includedEntityIds.filter(id => built.plan.entities.find(e => e.id === id)?.kind === "pipe");
  const carry: FactSpec[] = graphChanged && nominal && typeof nominal.value === "string" ? [{ field: "nominalSize", value: nominal.value, subjectIds: pipes, confirmation: nominal.confirmation, provenance: nominal.provenance, context: "detailing", source: nominal.source.description, assetId: nominal.source.assetId, page: nominal.source.page }] : [];
  return {
    baselinePlan: built.plan, scope: built.scope, ...(graphChanged ? { changeRequest: null } : {}),
    ...dropOrphanFacts(upsertFacts(kept, [...labels, ...carry]), built.plan),
  };
}

/** Upload, work area, scale, plan frame, trace and source requirements: the shared drawing intake. */
export function IntakeInputs(props: Props) {
  const { s, act, busy, setNotice, intake, showSheet } = props;
  const d = s.sourceDrawing;
  const confirmed = s.baselinePlan?.confirmation === "confirmed";
  const frozen = confirmed || d?.approval === "approved";

  const [rev, setRev] = useState(d?.revision ?? "A");
  const [sheetId, setSheetId] = useState(d?.drawingId ?? "");
  const [copyOf, setCopyOf] = useState(d?.view?.derivativeOf ?? "");
  const [products, setProducts] = useState(productSetOf(s));
  const productDirty = products !== productSetOf(s);
  const metadataDirty = rev !== (d?.revision ?? "A") || sheetId !== (d?.drawingId ?? "") || copyOf !== (d?.view?.derivativeOf ?? "");
  useEffect(() => { setRev(d?.revision ?? "A"); setSheetId(d?.drawingId ?? ""); setCopyOf(d?.view?.derivativeOf ?? ""); setProducts(productSetOf(s)); }, [s.inputRevision]);

  const upload = (file: File) => act("upload", async cur => {
    const asset = await api.upload(cur.id, file);
    const view: DrawingView = { sheetUnit: file.type === "application/pdf" ? "pdf_pt" : "image_px", workArea: null, calibration: null, frame: { origin: { x: 0, y: 0 }, rotationDeg: 0 }, derivativeOf: copyOf.trim() || null };
    const patch: Partial<PackageInputs> = {
      sourceDrawing: { assetId: asset.id, drawingId: safeId(file.name), revision: rev.trim() || "A", page: 1, approval: "unreviewed", view,
        scale: { value: null, unit: "mm/pixel", reason: "Scale not calibrated yet", basis: "unknown" } },
    };
    // A trace belongs to the sheet it was drawn on.
    if (cur.baselinePlan?.coordinateFrame.id === FRAME_ID) Object.assign(patch, { baselinePlan: null, scope: null, changeRequest: null, ...dropSubjectFacts({ detailing: cur.detailing, siteFacts: cur.siteFacts }) });
    await patchClearing(cur, patch, setNotice);
    intake.resetTrace();
    showSheet();
  });

  /** One patch for everything the intake owns, so the plan is always rebuilt with the transform saved beside it. */
  const save = (label: string, opts: { confirmScale?: boolean; page?: number } = {}) => act(label, async cur => {
    if (!cur.sourceDrawing) return;
    const newPage = opts.page !== undefined && opts.page !== cur.sourceDrawing.page;
    const t = newPage ? null : intake.draftTransform;
    const c = intake.cal;
    const view: DrawingView = newPage
      ? { sheetUnit: intake.sheet?.unit ?? "pdf_pt", workArea: null, calibration: null, frame: { origin: { x: 0, y: 0 }, rotationDeg: 0 }, derivativeOf: copyOf.trim() || null }
      : {
        sheetUnit: intake.sheet?.unit ?? cur.sourceDrawing.view?.sheetUnit ?? "image_px",
        workArea: intake.workArea,
        calibration: intake.scale === null ? null : {
          method: c.method,
          a: c.method === "two_point" ? c.a : null, b: c.method === "two_point" ? c.b : null,
          realDistance: c.method === "two_point" ? { value: Number(c.distance), unit: c.distanceUnit } : null,
          printedScale: c.method === "printed_scale" ? `${c.paper} ${c.paperUnit} = ${c.real} ${c.realUnit}` : null,
          reference: c.reference.trim() || (c.method === "printed_scale" ? "Printed scale on the sheet" : "Dimension picked on the sheet"),
          pointUncertaintyMm: intake.scale && intake.pickTolerance ? intake.scale * intake.pickTolerance : null,
        },
        frame: { origin: intake.origin, rotationDeg: intake.rotationDeg ?? 0 },
        derivativeOf: copyOf.trim() || null,
      };
    const scale: DrawingRef["scale"] = t
      ? { value: t.scale, unit: "mm/pixel", reason: null, basis: opts.confirmScale || cur.sourceDrawing.scale.basis === "confirmed_inputs" && cur.sourceDrawing.scale.value === t.scale ? "confirmed_inputs" : "proposed_inputs" }
      : { value: null, unit: "mm/pixel", reason: "Scale not calibrated yet", basis: "unknown" };
    const patch: Partial<PackageInputs> = {
      sourceDrawing: { ...cur.sourceDrawing, drawingId: safeId(sheetId || cur.sourceDrawing.drawingId), revision: rev.trim() || cur.sourceDrawing.revision, page: opts.page ?? cur.sourceDrawing.page, view, scale },
    };
    const traced = intake.trace.nodes.length >= 2;
    if (newPage && cur.baselinePlan?.coordinateFrame.id === FRAME_ID) Object.assign(patch, { baselinePlan: null, scope: null, changeRequest: null, ...dropSubjectFacts({ detailing: cur.detailing, siteFacts: cur.siteFacts }) });
    else if (traced && t) {
      const set = PRODUCT_SETS[products];
      const built = buildTracePlan(intake.trace, t, { pipe: set.pipe, elbow: set.elbow }, cur.baselinePlan?.id ?? "baseline");
      if ("problems" in built) throw new Error(built.problems[0]);
      if (!intake.traceDirty && !intake.viewDirty && cur.baselinePlan && cur.scope) {
        built.plan = applyRunProducts(cur.baselinePlan, cur.scope.includedEntityIds, set);
        built.scope = cur.scope;
      }
      Object.assign(patch, intakeTracePatch(cur, built));
    } else if (traced && !t) throw new Error("Set the scale before saving the trace. The trace stays in this browser until then.");
    await patchClearing(cur, patch, setNotice);
    if (traced && t) intake.markTraceSaved();
    intake.markViewSaved();
  });

  const confirmTrace = () => {
    if (!window.confirm("Confirm this trace against the drawing? Later corrections must reopen the trace for review and invalidate generated results.")) return;
    void act("confirm-trace", cur => cur.baselinePlan ? patchClearing(cur, { baselinePlan: { ...cur.baselinePlan, confirmation: "confirmed" } }, setNotice) : Promise.resolve());
  };

  const reopenTrace = () => {
    if (!window.confirm("Reopen the drawing and trace for correction? Current results will become stale. Review the source, scale and trace and confirm them again before generating new results.")) return;
    void act("reopen-trace", cur => cur.sourceDrawing && cur.sourceDrawing.approval !== "approved" ? patchClearing(cur, {
      sourceDrawing: { ...cur.sourceDrawing, approval: "unreviewed", scale: cur.sourceDrawing.scale.value === null ? cur.sourceDrawing.scale : { ...cur.sourceDrawing.scale, basis: "proposed_inputs" } },
      ...(cur.baselinePlan ? { baselinePlan: { ...cur.baselinePlan, confirmation: "proposed" } } : {}),
    }, setNotice) : Promise.resolve());
  };

  if (!d) return <div className="fa-stack">
    <p className="fa-muted">{tr("Upload the sheet for this work: a PDF, or a PNG or JPEG copy, up to 20 MB. It is kept as uploaded and linked to every result. Uploading does not mark it approved.")}</p>
    <div className="fa-row2">
      <Field label={tr("Revision")}><input value={rev} onChange={e => setRev(e.target.value)} maxLength={40} /></Field>
      <Field label={tr("Copy of (optional)")} hint={tr("If this file is a scan, crop or raster of another document, name it.")}><input value={copyOf} onChange={e => setCopyOf(e.target.value)} maxLength={200} placeholder={tr("e.g. FM32361 FS-01 PDF")} /></Field>
    </div>
    <label className={`fa-drop ${busy === "upload" ? "is-busy" : ""}`}>
      <Icon name="upload" /><span>{busy === "upload" ? tr("Uploading…") : tr("Choose drawing file")}</span>
      <input type="file" accept="application/pdf,image/png,image/jpeg" disabled={!!busy} onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
    </label>
  </div>;

  const t = intake.draftTransform;
  const savedScale = d.scale;
  const lengths = t ? spanLengths(intake.trace, t) : [];
  const toolButton = (tool: IntakeTool, label: string, disabled = false) =>
    <Button variant={intake.tool === tool ? "primary" : "default"} disabled={frozen || disabled} onClick={() => { intake.chooseTool(tool); showSheet(); }}>{intake.tool === tool ? tr("{tool}: click the sheet", { tool: tr(label) }) : tr(label)}</Button>;
  const pageCount = intake.sheet?.pages ?? 1;
  const nominal = findFact(s, "nominalSize", s.scope?.includedEntityIds.find(id => id.startsWith("p")));
  const requirement = findFact(s, "materialRequirement"), material = findFact(s, "materialRequirement.material");
  const conflict = PRODUCT_SETS[products].material && typeof material?.value === "string" && material.value !== PRODUCT_SETS[products].material;
  const calibrated = savedScale.basis === "confirmed_inputs";

  return <div className="fa-stack">
    {confirmed && d.approval !== "approved" && <Callout title={tr("Confirmed drawing inputs")}>{tr("Reopen to correct the file, scale, frame, product selection or trace. Existing results become stale and the corrected inputs need confirmation.")}<Button busy={busy === "reopen-trace"} disabled={!!busy} onClick={reopenTrace}>{tr("Reopen drawing and trace")}</Button>
    </Callout>}
    <Section title={tr("Sheet")} defaultOpen={!calibrated}>
      <div className="fa-kv">
        <span>{tr("File")}</span><strong>{d.view?.sheetUnit === "pdf_pt" ? tr("PDF") : tr("Image")}{d.view?.derivativeOf ? `, copy of ${d.view.derivativeOf}` : ""}</strong>
        <span>{tr("Approval")}</span><strong>{d.approval === "approved" ? <Badge tone="green">{tr("Approved drawing")}</Badge> : d.approval === "superseded" ? <Badge tone="red">{tr("Superseded")}</Badge> : <Badge>{tr("Not reviewed")}</Badge>}</strong>
      </div>
      {!frozen && <>
        <div className="fa-row3">
          <Field label={tr("Sheet")}><input className="mono" value={sheetId} onChange={e => setSheetId(e.target.value)} maxLength={100} /></Field>
          <Field label={tr("Revision")}><input value={rev} onChange={e => setRev(e.target.value)} maxLength={40} /></Field>
          <Field label={tr("Page")}>{pageCount > 1
            ? <select value={d.page} onChange={e => { if (window.confirm("Switch page? Each page is its own view: its work area, scale and trace start over.")) void save("page", { page: Number(e.target.value) }); }}>
              {Array.from({ length: pageCount }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select>
            : <input value={d.page} readOnly />}</Field>
        </div>
        <Field label={tr("Copy of (optional)")}><input value={copyOf} onChange={e => setCopyOf(e.target.value)} maxLength={200} placeholder={tr("Name the original if this is a scan or raster")} /></Field>
        <label className="fa-link-file">{tr("Replace file")}<input type="file" accept="application/pdf,image/png,image/jpeg" disabled={!!busy} onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} /></label>
      </>}
    </Section>

    <Section title={tr("Work area")} count={intake.workArea ? tr("set") : undefined} defaultOpen={!intake.workArea}>
      <p className="fa-muted">{tr("The bounded part of the sheet this package covers. Everything else stays on the sheet as context.")}</p>
      {intake.workArea && <p className="mono small">{tr("x")}{" "}{r1(intake.workArea.x)}{tr(", y")}{" "}{r1(intake.workArea.y)}, {r1(intake.workArea.width)} × {r1(intake.workArea.height)} {unitWord(intake.sheet?.unit)}</p>}
      <div className="fa-actions">{toolButton("area", intake.workArea ? "Redraw work area" : "Draw work area")}
        {intake.workArea && !frozen && <Button variant="quiet" onClick={() => intake.setWorkArea(null)}>{tr("Clear")}</Button>}</div>
    </Section>

    <Section title={tr("Scale")} count={calibrated ? tr("confirmed") : savedScale.value ? tr("not confirmed") : tr("missing")} defaultOpen={!calibrated}>
      {!frozen && <div className="fa-chips" role="radiogroup" aria-label={tr("Calibration method")}>
        <label className={`fa-chip ${intake.cal.method === "two_point" ? "is-on" : ""}`}><input type="radio" checked={intake.cal.method === "two_point"} onChange={() => intake.setCal({ ...intake.cal, method: "two_point" })} />{tr("A dimension on the sheet")}</label>
        <label className={`fa-chip ${intake.cal.method === "printed_scale" ? "is-on" : ""}`}><input type="radio" checked={intake.cal.method === "printed_scale"} disabled={intake.sheet?.unit !== "pdf_pt"} onChange={() => intake.setCal({ ...intake.cal, method: "printed_scale" })} />{tr("Printed scale (PDF only)")}</label>
      </div>}
      {intake.cal.method === "two_point" ? <>
        <p className="fa-muted">{tr("Pick both ends of a dimension or grid spacing you can read, then enter its real length.")}</p>
        <div className="fa-actions">{toolButton("calibrate", intake.cal.a && intake.cal.b ? "Pick again" : "Pick two points")}
          {intake.cal.a && intake.cal.b && <span className="mono small">{r1(sheetDistance(intake.cal.a, intake.cal.b))} {unitWord(intake.sheet?.unit)}{" "}{tr("apart")}</span>}</div>
        <div className="fa-row2">
          <Field label={tr("Real length")}><input className="mono" value={intake.cal.distance} disabled={frozen} inputMode="decimal" onChange={e => intake.setCal({ ...intake.cal, distance: e.target.value })} placeholder={tr("e.g. 10")} /></Field>
          <Field label={tr("Unit")}><select value={intake.cal.distanceUnit} disabled={frozen} onChange={e => intake.setCal({ ...intake.cal, distanceUnit: e.target.value as LengthUnit })}>{UNITS.map(u => <option key={u}>{u}</option>)}</select></Field>
        </div>
      </> : <>
        <p className="fa-muted">{tr("The ratio printed on this view. PDF points are 1/72 in of paper, so this holds only for a PDF at its original size.")}</p>
        <div className="fa-scale-eq">
          <input className="mono" value={intake.cal.paper} disabled={frozen} onChange={e => intake.setCal({ ...intake.cal, paper: e.target.value })} aria-label={tr("Paper length")} />
          <select value={intake.cal.paperUnit} disabled={frozen} onChange={e => intake.setCal({ ...intake.cal, paperUnit: e.target.value as LengthUnit })} aria-label={tr("Paper unit")}>{UNITS.map(u => <option key={u}>{u}</option>)}</select>
          <span>=</span>
          <input className="mono" value={intake.cal.real} disabled={frozen} onChange={e => intake.setCal({ ...intake.cal, real: e.target.value })} aria-label={tr("Real length")} />
          <select value={intake.cal.realUnit} disabled={frozen} onChange={e => intake.setCal({ ...intake.cal, realUnit: e.target.value as LengthUnit })} aria-label={tr("Real unit")}>{UNITS.map(u => <option key={u}>{u}</option>)}</select>
        </div>
      </>}
      <Field label={tr("What you calibrated against")}><input value={intake.cal.reference} disabled={frozen} onChange={e => intake.setCal({ ...intake.cal, reference: e.target.value })} placeholder={tr("e.g. Scale bar, or 20'-0\" between grid lines 3 and 4")} maxLength={500} /></Field>
      <div className="fa-kv">
        <span>{tr("Scale")}</span><strong className="mono">{intake.scale ? `${r4(intake.scale)} mm per ${unitWord(intake.sheet?.unit, true)}` : tr("Not set")}</strong>
        <span>{tr("Pick precision")}</span><strong className="small">{intake.scale && intake.pickTolerance ? `about ±${r1(intake.scale * intake.pickTolerance)} mm per picked point at the zoom you used` : tr("Zoom in before picking for a smaller error")}</strong>
        <span>{tr("Saved")}</span><strong>{savedScale.value ? <>{r4(savedScale.value)} {calibrated ? <Badge tone="green">{tr("Confirmed")}</Badge> : <Badge tone="amber">{tr("Not confirmed")}</Badge>}</> : <Badge tone="amber">{tr("No scale")}</Badge>}</strong>
      </div>
    </Section>

    <Section title={tr("Plan frame")} defaultOpen={false}>
      <p className="fa-muted">{tr("Plan X and Y in millimetres, Z up. By default X runs right and Y up the sheet from the work area's corner. Rotate if the sheet is turned.")}</p>
      <div className="fa-row2">
        <Field label={tr("Rotation, degrees")}><input className="mono" value={intake.rotation} disabled={frozen} onChange={e => intake.setRotation(e.target.value)} /></Field>
        <Field label={tr("Origin")}><span className="mono small">{r1(intake.origin.x)}, {r1(intake.origin.y)} {intake.originSet ? "" : tr("(work area corner)")}</span></Field>
      </div>
      <div className="fa-actions">{toolButton("axis", "Pick plan X on the sheet")}{toolButton("origin", "Pick origin")}</div>
      {t && <p className="mono small fa-muted">{tr("plan = rotate(")}{r4(t.rotationDeg)}{tr("°) · ((x −")}{" "}{r1(t.origin.x)}) · {r4(t.scale)}{tr(", −(y −")}{" "}{r1(t.origin.y)}) · {r4(t.scale)}{tr(") mm")}</p>}
    </Section>

    <div className="fa-actions">
      <Button busy={busy === "view"} disabled={!!busy || frozen || (!intake.viewDirty && !metadataDirty)} onClick={() => void save("view")}>{tr("Save sheet settings")}</Button>
      <Button variant="primary" busy={busy === "scale"} disabled={!!busy || frozen || !t || (calibrated && !intake.viewDirty)} onClick={() => void save("scale", { confirmScale: true })}>{tr("Confirm scale")}</Button>
    </div>

    <Section title={tr("Trace the run")} count={intake.trace.nodes.length ? tr("{count} points", { count: intake.trace.nodes.length }) : undefined} defaultOpen={!confirmed}>
      <p className="fa-muted">{tr("Click along the pipe on the sheet. Ends are interfaces (where this work meets something else) or open ends; points between are turns. Heads at an end station stay context: shown, never bought or connected.")}</p>
      <div className="fa-actions wrap">{toolButton("trace", "Trace run")}{toolButton("head", "Mark a head")}{toolButton("context_pipe", "Add context pipe")}
        {!frozen && intake.trace.nodes.length > 0 && <Button variant="quiet" onClick={() => {
          const nodes = intake.trace.nodes.slice(0, -1);
          if (nodes.length >= 2) nodes[nodes.length - 1] = { ...nodes[nodes.length - 1], kind: intake.trace.nodes.at(-1)!.kind, head: intake.trace.nodes.at(-1)!.head };
          intake.setTrace({ ...intake.trace, nodes, pipeLabels: intake.trace.pipeLabels.slice(0, Math.max(nodes.length - 1, 0)) });
        }}>{tr("Undo point")}</Button>}</div>
      {intake.trace.nodes.length > 0 && <div className="fa-table-wrap"><table className="fa-table fa-trace">
        <thead><tr><th>#</th><th>{tr("Point")}</th><th>{tr("Head")}</th><th>{tr("Label")}</th><th>{tr("Sheet x, y")}</th></tr></thead>
        <tbody>{intake.trace.nodes.map((n, i) => {
          const end = i === 0 || i === intake.trace.nodes.length - 1;
          const set = (patch: Partial<typeof n>) => intake.setTrace({ ...intake.trace, nodes: intake.trace.nodes.map((x, j) => j === i ? { ...x, ...patch } : x) });
          return <tr key={i}>
            <td className="mono">{i + 1}</td>
            <td>{frozen || !end ? tr(KIND_LABEL[n.kind]) : <select aria-label={`Point ${i + 1} type`} value={n.kind} onChange={e => set({ kind: e.target.value as TraceNodeKind })}><option value="interface">{tr("Interface")}</option><option value="open_end">{tr("Open end")}</option></select>}</td>
            <td>{end && n.kind !== "elbow" ? <input type="checkbox" aria-label={`Retained head at point ${i + 1}`} checked={n.head} disabled={frozen} onChange={e => set({ head: e.target.checked })} /> : "—"}</td>
            <td><input aria-label={`Point ${i + 1} label`} value={n.label} disabled={frozen} onChange={e => set({ label: e.target.value })} placeholder={n.head ? tr("e.g. H1") : ""} maxLength={60} /></td>
            <td className="mono small"><CoordInput value={n.at.x} disabled={frozen} onChange={x => set({ at: { ...n.at, x } })} label={`Point ${i + 1} x`} />, <CoordInput value={n.at.y} disabled={frozen} onChange={y => set({ at: { ...n.at, y } })} label={`Point ${i + 1} y`} /></td>
          </tr>;
        })}</tbody>
      </table></div>}
      {lengths.length > 0 && <div className="fa-table-wrap"><table className="fa-table">
        <thead><tr><th>{tr("Span")}</th><th>{tr("Label on sheet")}</th><th>{tr("Projected length")}</th></tr></thead>
        <tbody>{lengths.map((len, i) => { const txt = lengthText({ value: len, unit: "mm" }); return <tr key={i}>
          <td className="mono">{i + 1}</td>
          <td><input aria-label={`Span ${i + 1} label`} value={intake.trace.pipeLabels[i] ?? ""} disabled={frozen} maxLength={60} placeholder={tr("e.g. P27")} onChange={e => { const pipeLabels = [...intake.trace.pipeLabels]; pipeLabels[i] = e.target.value; intake.setTrace({ ...intake.trace, pipeLabels }); }} /></td>
          <td>{txt.known ? <span className="fa-len"><span className="mono">{r4(len)}{" "}{tr("mm")}</span><small>{txt.primary}</small></span> : "?"}</td>
        </tr>; })}</tbody>
      </table></div>}
      {lengths.length > 0 && <small className="fa-muted">{tr("Projected plan length of the trace, not a cut or stock length.")}{" "}{intake.scale && intake.pickTolerance ? `Each end carries about ±${r1(intake.scale * intake.pickTolerance)} mm from picking, plus the scale's own error.` : ""}</small>}
      {intake.trace.context.length > 0 && <ul className="fa-context-list">{intake.trace.context.map((c, i) => <li key={i}>
        <span>{c.kind === "head" ? tr("Context head") : tr("Context pipe")}</span>
        <input aria-label={`Context ${i + 1} label`} value={c.label} disabled={frozen} maxLength={60} placeholder={c.kind === "head" ? tr("e.g. H2") : tr("e.g. P30")} onChange={e => intake.setTrace({ ...intake.trace, context: intake.trace.context.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
        {!frozen && <button type="button" className="fa-icon-btn" aria-label={`Remove context ${i + 1}`} onClick={() => intake.setTrace({ ...intake.trace, context: intake.trace.context.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button>}
      </li>)}</ul>}
      {!frozen && <Field label={tr("Pipe and fittings for this run")} hint={tr("Only products with documented dimensions and procedures can be sized. Otherwise cuts and assembly stay unresolved and the source requirement is kept.")}>
        <select value={products} onChange={e => setProducts(e.target.value)}>{Object.entries(PRODUCT_SETS).map(([k, v]) => <option key={k} value={k}>{tr(v.label)}</option>)}</select>
      </Field>}
      {conflict && <Callout title={tr("Material conflict")}>{tr("The source requires")}{" "}{String(material!.value)}{" "}{tr("but")}{" "}{PRODUCT_SETS[products].label}{" "}{tr("is selected. Keep the source material, or record a documented design change before substituting.")}</Callout>}
      {(intake.traceDirty || productDirty) && <p className="fa-warn small">{tr("Unsaved trace, kept in this browser until you save.")}</p>}
      {!frozen && <div className="fa-actions">
        <Button variant="primary" busy={busy === "trace"} disabled={!!busy || intake.trace.nodes.length < 2 || !t} onClick={() => void save("trace")}>{tr("Save trace")}</Button>
        <Button busy={busy === "confirm-trace"} disabled={!!busy || !s.baselinePlan || intake.traceDirty || productDirty || intake.viewDirty || metadataDirty || !calibrated} onClick={confirmTrace}>{tr("Confirm trace")}</Button>
      </div>}
      {!frozen && !t && intake.trace.nodes.length > 0 && <p className="fa-muted small">{tr("Set the scale to save the trace.")}</p>}
      {!frozen && s.baselinePlan && !calibrated && <p className="fa-muted small">{tr("Confirm the scale before confirming the trace.")}</p>}
      {confirmed && <p className="fa-muted"><Badge tone="green">{tr("Trace confirmed")}</Badge> {d.approval === "approved" ? tr("Approved source inputs are immutable; use a new package for a changed drawing.") : tr("Reopen the drawing and trace above to make a reviewed correction.")}</p>}
    </Section>

    <SourceRequirements {...props} nominal={nominal} requirement={requirement} material={material} />
  </div>;
}

/** Build the same provenance-aware facts used by the requirements save action. */
export function sourceRequirementsPatch(cur: Snapshot, values: {
  size: string; text: string; mat: string; provenance: Provenance; source: string; page: number;
  nominalProvenance?: Provenance; materialProvenance?: Provenance; updateSource?: boolean;
}): Pick<PackageInputs, "detailing" | "siteFacts"> {
  const { size, text, mat, provenance, source, page } = values;
  const pipes = cur.scope?.includedEntityIds.filter(id => cur.baselinePlan?.entities.find(e => e.id === id)?.kind === "pipe") ?? [];
  const nominal = findFact(cur, "nominalSize", pipes[0]);
  const mixedNominal = new Set(pipes.map(id => factProvenance(findFact(cur, "nominalSize", id)))).size > 1;
  const requirement = findFact(cur, "materialRequirement"), material = findFact(cur, "materialRequirement.material");
  let result = { detailing: cur.detailing, siteFacts: cur.siteFacts };
  const update = (field: string, value: string, previous: ReturnType<typeof findFact>, selected: Provenance, subjects: string[], description: string, sourcePage: number | undefined, updateSource = false) => {
    const evidence = evidenceSpec(previous, selected, description);
    // An unrelated edit must not rewrite saved evidence, its source, or its provenance.
    if (previous && previous.value === value && factProvenance(previous) === evidence.provenance && !updateSource) return;
    const owned = (f: typeof cur.detailing[number]) => f.field === field && (subjects.length ? f.subjectIds.some(id => subjects.includes(id)) : !f.subjectIds.length);
    const retain = (facts: typeof cur.detailing) => facts.flatMap(f => {
      if (!owned(f)) return [f];
      const remaining = f.subjectIds.filter(id => !subjects.includes(id));
      return remaining.length ? [{ ...f, subjectIds: remaining }] : [];
    });
    result = { detailing: retain(result.detailing), siteFacts: retain(result.siteFacts) };
    if (value) result = upsertFacts(result, [{ field, value, subjectIds: subjects, context: "detailing", ...evidence, assetId: previous && !updateSource ? previous.source.assetId : cur.sourceDrawing?.assetId, page: sourcePage }]);
  };
  // The shared size input starts with the first span. Saving another field must
  // preserve differing sizes and evidence on every other span.
  const sizeChanged = size.trim() !== (nominal?.value ?? "");
  if (sizeChanged || (!mixedNominal && values.nominalProvenance !== undefined && values.nominalProvenance !== factProvenance(nominal))) {
    for (const id of pipes) {
      const previous = findFact(cur, "nominalSize", id);
      const nextSize = sizeChanged ? size.trim() : previous?.value;
      if (typeof nextSize !== "string") continue;
      const selected = (!mixedNominal ? values.nominalProvenance : undefined) ?? (previous ? factProvenance(previous) : provenance);
      update("nominalSize", nextSize, previous, selected, [id],
        previous?.source.description ?? `Read by you from ${cur.sourceDrawing?.drawingId ?? "the drawing"} p${cur.sourceDrawing?.page ?? 1}`, previous?.source.page ?? cur.sourceDrawing?.page);
    }
  }
  update("materialRequirement", text.trim(), requirement, provenance, [], source, page, values.updateSource);
  update("materialRequirement.material", mat, material, values.materialProvenance ?? (material ? factProvenance(material) : provenance), [], source, page, values.updateSource);
  return result;
}

/** What the source states about size and material, kept apart from any product selection. */
export function SourceRequirements({ s, act, busy, setNotice, intake, nominal, requirement, material }: Props & { nominal: ReturnType<typeof findFact>; requirement: ReturnType<typeof findFact>; material: ReturnType<typeof findFact> }) {
  const pipes = s.scope?.includedEntityIds.filter(id => s.baselinePlan?.entities.find(e => e.id === id)?.kind === "pipe") ?? [];
  const mixedNominal = new Set(pipes.map(id => factProvenance(findFact(s, "nominalSize", id)))).size > 1;
  const mixedSize = new Set(pipes.map(id => findFact(s, "nominalSize", id)?.value ?? "")).size > 1;
  const [size, setSize] = useState(typeof nominal?.value === "string" ? nominal.value : "");
  const [text, setText] = useState(typeof requirement?.value === "string" ? requirement.value : "");
  const [mat, setMat] = useState(typeof material?.value === "string" ? material.value : "");
  const [ref, setRef] = useState(requirement?.source.description.replace(/^Read by you from /, "") ?? "");
  useEffect(() => { setSize(typeof nominal?.value === "string" ? nominal.value : ""); }, [nominal?.id, nominal?.value]);
  useEffect(() => { setText(typeof requirement?.value === "string" ? requirement.value : ""); setMat(typeof material?.value === "string" ? material.value : ""); setRef(requirement?.source.description.replace(/^Read by you from /, "") ?? ""); }, [requirement?.id, requirement?.value, material?.value]);
  const [provenance, setProvenance] = useState<Provenance>(() => factProvenance(requirement));
  const [nominalProvenance, setNominalProvenance] = useState<Provenance>(() => factProvenance(nominal));
  const [materialProvenance, setMaterialProvenance] = useState<Provenance>(() => factProvenance(material));
  useEffect(() => {
    setProvenance(factProvenance(requirement)); setNominalProvenance(factProvenance(nominal)); setMaterialProvenance(factProvenance(material));
  }, [s.inputRevision]);
  const provenanceControl = (label: string, previous: ReturnType<typeof findFact>, value: Provenance, change: (p: Provenance) => void) => {
    const locked = !!previous && factProvenance(previous) === "synthetic_assumption";
    return <Field label={tr(label)}><select value={locked ? "synthetic_assumption" : value} disabled={locked} onChange={e => change(e.target.value as Provenance)}>{Object.entries(PROVENANCE_LABELS).map(([key, text]) => <option key={key} value={key}>{tr(text)}</option>)}</select>
      {locked && <small className="fa-warn">{tr("This value remains a synthetic test assumption.")}</small>}</Field>;
  };
  const savedPage = requirement?.source.page ?? material?.source.page ?? s.sourceDrawing?.page ?? 1;
  const [sourcePage, setSourcePage] = useState(String(savedPage));
  useEffect(() => setSourcePage(String(savedPage)), [savedPage, s.sourceDrawing?.assetId]);
  const page = Number(sourcePage);
  const maxPage = intake.sheet?.pages;
  const validPage = Number.isInteger(page) && page >= 1 && (!maxPage || page <= maxPage);
  const source = `Read by you from ${ref.trim() || "the drawing"}`;
  const save = () => act("requirements", cur => {
    if (!validPage) throw new Error("Choose a valid requirement source page.");
    return patchClearing(cur, sourceRequirementsPatch(cur, { size, text, mat, provenance, nominalProvenance, materialProvenance, source, page, updateSource: ref !== (requirement?.source.description.replace(/^Read by you from /, "") ?? "") || page !== savedPage }), setNotice);
  });
  return <Section title={tr("Source requirements")} count={requirement ? tr("entered") : undefined} defaultOpen={!requirement}>
    <p className="fa-muted">{tr("What the drawing or its notes require. This is kept as stated and is not a product selection or an approval.")}</p>
    <div className="fa-row2">
      <Field label={tr("Nominal size as printed")} hint={pipes.length ? undefined : tr("Save a trace first.")}><div className="fa-fact-head"><input value={size} onChange={e => setSize(e.target.value)} placeholder='e.g. 2"' maxLength={40} disabled={!pipes.length} />{mixedNominal ? <Badge tone="amber">{tr("Varies by span")}</Badge> : nominal && factStatus(nominal)}</div></Field>
      <Field label={tr("Material")}><select value={mat} onChange={e => setMat(e.target.value)}><option value="">{tr("Not stated")}</option>{MATERIALS.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}</select></Field>
    </div>
    <div className="fa-row2">
      {mixedNominal ? <Field label={tr("Nominal size provenance")}><select value="mixed" disabled><option value="mixed">{tr("Varies by span")}</option></select><small className="fa-muted">{tr("Existing provenance is preserved for each span.")}</small></Field> : provenanceControl("Nominal size provenance", nominal, nominalProvenance, setNominalProvenance)}
      {provenanceControl("Material provenance", material, materialProvenance, setMaterialProvenance)}
    </div>
    {mixedSize && <p className="fa-muted small">{tr("Sizes vary by span. The first span is shown; editing this value applies it to every included span.")}</p>}
    {provenanceControl("Requirement text provenance", requirement, provenance, setProvenance)}
    <Field label={tr("Requirement text")}><textarea rows={2} value={text} onChange={e => setText(e.target.value)} placeholder={tr("e.g. Schedule 40 black steel pipe with threaded cast-iron fittings")} maxLength={1000} /></Field>
    <Field label={tr("Where it is stated")}><input value={ref} onChange={e => setRef(e.target.value)} placeholder={tr("e.g. FS-02 general notes")} maxLength={300} /></Field>
    <Field label={tr("Requirement source page")} hint={tr("Page containing the material requirement or notes. The nominal-size label remains linked to the traced drawing page.")}><input type="number" min={1} max={maxPage} step={1} value={sourcePage} onChange={e => setSourcePage(e.target.value)} /></Field>
    <div className="fa-actions"><Button busy={busy === "requirements"} disabled={!!busy || !validPage} onClick={() => void save()}>{tr("Save requirements")}</Button></div>
  </Section>;
}

function CoordInput({ value, onChange, disabled, label }: { value: number; onChange: (v: number) => void; disabled: boolean; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return <input className="mono fa-coord" aria-label={label} value={text} disabled={disabled} inputMode="decimal"
    onChange={e => setText(e.target.value)} onBlur={() => { const v = Number(text); if (text.trim() && Number.isFinite(v)) onChange(v); else setText(String(value)); }} />;
}

const r1 = (n: number) => String(Math.round(n * 10) / 10);
const r4 = (n: number) => String(Math.round(n * 10000) / 10000);
const unitWord = (u: string | undefined, one = false) => u === "pdf_pt" ? (one ? "point" : "pt") : (one ? "pixel" : "px");
