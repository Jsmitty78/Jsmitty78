import { tr } from "./locale.js";
import { useEffect, useMemo, useState } from "react";
import type { PackageInputs } from "@sprink/core";
import { api, type Snapshot } from "./api.js";
import { lengthInput, lengthText, millimetres, parseLength, toMetres, UNKNOWN } from "./format.js";
import {
  reopenSiteGeometry, showCpvcInputs, showSfInputs, activeDetailingPlan, buildRun, ELBOW, inScope, runEditPatch, findFact, isConfirmed, projectBasis, runChanged, runNodes, upsertFacts,
  evidenceSpec, factProvenance, PROVENANCE_LABELS, type Provenance, syncRunDraft, type Callouts, type Fact, type FactSpec, type RunNode, type RunNodeKind,
} from "./model.js";
import { PRODUCT_SETS, productSetOf } from "./products.js";
import { Badge, Button, Callout, Field, Icon, Section } from "./ui.js";

export type Act = (label: string, fn: (s: Snapshot) => Promise<unknown>) => Promise<boolean>;
export type Unit = "mm" | "in";
export interface Common { s: Snapshot; act: Act; busy: string; unit: Unit; setNotice: (t: string) => void }

export const BY_YOU = "Confirmed by you in Sprink";
export const MEASURED = "Measured on site by you";

/**
 * Edit inputs. When a route is selected, the server keeps the selection even if site facts change,
 * so the UI clears it first (select the baseline) and says so.
 */
export async function patchClearing(s: Snapshot, patch: Partial<PackageInputs>, setNotice: (t: string) => void): Promise<void> {
  let revision = s.inputRevision;
  const baselineId = s.baselinePlan?.id;
  if (s.selectedPlan && baselineId && s.selectedPlan.id !== baselineId) {
    const cleared = await api.select(s.id, revision, baselineId);
    revision = cleared.inputRevision;
    setNotice("Your route selection was cleared because the inputs changed. Regenerate and choose again.");
  }
  await api.edit(s.id, revision, patch);
}

export function factStatus(f: Fact | undefined) {
  if (!f || f.value === null) return <Badge tone="amber">{tr("Missing")}</Badge>;
  if (factProvenance(f) === "synthetic_assumption") return <Badge tone="sample">{tr("Synthetic test assumption")}</Badge>;
  if (f.provenance === "machine_proposal") return <Badge tone="amber">{tr("Machine proposal")}</Badge>;
  if (f.provenance === "user_entered") return <Badge tone="amber">{tr("Entered, unverified")}</Badge>;
  if (f.confirmation === "confirmed") return <Badge tone="green">{f.context === "observed" ? tr("Confirmed evidence") : tr("Confirmed")}</Badge>;
  return <Badge tone="amber">{tr("Proposed")}</Badge>;
}

const KIND_LABEL: Record<RunNodeKind, string> = { tie_in: "Tie-in", open_end: "Open end", elbow: "90° elbow" };

export function RunEditor({ s, act, busy, unit, setNotice, callouts }: Common & { callouts: Callouts }) {
  const saved = useMemo(() => runNodes(s.baselinePlan), [s.baselinePlan]);
  const frozen = s.baselinePlan?.confirmation === "confirmed";
  const blank: RunNode[] = s.intent === "adapt_to_site" ? [{ kind: "tie_in", x: 0, y: 0 }, { kind: "tie_in", x: null, y: 0 }] : [{ kind: "open_end", x: 0, y: 0 }, { kind: "elbow", x: null, y: 0 }, { kind: "open_end", x: null, y: null }];
  const [draft, setDraft] = useState(() => syncRunDraft(null, saved ?? blank, unit));
  const currentDraft = syncRunDraft(draft, saved ?? blank, unit);
  if (currentDraft !== draft) setDraft(currentDraft);
  const rows = currentDraft.rows;
  const setRows = (rows: typeof draft.rows) => setDraft({ ...currentDraft, rows });

  const nodes: RunNode[] = rows.map(r => ({ kind: r.kind, x: parseLength(r.x, unit), y: parseLength(r.y, unit) }));
  // No product is assumed: a typed run is only sized with a product the user chose.
  const [product, setProduct] = useState(() => productSetOf(s));
  useEffect(() => setProduct(productSetOf(s)), [s.inputRevision]);
  const built = buildRun(nodes, s.baselinePlan?.id ?? "baseline", undefined, PRODUCT_SETS[product]);
  const productChanged = !!s.baselinePlan && (s.baselinePlan.entities.find(e => e.kind === "pipe")?.productId ?? null) !== PRODUCT_SETS[product].pipe;
  const problems = "problems" in built ? built.problems : [];
  const dirty = runChanged(nodes, saved, unit) || productChanged;
  const drawingReady = s.sourceDrawing?.scale.basis === "confirmed_inputs";

  const save = () => act("run", async cur => {
    if ("problems" in built) return;
    const patch = runEditPatch(cur, nodes, built);
    await patchClearing(cur, patch, setNotice);
    if (patch.changeRequest === null && cur.changeRequest) setNotice("Your site change was cleared because the run shape changed. Choose the affected pipe again.");
  });
  const confirm = () => {
    if (!s.baselinePlan) return;
    if (!window.confirm(tr("Confirm these run dimensions against the drawing? The confirmed run is frozen in this package; a later change needs a new package."))) return;
    void act("confirm-run", async cur => {
      if (!cur.baselinePlan) return;
      const d = cur.sourceDrawing;
      const source = `${BY_YOU} against ${d ? `${d.drawingId} rev ${d.revision} p${d.page}` : "the drawing"}`;
      const datums: FactSpec[] = [];
      for (const pipe of cur.baselinePlan.entities.filter(e => e.kind === "pipe"))
        for (const end of ["start", "end"]) {
          const f = findFact(cur, `datum.${end}`, pipe.id);
          if (f?.value) datums.push({ field: `datum.${end}`, value: f.value, subjectIds: [pipe.id], confirmation: "confirmed", context: "detailing", source });
        }
      await patchClearing(cur, { baselinePlan: { ...cur.baselinePlan, confirmation: "confirmed" }, ...upsertFacts(cur, datums) }, setNotice);
    });
  };

  if (!saved && s.baselinePlan) return <Callout tone="neutral" title={tr("This run has a shape the editor does not handle")}>{tr("It is drawn on the plan as saved. The editor handles one open run with tie-ins or open ends and 90° elbows.")}</Callout>;

  return <div className="fa-stack">
    <p className="fa-muted">{tr("Enter the run in order along the pipe, as positions measured on the drawing from the first point (")}{unit === "mm" ? tr("mm") : tr("ft-in, e.g. 10' 2-1/2\"")}).</p>
    <div className="fa-table-wrap"><table className="fa-table fa-run">
      <thead><tr><th>#</th><th>{tr("Point")}</th><th>{tr("X")}</th><th>{tr("Y")}</th>{!frozen && <th aria-label={tr("Remove")} />}</tr></thead>
      <tbody>{rows.map((r, i) => {
        const tag = s.baselinePlan && saved ? (r.kind === "elbow" ? callouts.fitting.get(`f${rows.slice(0, i + 1).filter(x => x.kind === "elbow").length}`) : r.kind === "tie_in" ? callouts.tieIn.get(`t${rows.slice(0, i + 1).filter(x => x.kind === "tie_in").length}`) : undefined) : undefined;
        return <tr key={i}>
          <td className="mono">{i + 1}</td>
          <td>{frozen ? <>{tr(KIND_LABEL[r.kind])} {tag && <span className="fa-tagtext">{tag}</span>}</> :
            <select aria-label={`Point ${i + 1} type`} value={r.kind} onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, kind: e.target.value as RunNodeKind } : x))}>
              {(i === 0 || i === rows.length - 1 ? ["tie_in", "open_end"] : ["elbow"]).map(k => <option key={k} value={k}>{tr(KIND_LABEL[k as RunNodeKind])}</option>)}
            </select>}</td>
          {(["x", "y"] as const).map(axis => <td key={axis}>{frozen ? <span className="mono">{r[axis] || "—"}</span> :
            <input aria-label={`Point ${i + 1} ${axis.toUpperCase()}`} className={`mono ${r[axis] && parseLength(r[axis], unit) === null ? "is-invalid" : ""}`} value={r[axis]} placeholder={tr("—")}
              onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, [axis]: e.target.value } : x))} />}</td>)}
          {!frozen && <td><button type="button" className="fa-icon-btn" aria-label={`Remove point ${i + 1}`} disabled={rows.length <= 2} onClick={() => {
            const next = rows.filter((_, j) => j !== i);
            next[0] = { ...next[0], kind: next[0].kind === "elbow" ? "open_end" : next[0].kind };
            const last = next.length - 1;
            next[last] = { ...next[last], kind: next[last].kind === "elbow" ? "open_end" : next[last].kind };
            setRows(next);
          }}><Icon name="x" size={14} /></button></td>}
        </tr>;
      })}</tbody>
    </table></div>
    {frozen ? <p className="fa-muted"><Badge tone="green">{tr("Run confirmed")}</Badge>{" "}{tr("The confirmed run is frozen in this package.")}</p> : <>
      <button type="button" className="fa-link" onClick={() => {
        const next = [...rows];
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, kind: "elbow" };
        next.push({ kind: last.kind === "elbow" ? "open_end" : last.kind, x: "", y: "" });
        setRows(next);
      }}>{tr("+ Add a point (the current end becomes an elbow)")}</button>
      <Field label={tr("Pipe and fittings")}><select value={product} onChange={e => setProduct(e.target.value)}>
        {Object.entries(PRODUCT_SETS).map(([key, value]) => <option key={key} value={key}>{tr(value.label)}</option>)}</select></Field>
      {problems.length > 0 && <ul className="fa-problems">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
      <div className="fa-actions">
        <Button busy={busy === "run"} disabled={!!busy || problems.length > 0} onClick={() => void save()}>{tr("Save run")}</Button>
        <Button variant="primary" busy={busy === "confirm-run"} disabled={!!busy || !s.baselinePlan || !saved || dirty || !drawingReady || problems.length > 0} onClick={confirm}>{tr("Confirm dimensions")}</Button>
      </div>
      {s.baselinePlan && saved && dirty && problems.length === 0 && <p className="fa-muted small">{tr("Save the run first. Confirming freezes the saved run, not unsaved edits.")}</p>}
      {s.baselinePlan && saved && !drawingReady && <p className="fa-muted small">{tr("Upload the drawing and confirm its scale first. Confirming the run also freezes the drawing.")}</p>}
    </>}
  </div>;
}

// ---------------------------------------------------------------- single facts

type Kind = { type: "length" } | { type: "bool"; yes: string; no: string } | { type: "text" } | { type: "choice"; options: Array<[string, string]> };
interface RowSpec { field: string; subject?: string; label: string; kind: Kind; context?: Fact["context"]; help?: string; productBindings?: Array<{ field: string; value: string }> }

/** Shared by the input action and payload regression tests: a joint measurement is bound to its chosen pair. */
export function detailFactPatch(s: Snapshot, spec: RowSpec, value: Fact["value"], provenance: Provenance, source: string) {
  const evidence = evidenceSpec(findFact(s, spec.field, spec.subject), provenance, source);
  const subjectIds = spec.subject ? [spec.subject] : [];
  const specs: FactSpec[] = [{ field: spec.field, subjectIds, value, unit: spec.kind.type === "length" ? "mm" : null,
    ...evidence, context: evidence.provenance === "synthetic_assumption" ? "detailing" : spec.context ?? "detailing" },
    ...(spec.productBindings ?? []).map(binding => ({ ...binding, subjectIds, context: "detailing" as const,
      ...evidenceSpec(findFact(s, binding.field, spec.subject), evidence.provenance!, source) }))];
  return upsertFacts(s, specs);
}

export function steelDetailRows(s: Snapshot, callouts: Callouts): RowSpec[] {
  const plan = activeDetailingPlan(s), work = inScope(s);
  if (!plan) return [];
  return plan.entities.filter(f => f.kind === "fitting" && work(f.id) && Object.values(PRODUCT_SETS).some(p => p.material === "steel" && p.elbow === f.productId)).flatMap(f =>
    f.ports.flatMap(port => {
      const connections = plan.connections.filter(c => [c.from, c.to].some(end => end.entityId === f.id && end.portId === port.id));
      if (connections.length !== 1) return [];
      const c = connections[0], other = c.from.entityId === f.id ? c.to : c.from;
      const pipe = plan.entities.find(e => e.id === other.entityId && e.kind === "pipe");
      if (!pipe?.productId || !f.productId) return [];
      const binding = (prefix: string) => [{ field: `${prefix}.${port.id}.pipeProductId`, value: pipe.productId! }, { field: `${prefix}.${port.id}.fittingProductId`, value: f.productId! }];
      const label = `${callouts.fitting.get(f.id) ?? f.id}/${port.id}`;
      return [
        { field: `threadMakeup.${port.id}`, subject: f.id, label: `${label}: final axial engagement`, kind: { type: "length" } as Kind, productBindings: binding("threadMakeup"),
          help: `From the fitting face to the final pipe end for ${pipe.productId} and ${f.productId}. Supply scoped measured or documented evidence; tightening turns are not a length. A selected pair is not proof of compatibility.` },
        { field: `threadedJointPlan.${port.id}`, subject: f.id, label: `${label}: threaded joint preparation and assembly plan`, kind: { type: "text" } as Kind, productBindings: binding("threadedJointPlan"),
          help: "Record reviewed end preparation, inspection, tools, sealant and assembly order for this joint. Fixed-end closure requires separate reviewed evidence and remains unsupported here." },
        { field: `movement.${port.id}`, subject: f.id, label: `${label}: rotation, movement and tool access`, kind: { type: "bool", yes: "Possible, checked against evidence", no: "Not possible" } as Kind,
          help: "Identify the rotating part and required movement/access in the source description. Synthetic assumptions remain unconfirmed and cannot establish physical assembly readiness." },
      ];
    }));
}

export function FactRow({ s, act, busy, unit, setNotice, spec }: Common & { spec: RowSpec }) {
  const f = findFact(s, spec.field, spec.subject);
  const key = `${spec.field}.${spec.subject ?? ""}`;
  const initial = () => {
    if (f?.value === null || f?.value === undefined) return "";
    if (spec.kind.type === "length" && typeof f.value === "number") { const m = toMetres(f.value, f.unit ?? "mm"); return m === null ? "" : lengthInput(m * 1000, unit); }
    return String(f.value);
  };
  const [provenance, setProvenance] = useState<Provenance>(() => factProvenance(f));
  const [source, setSource] = useState(f?.source.description ?? "");
  useEffect(() => { setProvenance(factProvenance(f)); setSource(f?.source.description ?? ""); }, [JSON.stringify(f)]);
  const [value, setValue] = useState(initial);
  const [editing, setEditing] = useState(!isConfirmed(f));
  useEffect(() => { setValue(initial()); setEditing(!isConfirmed(f)); }, [f?.id, f?.value, unit]);

  const parsed = spec.kind.type === "length" ? parseLength(value, unit) : spec.kind.type === "bool" ? (value === "true" ? true : value === "false" ? false : null) : value.trim() || null;
  const save = () => act(key, cur => patchClearing(cur, detailFactPatch(cur, spec, parsed, provenance, source), setNotice));
  const metres = typeof f?.value === "number" ? toMetres(f.value, f.unit ?? "mm") : null;
  const shown = f?.value === null || f?.value === undefined ? null
    : spec.kind.type === "length" && typeof f.value === "number" ? (unit === "mm" ? (metres === null ? UNKNOWN : millimetres(metres)) : lengthText({ value: f.value, unit: f.unit ?? "mm", basis: "confirmed_inputs" }).primary)
    : spec.kind.type === "bool" ? (f.value ? spec.kind.yes : spec.kind.no)
    : spec.kind.type === "choice" ? spec.kind.options.find(o => o[0] === f.value)?.[1] ?? String(f.value) : String(f.value);

  return <div className="fa-fact">
    <div className="fa-fact-head"><span>{tr(spec.label)}</span>{factStatus(f)}</div>
    {!editing ? <div className="fa-fact-value"><span className={spec.kind.type === "length" ? "mono" : ""}>{spec.kind.type === "bool" || spec.kind.type === "choice" ? tr(shown ?? "") : shown}</span><button type="button" className="fa-link" onClick={() => setEditing(true)}>{tr("Change")}</button></div> :
      <div className="fa-fact-edit">
        {spec.kind.type === "bool" ? <select value={value} onChange={e => setValue(e.target.value)} aria-label={spec.label}><option value="">{tr("Not confirmed")}</option><option value="true">{spec.kind.yes}</option><option value="false">{spec.kind.no}</option></select>
          : spec.kind.type === "choice" && spec.kind.options.length ? <select value={value} onChange={e => setValue(e.target.value)} aria-label={spec.label}><option value="">{tr("Choose…")}</option>{spec.kind.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          : spec.kind.type === "text" ? <textarea value={value} onChange={e => setValue(e.target.value)} rows={2} aria-label={spec.label} />
          : <input value={value} onChange={e => setValue(e.target.value)} aria-label={spec.label} className={spec.kind.type === "length" ? "mono" : ""} placeholder={spec.kind.type === "length" ? (unit === "mm" ? "mm" : `ft-in`) : ""} />}
        <Button variant="primary" busy={busy === key} disabled={!!busy || parsed === null || !source.trim()} onClick={() => void save()}>{tr("Save fact")}</Button>
      </div>}
    {editing && <SourceEvidenceInputs provenance={provenance} setProvenance={setProvenance} source={source} setSource={setSource} syntheticLocked={!!f && factProvenance(f) === "synthetic_assumption"} />}
    {spec.help && <small className="fa-muted">{spec.help}</small>}
  </div>;
}

export function DetailingInputs(props: Common & { callouts: Callouts }) {
  const { s, callouts } = props;
  const plan = activeDetailingPlan(s);
  const work = inScope(s);
  const pipes = plan?.entities.filter(e => e.kind === "pipe" && work(e.id)) ?? [];
  const ties = plan?.entities.filter(e => e.kind === "tie_in" && work(e.id)) ?? [];
  const fits = plan?.entities.filter(e => e.kind === "fitting" && work(e.id)) ?? [];
  const datum: Kind = { type: "choice", options: [["center_to_center", "Center to center (fitting or tie-in)"], ["physical_pipe_end", "Physical pipe end"], ["scope_interface", "Scope station (not a physical joint)"]] };
  const done = (rows: RowSpec[]) => rows.every(r => isConfirmed(findFact(s, r.field, r.subject)));
  const dims: RowSpec[] = [
    ...pipes.flatMap(p => (["start", "end"] as const).map(end => ({ field: `datum.${end}`, subject: p.id, label: tr("Piece {part} {end}: dimension to", { part: callouts.piece.get(p.id) ?? p.id, end: tr(end) }), kind: datum }))),
    ...ties.map(t => ({ field: "netCutOffset", subject: t.id, label: tr("{part} net cut offset", { part: callouts.tieIn.get(t.id) ?? t.id }), kind: { type: "length" } as Kind, help: "Deducted at the tie-in, as measured for this connection." })),
  ];
  const assembly: RowSpec[] = [
    ...fits.filter(f => f.productId === ELBOW).flatMap(f => f.ports.map(port => ({ field: `movement.${port.id}`, subject: f.id, label: tr("{part}: full insertion and quarter turn possible", { part: `${callouts.fitting.get(f.id)}/${port.id}` }), kind: { type: "bool", yes: "Yes, confirmed", no: "No" } as Kind }))),
    { field: "workAreaAccess", label: "Work-area access", kind: { type: "bool", yes: "Access confirmed", no: "No access" } },
    ...(showCpvcInputs(s) ? [{ field: "curePlan", label: "Set and cure plan (temperature, fit, test pressure)", kind: { type: "text" } as Kind }] : []),
  ];
  const steel = steelDetailRows(s, callouts);
  const project: RowSpec[] = projectBasis(s).map(b => ({ field: b.field, label: b.label, kind: b.options.length ? { type: "choice", options: b.options } : { type: "text" } }));
  return <>
    {plan && <Section title={tr("Dimensions")} count={`${dims.filter(r => isConfirmed(findFact(s, r.field, r.subject))).length}/${dims.length}`} defaultOpen={!done(dims)}>{dims.map(r => <FactRow key={`${r.field}.${r.subject}`} {...props} spec={r} />)}</Section>}
    {steel.length > 0 && <Section title={tr("Steel threaded joints")} count={`${steel.filter(r => isConfirmed(findFact(s, r.field, r.subject))).length}/${steel.length}`} defaultOpen={!done(steel)}>
      <p className="fa-muted">{tr("Each port has its own engagement and assembly evidence. Unknown or synthetic inputs preserve null cuts and unresolved assembly; no physical measurements are inferred from the drawing.")}</p>
      {steel.map(r => <FactRow key={`${r.field}.${r.subject}`} {...props} spec={r} />)}
    </Section>}
    <Section title={tr("Assembly conditions")} count={`${assembly.filter(r => isConfirmed(findFact(s, r.field, r.subject))).length}/${assembly.length}`} defaultOpen={!done(assembly)}>{assembly.map(r => <FactRow key={`${r.field}.${r.subject}`} {...props} spec={r} />)}</Section>
    <Section title={tr("Project basis")} count={`${project.filter(r => isConfirmed(findFact(s, r.field))).length}/${project.length}`} defaultOpen={!done(project)}>{!showSfInputs(s) && <p className="fa-muted">{tr("This package has no confirmed San Francisco basis. Source basis, current applicability and approval remain separate; supply project-specific facts through the shared intake/API.")}</p>}{project.map(r => <FactRow key={r.field} {...props} spec={r} />)}</Section>
  </>;
}

// ---------------------------------------------------------------- site conditions

export function ChangeInputs({ s, act, busy, setNotice, callouts, selectedPiece }: Common & { callouts: Callouts; selectedPiece?: string | null }) {
  const pipes = s.baselinePlan?.entities.filter(e => e.kind === "pipe" && inScope(s)(e.id)) ?? [];
  const [desc, setDesc] = useState(s.changeRequest?.description ?? "");
  const [ids, setIds] = useState<string[]>(s.changeRequest?.affectedEntityIds ?? []);
  useEffect(() => { setDesc(s.changeRequest?.description ?? ""); setIds(s.changeRequest?.affectedEntityIds ?? []); }, [s.changeRequest]);
  useEffect(() => { if (selectedPiece && pipes.some(p => p.id === selectedPiece)) setIds([selectedPiece]); }, [selectedPiece]);
  const save = () => act("change", async cur => {
    // Site geometry is read along the affected span; a different span needs it confirmed again.
    const moved = (cur.changeRequest?.affectedEntityIds ?? []).join(",") !== ids.join(",") && !!cur.changeRequest;
    const reopened = moved ? reopenSiteGeometry(cur) : {};
    await patchClearing(cur, {
      ...reopened,
      changeRequest: { id: cur.changeRequest?.id ?? "site-change", description: desc.trim(), affectedEntityIds: ids, factIds: [...cur.detailing, ...cur.siteFacts].filter(f => f.field.startsWith("duct.")).map(f => f.id) },
    }, setNotice);
    if (moved && [...cur.detailing, ...cur.siteFacts].some(f => /^(adaptationFrame|duct|workEnvelope)\./.test(f.field) && f.confirmation === "confirmed"))
      setNotice("The affected span changed. Save the site frame on the new span, then confirm the obstacle and work boundary again.");
  });
  if (!pipes.length) return <p className="fa-muted">{tr("Enter the existing run first, then choose the piece the obstacle blocks.")}</p>;
  return <div className="fa-stack">
    <Field label={tr("実際の現況")}><textarea rows={2} value={desc} onChange={e => setDesc(e.target.value)} placeholder={tr("例：図面の配管位置にダクトが設置されている")} /></Field>
    <p className="fa-muted small">{tr("変更する直線区間を1つ選択します。周囲の配管・ヘッド・接続はそのまま残ります。")}</p>
    <div className="fa-chips" role="radiogroup" aria-label={tr("Active straight interval")}>{pipes.map(p => <label key={p.id} className={`fa-chip ${ids.includes(p.id) ? "is-on" : ""}`}>
      <input type="radio" name="active-interval" checked={ids.includes(p.id)} onChange={() => setIds([p.id])} />{tr("Piece")}{" "}{callouts.piece.get(p.id)}
    </label>)}</div>
    <div className="fa-actions"><Button variant="primary" busy={busy === "change"} disabled={!!busy || !desc.trim() || !ids.length} onClick={() => void save()}>{tr("現況を保存")}</Button></div>
  </div>;
}

export function EvidenceInputs({ s, act, busy, setNotice }: Common) {
  const photos = s.siteFacts.filter(f => f.field.startsWith("evidence.photo") && f.source.assetId);
  const [caption, setCaption] = useState("");
  const upload = (file: File) => act("evidence", async cur => {
    const asset = await api.upload(cur.id, file);
    const n = cur.siteFacts.filter(f => f.field.startsWith("evidence.photo")).length + 1;
    await patchClearing(cur, upsertFacts(cur, [{
      field: `evidence.photo.${n}`, value: file.name.slice(0, 200), subjectIds: cur.changeRequest?.affectedEntityIds ?? [], confirmation: "proposed", provenance: "user_entered",
      context: "observed", source: caption.trim() || `Uploaded site photo: ${file.name}`, assetId: asset.id,
    }]), setNotice);
    setCaption("");
  });
  return <div className="fa-stack">
    <p className="fa-muted">{tr("写真は実測値と一緒に保存します。寸法は実測値の欄に入力してください。")}</p>
    {photos.length > 0 && <div className="fa-thumbs">{photos.map(p => <Thumb key={p.id} packageId={s.id} assetId={p.source.assetId!} caption={p.source.description} />)}</div>}
    <Field label={tr("写真の説明")}><input value={caption} onChange={e => setCaption(e.target.value)} placeholder={tr("例：通り芯 C-3 のダクト、北方向")} /></Field>
    <label className={`fa-drop small ${busy === "evidence" ? "is-busy" : ""}`}><Icon name="camera" /><span>{busy === "evidence" ? tr("Uploading…") : tr("現場写真を追加")}</span>
      <input type="file" accept="image/png,image/jpeg" capture="environment" disabled={!!busy} onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
    </label>
  </div>;
}

function Thumb({ packageId, assetId, caption }: { packageId: string; assetId: string; caption: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false, made: string | null = null;
    api.asset(packageId, assetId).then(b => { if (!revoked) { made = URL.createObjectURL(b); setUrl(made); } }).catch(() => undefined);
    return () => { revoked = true; if (made) URL.revokeObjectURL(made); };
  }, [packageId, assetId]);
  return <figure className="fa-thumb">{url ? <img src={url} alt={caption} /> : <div className="fa-thumb-ph" />}<figcaption>{caption}</figcaption></figure>;
}
function SourceEvidenceInputs({ provenance, setProvenance, source, setSource, syntheticLocked = false }: {
  provenance: Provenance; setProvenance: (v: Provenance) => void; source: string; setSource: (v: string) => void; syntheticLocked?: boolean;
}) {
  return <div className="fa-stack">
    <Field label={tr("Input provenance")}><select value={syntheticLocked ? "synthetic_assumption" : provenance} disabled={syntheticLocked} onChange={e => setProvenance(e.target.value as Provenance)}>
      {Object.entries(PROVENANCE_LABELS).map(([value, label]) => <option key={value} value={value}>{tr(label)}</option>)}
    </select></Field>
    <Field label={tr("Source / measurement description")}><textarea rows={2} value={source} onChange={e => setSource(e.target.value)} placeholder={tr("Describe the measurement, document, proposal or test assumption")} /></Field>
    {(syntheticLocked || provenance === "synthetic_assumption") && <small className="fa-warn">{tr("Software test assumption only. Saving or confirming keeps this synthetic; it is not field evidence or construction approval.")}</small>}
    {provenance === "confirmed_evidence" && !syntheticLocked && <small className="fa-muted">{tr("Choose only after checking the value against the evidence described above.")}</small>}
  </div>;
}
