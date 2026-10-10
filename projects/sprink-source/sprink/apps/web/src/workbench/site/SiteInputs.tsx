import { tr } from "../locale.js";
import { geometryFactUsable } from "@sprink/core";
import { useEffect, useState } from "react";
import type { PackageInputs } from "@sprink/core";
import type { Snapshot } from "../api.js";
import { lengthInput, lengthText, parseLength } from "../format.js";
import { evidenceSpec, ASSUMPTION_PREFIX, BOX_KEYS, boxGaps, findFact, inScope, isConfirmed, isTestAssumption, readBox, siteFrameOf, toMm, upsertFacts, type Callouts, type Fact } from "../model.js";
import { MEASURED, patchClearing, type Act, type Unit } from "../inputs.js";
import { Badge, Button, Field } from "../ui.js";

interface Common { s: Snapshot; act: Act; busy: string; unit: Unit; setNotice: (t: string) => void }

/**
 * Site geometry for a discrepancy: a local frame pinned to one span, the obstacle and work boundary
 * as boxes in that frame, and the clearance the planner needs. Each value says whether it
 * was measured on site or is a fictional test assumption; confirming a value never changes which.
 */
type Basis = "measured" | "assumption";
const ASSUMED = `${ASSUMPTION_PREFIX} fictional software-test value, not a field observation`;
const sourceFor = (basis: Basis, note: string) => {
  const n = note.trim();
  return basis === "assumption" ? (n ? `${ASSUMED}. ${n}` : ASSUMED) : (n ? `${MEASURED}: ${n}` : MEASURED);
};
const basisOf = (f: Fact | undefined): Basis => isTestAssumption(f) ? "assumption" : "measured";
const noteOf = (f: Fact | undefined) => {
  const d = f?.source.description ?? "";
  if (d.startsWith(ASSUMED)) return d.slice(ASSUMED.length).replace(/^\.\s*/, "");
  if (d.startsWith(`${MEASURED}: `)) return d.slice(MEASURED.length + 2);
  return d;
};

export function siteEvidence(previous: Fact | undefined, basis: Basis, confirm: boolean, note: string) {
  return evidenceSpec(previous, basis === "assumption" ? "synthetic_assumption" : confirm ? "confirmed_evidence" : "user_entered", sourceFor(basis, note));
}

function BasisPicker({ basis, onChange, name, locked = false }: { basis: Basis; onChange: (b: Basis) => void; name: string; locked?: boolean }) {
  return <div className="fa-chips" role="radiogroup" aria-label={tr("Basis")}>
    {([["measured", "Measured on site"], ["assumption", "Test assumption (fictional)"]] as const).map(([v, l]) =>
      <label key={v} className={`fa-chip ${basis === v ? "is-on" : ""}`}><input type="radio" name={name} disabled={locked} checked={basis === v} onChange={() => onChange(v)} />{tr(l)}</label>)}
  </div>;
}

function statusBadge(facts: Array<Fact | undefined>) {
  const present = facts.filter(f => f && f.value !== null);
  if (!present.length) return <Badge tone="amber">{tr("Not entered")}</Badge>;
  const assumption = present.some(f => isTestAssumption(f));
  const all = present.length === facts.length && facts.every(assumption ? geometryFactUsable : isConfirmed);
  return <span className="fa-badges">
    {assumption && <Badge tone="sample" title={tr("Fictional value for testing the software, not a field observation")}>{tr("Test assumption")}</Badge>}
    {all ? <Badge tone="green">{assumption ? tr("Usable for testing") : tr("Measured and confirmed")}</Badge>
      : present.length < facts.length ? <Badge tone="amber">{tr("Incomplete")}</Badge> : <Badge tone="amber">{tr("Entered, not confirmed")}</Badge>}
  </span>;
}

// ---------------------------------------------------------------- the local frame

const num = (v: number) => String(Math.round(Math.abs(v) * 1e4) / 1e4);
/** "12544.2133 − Y" from a constant and coefficients on X and Y. */
function affine(c: number, terms: Array<[number, string]>) {
  const parts: string[] = [];
  if (Math.abs(c) >= 5e-5) parts.push(`${c < 0 ? "−" : ""}${num(c)}`);
  for (const [k, name] of terms) {
    if (Math.abs(k) < 1e-9) continue;
    const mag = Math.abs(Math.abs(k) - 1) < 1e-9 ? name : `${num(k)}·${name}`;
    parts.push(parts.length ? `${k < 0 ? "−" : "+"} ${mag}` : `${k < 0 ? "−" : ""}${mag}`);
  }
  return parts.join(" ") || "0";
}
/** A right-handed local frame: origin, unit X and unit Y (Y = X turned 90° counterclockwise), all in the plan frame. */
export interface LocalFrame { origin: { x: number; y: number; z: number }; x: { x: number; y: number }; y: { x: number; y: number } }
export const frameFromYaw = (origin: LocalFrame["origin"], yawDeg: number): LocalFrame => {
  const r = yawDeg * Math.PI / 180, c = Math.cos(r), n = Math.sin(r);
  const clean = (v: number) => Math.abs(v) < 1e-12 ? 0 : Math.abs(Math.abs(v) - 1) < 1e-12 ? Math.sign(v) : v;
  return { origin, x: { x: clean(c), y: clean(n) }, y: { x: clean(-n), y: clean(c) } };
};
/** The frame a span gives: origin at its start, X along it. Null for a sloped or zero-length span. */
export function spanFrame(plan: NonNullable<Snapshot["baselinePlan"]>, spanId: string): { origin: LocalFrame["origin"]; yaw: number; length: number } | null {
  const pipe = plan.entities.find(e => e.id === spanId && e.kind === "pipe");
  const [a, b] = [pipe?.ports[0]?.position, pipe?.ports.at(-1)?.position];
  if (!a || !b) return null;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(length > 0) || Math.abs(b.z - a.z) > 1e-6 * length) return null;
  // Whole degrees stay exact; otherwise keep the full angle so the span stays on local X.
  const raw = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const yaw = Math.abs(raw - Math.round(raw)) < 1e-9 ? Math.round(raw) : raw;
  return { origin: { ...a }, yaw, length };
}

/** Plan and drawing coordinates of a local point, as formulas a reviewer can check by hand. */
export function frameFormulas(frame: LocalFrame, sheet: { rotationDeg: number; originMm: { x: number; y: number } } | null) {
  const plan = `Plan (mm) = (${affine(frame.origin.x, [[frame.x.x, "X"], [frame.y.x, "Y"]])}, ${affine(frame.origin.y, [[frame.x.y, "X"], [frame.y.y, "Y"]])}, ${affine(frame.origin.z, [[1, "Z"]])})`;
  if (sheet === null) return { plan, drawing: null };
  // Plan = R(rotation)·(u, −v), where (u, v) are sheet millimetres from the plan origin with Y down the
  // sheet; the plan origin itself sits at originMm from the sheet origin.
  const r = sheet.rotationDeg * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  const toSheet = (p: { x: number; y: number }) => ({ u: cos * p.x + sin * p.y, v: -(-sin * p.x + cos * p.y) });
  const at = toSheet(frame.origin), o = { u: at.u + sheet.originMm.x, v: at.v + sheet.originMm.y }, ax = toSheet(frame.x), ay = toSheet(frame.y);
  const clean = (v: number) => Math.abs(v) < 1e-12 ? 0 : v;
  return { plan, drawing: `Drawing XY (mm from the sheet origin, Y down the sheet) = (${affine(clean(o.u), [[clean(ax.u), "X"], [clean(ay.u), "Y"]])}, ${affine(clean(o.v), [[clean(ax.v), "X"], [clean(ay.v), "Y"]])})` };
}

/**
 * Pins the explicit local frame of docs/contracts/adaptation-interval.md to a span: the four
 * `adaptationFrame.*` facts, origin at the span start and yaw along it. The frame is right-handed,
 * so Y is to the left of the pipe looking along X.
 */
export function SiteFrameInputs({ s, act, busy, setNotice, callouts }: Common & { callouts: Callouts }) {
  const plan = s.baselinePlan;
  const pipes = plan?.entities.filter(e => e.kind === "pipe" && inScope(s)(e.id)) ?? [];
  const saved = siteFrameOf(s);
  const pinned = saved?.origin ? pipes.find(p => { const f = plan && spanFrame(plan, p.id); return f && Math.hypot(f.origin.x - saved.origin!.x, f.origin.y - saved.origin!.y, f.origin.z - saved.origin!.z) < 1e-6 && Math.abs(((f.yaw - saved.yaw! + 540) % 360) - 180) < 1e-9; })?.id : undefined;
  // The frame belongs on the span the obstacle blocks; a frame left on another span shows as changed.
  const affected = s.changeRequest?.affectedEntityIds.find(id => pipes.some(p => p.id === id));
  const initial = () => affected ?? pinned ?? pipes[0]?.id ?? "";
  const [span, setSpan] = useState(initial);
  useEffect(() => setSpan(initial()), [affected, pinned, saved?.reason]);
  if (!plan || !pipes.length) return <p className="fa-muted">{tr("Trace or enter the existing run first, then pin the frame to the span the obstacle blocks.")}</p>;

  const target = span ? spanFrame(plan, span) : null;
  const frame = target ? frameFromYaw(target.origin, target.yaw) : null;
  const view = s.sourceDrawing?.view;
  const scale = s.sourceDrawing?.scale.value ?? null;
  const sheet = view && scale && plan.coordinateFrame.id === "drawing-plan" ? { rotationDeg: view.frame.rotationDeg, originMm: { x: view.frame.origin.x * scale, y: view.frame.origin.y * scale } } : null;
  const formulas = frame ? frameFormulas(frame, sheet) : null;
  const label = (id: string) => { const l = findFact(s, "sourceLabel", id)?.value; return `Piece ${callouts.piece.get(id) ?? id}${typeof l === "string" && l ? ` (${l})` : ""}`; };
  const endLabel = (end: "start" | "end") => {
    const pipe = plan.entities.find(e => e.id === span);
    const at = (end === "start" ? pipe?.ports[0] : pipe?.ports.at(-1))?.position;
    const labels = at ? plan.entities.filter(e => e.id !== span && e.ports.some(p => p.position && Math.hypot(p.position.x - at.x, p.position.y - at.y) < 1e-6))
      .map(e => findFact(s, "sourceLabel", e.id)?.value).filter((l): l is string => typeof l === "string" && !!l) : [];
    return labels[0] ?? tr(end);
  };
  const changed = !saved || !!saved.reason || pinned !== span;

  const save = () => act("siteFrame", async cur => {
    if (!target) return;
    const boxes = (f: Fact) => /^(duct|workEnvelope)\./.test(f.field);
    const source = `Synthetic local frame aligned to ${label(span)}; drawing Z is an assumed horizontal test plane, not a measured elevation`;
    const facts = upsertFacts({ detailing: cur.detailing.filter(f => !boxes(f)), siteFacts: cur.siteFacts.filter(f => !boxes(f)) }, [
      ...(["x", "y", "z"] as const).map(k => ({ field: `adaptationFrame.origin.${k}`, value: target.origin[k], unit: "mm", confirmation: "proposed" as const, provenance: "synthetic_assumption" as const, context: "detailing" as const, source })),
      { field: "adaptationFrame.yaw", value: target.yaw, unit: "deg", confirmation: "proposed", provenance: "synthetic_assumption", context: "detailing", source },
    ]);
    const patch: Partial<PackageInputs> = { ...facts };
    if (cur.changeRequest) patch.changeRequest = { ...cur.changeRequest, factIds: cur.changeRequest.factIds.filter(id => [...facts.detailing, ...facts.siteFacts].some(f => f.id === id)) };
    await patchClearing(cur, patch, setNotice);
    setNotice("Saved a synthetic frame for route testing. Enter obstacle and work bounds in this frame; previous boxes have been cleared.");
  });

  return <div className="fa-stack">
    <Field label={tr("Span the frame is pinned to")}><select value={span} onChange={e => setSpan(e.target.value)}>
      {pipes.map(p => <option key={p.id} value={p.id}>{label(p.id)}</option>)}
    </select></Field>
    {frame && target ? <div className="fa-frame-note">
      <p>{tr("X runs along the pipe from")}{" "}{endLabel("start")}{" "}{tr("(X = 0) to")}{" "}{endLabel("end")}{" "}{tr("(X =")}{" "}{lengthText({ value: target.length, unit: "mm", basis: "confirmed_inputs" }).primary}{tr("). Y is level and points to the left of the pipe looking along X. Z is up, 0 at the pipe centerline.")}</p>
      <p className="mono small">{formulas!.plan}</p>
      {formulas!.drawing && <p className="mono small">{formulas!.drawing}</p>}
      <p className="small fa-muted">{tr("The frame is right-handed (yaw")}{" "}{target.yaw < 0 ? "−" : ""}{num(target.yaw)}{tr("°). A value given with Y to the right of the pipe is entered with its Y sign flipped.")}</p>
    </div> : <p className="fa-warn small">{tr("This span is not level or has no length, so it cannot carry a local frame.")}</p>}
    <div className="fa-fact-head"><span className="fa-muted small">{tr("A frame choice, not a measurement.")}</span>{saved ? saved.reason ? <Badge tone="amber">{saved.reason}</Badge> : pinned ? <Badge tone="green">{tr("Saved")}</Badge> : <Badge tone="neutral">{tr("Saved on another origin")}</Badge> : <Badge tone="neutral">{tr("Drawing frame")}</Badge>}</div>
    <div className="fa-actions"><Button variant="primary" busy={busy === "siteFrame"} disabled={!!busy || !target || !changed} onClick={() => void save()}>{saved ? tr("Save frame") : tr("Enter boxes along this span")}</Button></div>
  </div>;
}

// ---------------------------------------------------------------- boxes

const AXES = ["X", "Y", "Z"] as const;
/** Millimetres are shown to 0.0001 mm so a saved value such as 3197.6613 survives a re-save. */
const show = (mm: number | null, unit: Unit) => mm === null ? "" : unit === "mm" ? String(Math.round(mm * 1e4) / 1e4) : lengthInput(mm, unit);
/** An untouched field keeps its exact saved value rather than the rounded text shown for it. */
const keep = (text: string, saved: number | null, unit: Unit) => saved !== null && text === show(saved, unit) ? saved : text.trim() ? parseLength(text, unit) : null;
const unitHint = (unit: Unit) => unit === "mm" ? "Millimetres. Type 4' 2\" for feet and inches." : "Feet and inches; a bare number is inches. Type 1200 mm for millimetres.";

export function SiteBoxInputs({ s, act, busy, unit, setNotice, prefix, title, help }: Common & { prefix: "duct" | "workEnvelope"; title: string; help: string }) {
  const site = siteFrameOf(s);
  const local = !!site;
  const box = readBox(s, prefix);
  const facts = BOX_KEYS.map(k => findFact(s, `${prefix}.${k}`));
  const first = facts.find(f => f?.value !== null && f?.value !== undefined);
  const photos = s.siteFacts.filter(f => f.field.startsWith("evidence.photo") && f.source.assetId);
  const [vals, setVals] = useState(() => box.values.map(v => show(v, unit)));
  const [basis, setBasis] = useState<Basis>(() => basisOf(first));
  const [note, setNote] = useState(() => noteOf(first));
  const [photo, setPhoto] = useState(() => first?.source.assetId ?? "");
  const savedKey = facts.map(f => `${f?.id}:${f?.value}:${f?.confirmation}:${f?.source.description}`).join("|");
  useEffect(() => { setVals(box.values.map(v => show(v, unit))); setBasis(basisOf(first)); setNote(noteOf(first)); setPhoto(first?.source.assetId ?? ""); }, [savedKey, unit]);

  const parsed = vals.map((v, i) => keep(v, box.values[i], unit));
  const invalid = vals.some((v, i) => v.trim() && parsed[i] === null);
  const order = AXES.map((_, i) => parsed[i] !== null && parsed[i + 3] !== null && parsed[i]! >= parsed[i + 3]!);
  const complete = parsed.every(v => v !== null);
  const sample = facts.some(f => f?.source.description.startsWith("SAMPLE"));
  const axisLabel = local
    ? ["Along the pipe (X)", "Across, + to the left (Y)", "Up from the pipe centerline (Z)"]
    : ["East (plan X)", "North (plan Y)", "Up (plan Z)"];

  const save = (confirm: boolean) => act(`${prefix}.${confirm ? "confirm" : "save"}`, async cur => {
    const facts = upsertFacts(cur, BOX_KEYS.map((k, i) => ({
      field: `${prefix}.${k}`, value: parsed[i], unit: "mm", ...siteEvidence(findFact(cur, `${prefix}.${k}`), basis, confirm, note), context: basis === "assumption" ? "detailing" : "observed",
      assetId: photo || null, unknownReason: `${axisLabel[i % 3]} ${i < 3 ? "low" : "high"} face not measured yet`,
    })));
    const patch: Partial<PackageInputs> = { ...facts };
    if (prefix === "duct" && cur.changeRequest) patch.changeRequest = { ...cur.changeRequest, factIds: [...facts.detailing, ...facts.siteFacts].filter(f => f.field.startsWith("duct.")).map(f => f.id) };
    await patchClearing(cur, patch, setNotice);
  });
  const gaps = box.values.some(v => v !== null) ? boxGaps(s, prefix, local) : [];

  return <div className="fa-stack">
    <div className="fa-fact-head"><span className="fa-muted">{help}</span>{sample ? <Badge tone="sample">{tr("Sample")}</Badge> : statusBadge(facts)}</div>
    <div className="fa-boxgrid">
      <span /><span className="fa-muted small">{tr("Lower bound")}</span><span className="fa-muted small">{tr("Upper bound")}</span>
      {AXES.map((a, i) => [
        <span key={`${a}l`} className="small">{tr(axisLabel[i])}</span>,
        ...[i, i + 3].map(j => <input key={j} aria-label={`${title} ${tr(axisLabel[i])} ${tr(j < 3 ? "Lower bound" : "Upper bound")}`} className={`mono ${(vals[j].trim() && parsed[j] === null) || order[i] ? "is-invalid" : ""}`} value={vals[j]} placeholder={tr("Unknown")}
          onChange={e => setVals(vals.map((v, k) => k === j ? e.target.value : v))} />),
      ])}
    </div>
    <small className="fa-muted">{unitHint(unit)}</small>
    {order.some(Boolean) && <small className="fa-warn">{tr("Each \"From\" must be less than its \"To\".")}</small>}
    {!complete && <small className="fa-warn">{tr("Empty faces are saved as unknown, not zero.")}{parsed[2] === null || parsed[5] === null ? tr(" Without the height (Z), no route can be generated around it.") : ""}</small>}
    <BasisPicker basis={facts.some(isTestAssumption) ? "assumption" : basis} onChange={setBasis} name={`${prefix}-basis`} locked={facts.some(isTestAssumption)} />
    <div className="fa-row2">
      <Field label={basis === "assumption" ? tr("Why this value (optional)") : tr("How it was measured (optional)")}><input value={note} onChange={e => setNote(e.target.value)} placeholder={basis === "assumption" ? tr("e.g. FS-01 acceptance v1") : tr("e.g. Tape from the pipe centerline")} /></Field>
      <Field label={tr("Evidence photo")}><select value={photo} onChange={e => setPhoto(e.target.value)}>
        <option value="">{tr("None")}</option>{photos.map(p => <option key={p.id} value={p.source.assetId!}>{p.source.description.slice(0, 60)}</option>)}
      </select></Field>
    </div>
    {photo && <small className="fa-muted">{tr("The photo is linked as evidence. The numbers come from what you typed, never from the photo.")}</small>}
    {gaps.length > 0 && <ul className="fa-gaps">{gaps.map(g => <li key={g}>{g}</li>)}</ul>}
    <div className="fa-actions">
      <Button busy={busy === `${prefix}.save`} disabled={!!busy || invalid} onClick={() => void save(false)}>{tr("Save")}</Button>
      <Button variant="primary" busy={busy === `${prefix}.confirm`} disabled={!!busy || invalid || !complete || order.some(Boolean) || (local && !!site?.reason)} onClick={() => void save(true)}>{basis === "assumption" ? tr("Confirm test values") : tr("Confirm measurement")}</Button>
    </div>
  </div>;
}

// ---------------------------------------------------------------- single lengths

export function SiteLengthInput({ s, act, busy, unit, setNotice, field, subject, label, tag, help }: Common & { field: string; subject?: string; label: string; tag?: string; help: string }) {
  const f = findFact(s, field, subject);
  const savedMm = typeof f?.value === "number" ? toMm(f.value, f.unit) : null;
  const shown = show(savedMm, unit);
  const [value, setValue] = useState(shown);
  const [basis, setBasis] = useState<Basis>(() => basisOf(f));
  const [note, setNote] = useState(() => noteOf(f));
  useEffect(() => { setValue(shown); setBasis(basisOf(f)); setNote(noteOf(f)); }, [f?.id, f?.value, f?.source.description, unit]);
  const parsed = keep(value, savedMm, unit);
  const save = (confirm: boolean) => act(`${field}.${confirm}`, cur => patchClearing(cur, upsertFacts(cur, [{
    field, subjectIds: subject ? [subject] : [], value: parsed, unit: "mm", ...siteEvidence(findFact(cur, field, subject), basis, confirm, note), context: basis === "assumption" ? "detailing" : "observed",
  }]), setNotice));
  return <div className="fa-fact">
    <div className="fa-fact-head"><span>{label}{tag && <> <Badge tone="neutral">{tag}</Badge></>}</span>{statusBadge([f])}</div>
    <div className="fa-row2">
      <input className={`mono ${value.trim() && parsed === null ? "is-invalid" : ""}`} value={value} onChange={e => setValue(e.target.value)} aria-label={label} placeholder={unit === "mm" ? tr("mm") : tr("ft-in")} />
      <input value={note} onChange={e => setNote(e.target.value)} aria-label={`${label} note`} placeholder={tr("Note (optional)")} />
    </div>
    <BasisPicker basis={isTestAssumption(f) ? "assumption" : basis} onChange={setBasis} name={`${field}-${subject ?? ""}-basis`} locked={isTestAssumption(f)} />
    <small className="fa-muted">{help} {unitHint(unit)}</small>
    <div className="fa-actions">
      <Button busy={busy === `${field}.false`} disabled={!!busy || (!!value.trim() && parsed === null)} onClick={() => void save(false)}>{tr("Save")}</Button>
      <Button variant="primary" busy={busy === `${field}.true`} disabled={!!busy || parsed === null || parsed <= 0} onClick={() => void save(true)}>{tr("Confirm")}</Button>
    </div>
  </div>;
}
