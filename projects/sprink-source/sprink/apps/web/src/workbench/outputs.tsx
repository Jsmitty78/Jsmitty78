import { Fragment } from "react";
import { tr } from "./locale.js";
import type { PackageResult } from "@sprink/core";
import type { DetailPlan } from "./api.js";
import { countText, DISPLAY_ROUNDING, lengthText, metresText, unknownReason, productCode, productName, signedCount, type Quantity } from "./format.js";
import { checkCounts, groupChecks, labelFor, ROUTE_ORDER_NOTE, sourceTitle, sourceUrl, type Callouts, type CheckGroup, type Plan, type RouteOption } from "./model.js";
import { Badge, Button, Callout, Icon, Length, Section } from "./ui.js";

type Sources = Array<{ id: string; document?: string; title?: string; url?: string }> | undefined;
const STATUS: Record<CheckGroup["status"], { label: string; tone: "green" | "amber" | "red" | "neutral" }> = {
  pass: { label: "Pass", tone: "green" }, unknown: { label: "Unknown", tone: "amber" }, fail: { label: "Fail", tone: "red" }, not_applicable: { label: "N/A", tone: "neutral" },
};

export function SourceLinks({ refs, sources }: { refs: string[]; sources: Sources }) {
  if (!refs.length) return <span className="fa-src none">{tr("No source cited")}</span>;
  return <span className="fa-src">{refs.map(r => {
    const url = sourceUrl(r, sources);
    return url ? <a key={r} href={url} target="_blank" rel="noreferrer">{sourceTitle(r, sources)}<Icon name="external" size={11} /></a> : <span key={r}>{sourceTitle(r, sources)}</span>;
  })}</span>;
}

export function CheckList({ groups, sources, callouts, compact }: { groups: CheckGroup[]; sources: Sources; callouts?: Callouts; compact?: boolean }) {
  if (!groups.length) return <p className="fa-muted">{tr("No findings for this item.")}</p>;
  return <ul className={`fa-checks ${compact ? "compact" : ""}`}>{groups.map(g => <li key={`${g.status}${g.reason}`}>
    <Badge tone={STATUS[g.status].tone}>{STATUS[g.status].label}</Badge>
    <div>
      <p>{g.reason}{g.count > 1 && <span className="fa-muted"> ({g.count}{" "}{tr("checks)")}</span>}</p>
      {!compact && callouts && g.subjectIds.length > 0 && <p className="fa-muted small">{tr("Applies to")}{" "}{g.subjectIds.map(id => labelFor(callouts, id)).join(", ")}</p>}
      <SourceLinks refs={g.sourceRefs} sources={sources} />
    </div>
  </li>)}</ul>;
}

/** Stale results stay visible but say what they belong to. */
export function Freshness({ current, revision, resultRevision }: { current: boolean; revision: number; resultRevision?: number }) {
  if (current) return <Badge tone="green">{tr("Current for rev")}{" "}{revision}</Badge>;
  return <Badge tone="amber" title={tr("Inputs changed after these results were generated")}>{tr("Stale: from rev")}{" "}{resultRevision ?? "?"}{tr(", inputs now rev")}{" "}{revision}</Badge>;
}

export interface ContextItem { id: string; kind: string; label: string | null }
export function MaterialsCuts({ result, current, revision, plan, callouts, detail, selectedPiece, onSelectPiece, sources, label, selectedMaterial, onSelectMaterial, scopeOnly, context = [], projected = false }: {
  result: PackageResult | undefined; current: boolean; revision: number; plan: Plan | null; callouts: Callouts; detail?: DetailPlan;
  selectedPiece: string | null; onSelectPiece: (id: string | null) => void; sources: Sources; label?: string; selectedMaterial?: string | null; onSelectMaterial?: (id: string | null) => void; scopeOnly?: boolean;
  context?: ContextItem[];
  projected?: boolean;
}) {
  if (!result) return <div className="fa-empty"><Icon name="layers" size={28} /><p>{tr("部材はまだ生成されていません")}</p><small>{tr("図面と対象区間を登録すると、部材・切断寸法・組立を確認できます。")}</small></div>;
  const cutDetail = new Map(detail?.fabrication?.cuts.map(c => [c.pieceId, c]) ?? []);
  const fittings = plan?.entities.filter(e => e.kind === "fitting" && result.materials.some(m => m.entityIds.includes(e.id))) ?? [];
  return <div className="fa-stack">
    <>{label && <p className="fa-muted small">{label}</p>}{!current && <Freshness current={current} revision={revision} resultRevision={result.inputRevision} />}</>
    {!current && <Callout title={tr("These results are from older inputs")}>{tr("Regenerate before cutting. The numbers below are kept for comparison only.")}</Callout>}
    <section className="wf-material-list">
      <table className="fa-table"><thead><tr><th>{tr("部材")}</th><th className="num">{tr("数量")}</th></tr></thead>
        <tbody>{result.materials.filter(m => !scopeOnly || !!selectedPiece && m.entityIds.includes(selectedPiece)).map(m => {
          const selected = selectedMaterial === m.id || !!selectedPiece && m.entityIds.includes(selectedPiece);
          return <Fragment key={m.id}>
            <tr className={selected ? "wf-material-selected" : ""}>
              <td><button type="button" className="wf-material-name" aria-expanded={selected} aria-pressed={selected} onClick={() => onSelectMaterial?.(selected ? null : m.id)}>{isProduct(m.description) ? productName(m.description) : m.description.split(";")[0].split(" (")[0]}<Icon name="chevron" size={14} /></button></td>
              <td className="num">{m.quantity.value === null ? <span className="fa-unknown">{tr("未確定")}</span> : countText(m.quantity)}</td>
            </tr>
            {selected && <tr className="wf-material-detail"><td colSpan={2}>
              <p>{m.description}</p>
              {m.quantity.value === null && <p className="fa-warn">{m.quantity.reason}</p>}
              <div className="fa-steptags">{m.entityIds.map(id => <button type="button" key={id} className="fa-tagbox small" aria-pressed={selectedPiece === id} onClick={() => onSelectPiece(selectedPiece === id ? null : id)}>{labelFor(callouts, id)}</button>)}</div>
              {result.cuts.filter(c => m.entityIds.includes(c.pieceId)).map(c => <div key={c.id} className="wf-part-cut"><span>{labelFor(callouts, c.pieceId)} · {tr("Cut length")}</span><Length q={c.length} /></div>)}
            </td></tr>}
          </Fragment>;
        })}</tbody></table>
    </section>
    <Section title={tr("Dimensions & specifications")} defaultOpen={false}>
      <p className="fa-fine">{tr("数量はモデル内の部材数です。発注単位・購入量は含みません。")}</p>
    <Section title={tr("切断寸法")} count={result.cuts.length} defaultOpen={false}>
      <table className="fa-table fa-cuts"><thead><tr><th>{tr("Piece")}</th><th className="num">{tr(projected ? "Projected centerline" : "Center to center")}</th><th className="num">{tr("Cut length")}</th></tr></thead>
        <tbody>{result.cuts.map(c => {
          const d = cutDetail.get(c.pieceId);
          const on = c.pieceId === selectedPiece;
          return [
            <tr key={c.id} className={`fa-selectable ${on ? "is-on" : ""}`} onClick={() => onSelectPiece(on ? null : c.pieceId)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") onSelectPiece(on ? null : c.pieceId); }} aria-selected={on}>
              <td><span className={`fa-tagbox ${lengthText(c.length).known ? "" : "is-unknown"}`}>{callouts.piece.get(c.pieceId) ?? "?"}</span><small>{plan?.entities.find(e => e.id === c.pieceId)?.productId ? productCode(plan?.entities.find(e => e.id === c.pieceId)?.productId) : tr("Product not selected")}</small></td>
              <td className="num">{d ? <Length q={d.centerline as Quantity} /> : <span className="fa-muted">—</span>}</td>
              <td className="num strong">{lengthText(c.length).known ? <Length q={c.length} /> : <span className="fa-unknown">{tr("Unknown")}</span>}</td>
            </tr>,
            !lengthText(c.length).known && <tr key={`${c.id}-why`} className="fa-rowwhy"><td colSpan={3}><ul>{unknownReason(c.length).split("; ").map(r => <li key={r}>{r}</li>)}</ul></td></tr>,
            on && <tr key={`${c.id}-d`} className="fa-rowdetail"><td colSpan={3}>
              {d?.takeouts.length ? <div className="fa-takeouts"><span className="fa-muted">{tr("Deductions (server)")}</span>{d.takeouts.map((t, i) => <span key={i}>{t.fittingId ? callouts.fitting.get(t.fittingId) ?? tr("fitting") : t.datum === "tie_in" ? tr("Tie-in") : t.datum.replace(/_/g, " ")}: <b className="mono">{lengthText(t.netTakeout as Quantity).primary}</b></span>)}</div> : null}
              {d?.formula && <p className="fa-muted small mono">{d.formula}</p>}
              <CheckList groups={groupChecks(result.evaluations, c.pieceId)} sources={sources} compact />
            </td></tr>,
          ];
        })}</tbody></table>
      {fittings.length > 0 && <p className="fa-muted small">{tr("Fittings:")}{" "}{fittings.map(f => `${callouts.fitting.get(f.id)} ${productCode(f.productId)}`).join(" · ")}</p>}
      {projected && <p className="fa-muted small">{tr("Centerlines are plan lengths measured on the drawing. They are not a purchased stock length, and the physical length and elevation are not verified.")}</p>}
      <p className="fa-muted small">{DISPLAY_ROUNDING}</p>
    </Section>
    {context.length > 0 && <Section title={tr("Retained context")} count={context.length}>
      <p className="fa-muted small">{tr("On the drawing for traceability. Outside this work: not detailed, not connected, not purchased.")}</p>
      <ul className="fa-context-items">{context.map(c => <li key={c.id}><span className="fa-tagbox small is-context">{c.label ?? c.id}</span>{c.kind === "head" ? tr("Sprinkler head") : c.kind === "pipe" ? tr("Adjacent pipe") : c.kind}<small className="mono">{c.id}</small></li>)}</ul>
    </Section>}
    {result.gaps.length > 0 && <Section title={tr("Still missing")} count={result.gaps.length} defaultOpen={false}>
      <ul className="fa-list">{[...new Set(result.gaps.map(g => g.reason))].map(r => <li key={r}>{r}</li>)}</ul>
    </Section>}
    </Section>
  </div>;
}

const isProduct = (description: string) => !description.includes(";") && !/^(Pipe|Fitting), product not selected/.test(description);

export function Assembly({ result, callouts, sources, selectedPiece, onSelectPiece }: { result: PackageResult | undefined; callouts: Callouts; sources: Sources; selectedPiece?: string | null; onSelectPiece?: (id: string | null) => void }) {
  if (!result) return <div className="fa-empty"><p>{tr("No assembly steps yet.")}</p></div>;
  return <ol className="fa-steps">{result.assembly.map(a => <li key={a.id} className={a.unresolved.length ? "is-open" : ""}>
    <span className="fa-stepno">{a.step}</span>
    <div>
      <p>{a.instruction}</p>
      <div className="fa-steptags">{a.pieceIds.map(id => <button type="button" key={id} className="fa-tagbox small" aria-pressed={selectedPiece === id} onClick={() => onSelectPiece?.(selectedPiece === id ? null : id)}>{callouts.piece.get(id) ?? id}</button>)}{a.jointIds.length > 0 && <span className="fa-muted small">{a.jointIds.length}{" "}{tr("joint")}{a.jointIds.length > 1 ? tr("s") : ""}</span>}</div>
      {a.procedureRef && <SourceLinks refs={[a.procedureRef]} sources={sources} />}
      {a.unresolved.map(u => <p key={u} className="fa-warn small"><Icon name="alert" size={12} /> {u}</p>)}
    </div>
  </li>)}</ol>;
}

export function Checks({ result, sources, callouts }: { result: PackageResult | undefined; sources: Sources; callouts: Callouts }) {
  if (!result) return <div className="fa-empty"><p>{tr("No checks yet.")}</p></div>;
  const c = checkCounts(result.evaluations);
  return <div className="fa-stack">
    <div className="fa-counts"><span><b>{c.pass}</b>{" "}{tr("pass")}</span><span className="amber"><b>{c.unknown}</b>{" "}{tr("unknown")}</span><span className="red"><b>{c.fail}</b>{" "}{tr("fail")}</span></div>
    <p className="fa-muted small">{tr("These are the server's rule findings for this run. Unknown means the rule could not be decided from the inputs; it is not a pass. None of this is construction approval.")}</p>
    <Section title={tr("This work")} count={groupChecks(result.evaluations).filter(g => g.subjectIds.length).length}><CheckList groups={groupChecks(result.evaluations).filter(g => g.subjectIds.length)} sources={sources} callouts={callouts} /></Section>
    <Section title={tr("Project and permit")} count={groupChecks(result.evaluations, "").length} defaultOpen={false}><CheckList groups={groupChecks(result.evaluations, "")} sources={sources} /></Section>
  </div>;
}

// ---------------------------------------------------------------- adapt

export function RouteComparison({ routes, baseline, baselineResult, focusId, selectedId, current, appliedAt, rejected, searchDescription, noneReason, hasGeneration, onPreview, onRegenerate, onShowPackage, busy, clearanceMissing, syntheticGeometry, sources }: {
  routes: RouteOption[]; baseline: Plan | null; baselineResult: PackageResult | undefined; focusId: string | null; selectedId: string | null; current: boolean; appliedAt: number | null;
  rejected: Array<{ id: string; reason: string }>; searchDescription: string | null; noneReason: string | null; hasGeneration?: boolean;
  onPreview: (id: string) => void; onRegenerate: () => void; onShowPackage: () => void; busy: boolean; clearanceMissing: boolean; syntheticGeometry?: boolean; sources: Sources;
}) {
  const focus = routes.find(r => r.plan.id === focusId);
  const baseFittings = baseline?.entities.filter(e => e.kind === "fitting").length ?? 0;
  return <div className="fa-stack">
    {!current && routes.length > 0 && appliedAt !== null && <Callout tone="neutral" title={`Route ${routes.find(r => r.plan.id === selectedId)?.letter ?? ""} is applied at rev ${appliedAt}`} action={<Button busy={busy} onClick={onRegenerate}><Icon name="refresh" size={14} />{tr("Regenerate")}</Button>}>{tr("Selecting a route creates a new input revision, so these routes are kept as history. Regenerate to choose a different one.")}</Callout>}
    {!current && routes.length > 0 && appliedAt === null && <Callout title={tr("These routes were generated for older inputs")} action={<Button busy={busy} onClick={onRegenerate}><Icon name="refresh" size={14} />{tr("Regenerate")}</Button>}>
      {selectedId ? tr("Your selection is kept for reference, but it cannot be used until the routes are regenerated.") : tr("Regenerate before choosing a route.")}
    </Callout>}
    {clearanceMissing && <Callout title={tr("Clearance input needed")}>{tr("Enter the required clearance and its provenance under Site evidence before generating routes.")}</Callout>}
    {syntheticGeometry && <Callout tone="neutral" title={tr("Synthetic geometry test")}>{tr("These routes use labeled test assumptions. Site measurements and construction suitability remain unverified.")}</Callout>}
    {routes.length === 0 ? current ? <Callout tone="red" title={tr("No generated alternative is available")} action={<Button busy={busy} onClick={onRegenerate}>{tr("Regenerate")}</Button>}>
      {noneReason ?? tr("No alternative was found in the supported route templates.")}{" "}{tr("Check the obstacle and work boundary inputs, then regenerate.")}</Callout> : <Callout tone="neutral" title={hasGeneration ? tr("Inputs changed — regenerate routes") : tr("Generate route alternatives")} action={<Button busy={busy} onClick={onRegenerate}>{hasGeneration ? tr("Regenerate") : tr("Generate")}</Button>}>
      {hasGeneration ? tr("The previous search belongs to older inputs. Regenerate to evaluate your saved changes; previous missing-input findings no longer describe this revision.") : tr("Generate from the saved geometry and its evidence or labeled test assumptions to search the supported templates.")}
    </Callout> : <Section title={tr("Proposed routes")} count={routes.length}>
      <table className="fa-table fa-routes"><thead><tr><th>{tr("Route")}</th><th>{tr("Proposal")}</th><th>{tr("State")}</th></tr></thead>
        <tbody>{routes.map(r => {
          const state = r.plan.id === selectedId ? <Badge tone="blue">{tr("Selected by you")}</Badge> : r.centerlineDeltaM === null ? <Badge tone="amber">{tr("Needs input")}</Badge> : r.plan.id === focusId ? <Badge>{tr("Previewing")}</Badge> : <Badge>{tr("Generated")}</Badge>;
          const delta = metresText(r.centerlineDeltaM, true);
          return <tr key={r.plan.id} className={`fa-selectable ${r.plan.id === focusId ? "is-on" : ""}`} onClick={() => onPreview(r.plan.id)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") onPreview(r.plan.id); }}>
            <td><span className="fa-route-letter">{r.letter}</span></td>
            <td><strong>{r.fittings - baseFittings}{" "}{tr("added fitting")}{r.fittings - baseFittings === 1 ? "" : tr("s")}</strong><small>{delta.known ? `${delta.primary} centerline` : `Length unknown: ${r.unknownReason}`}</small></td>
            <td>{state}</td>
          </tr>;
        })}</tbody></table>
      {routes.length === 1 && <p className="fa-muted small">{tr("Only one route fits. Review it before selecting.")}</p>}
      <p className="fa-muted small">{ROUTE_ORDER_NOTE}{searchDescription ? ` Search: ${searchDescription}` : ""}</p>
    </Section>}
    {current && rejected.length > 0 && <Section title={tr("Layouts the planner rejected")} count={rejected.length} defaultOpen={false}>
      <ul className="fa-list">{rejected.map(r => <li key={r.id}>{r.reason}</li>)}</ul>
    </Section>}
    {focus && <Section title={`Changes with Route ${focus.letter}`}>
      <table className="fa-table"><thead><tr><th /><th className="num">{tr("Existing")}</th><th className="num">{tr("Route")}{" "}{focus.letter}</th></tr></thead>
        <tbody>
          <tr><td>{tr("Pipe centerline")}</td><td className="num fa-muted">—</td><td className="num"><Length q={focus.centerlineDeltaM === null ? { value: null, unit: "m", reason: focus.unknownReason } : { value: focus.centerlineDeltaM, unit: "m", basis: "proposed_inputs" }} signed /></td></tr>
          <tr><td>{tr("Fittings incl. retained context")}</td><td className="num">{baseFittings}</td><td className="num">{focus.fittings}</td></tr>
          <tr><td>{tr("Modeled spans (closure may split them)")}</td><td className="num">{baselineResult?.cuts.length ?? tr("Unknown")}</td><td className="num">{focus.result?.cuts.length ?? tr("Unknown")}</td></tr>
          <tr><td>{tr("Assembly steps")}</td><td className="num">{baselineResult?.assembly.length ?? tr("Unknown")}</td><td className="num">{focus.result?.assembly.length ?? tr("Unknown")}</td></tr>
        </tbody></table>
      {focus.result && <CheckList groups={groupChecks(focus.result.evaluations).filter(g => g.subjectIds.length && g.status !== "pass").slice(0, 2)} sources={sources} compact />}
      <Button variant="quiet" onClick={onShowPackage}>{tr("View materials and cuts")}</Button>
    </Section>}
  </div>;
}

export function PackageDelta({ detail, callouts, baselineResult }: { detail: DetailPlan | undefined; callouts: Callouts; baselineResult: PackageResult | undefined }) {
  const delta = detail?.delta;
  if (!delta) return null;
  const name = (id: string) => { if (id.startsWith("unresolved-")) return `${id.slice(11)} requirements (unresolved)`; const [kind, product] = id.split(":"); return kind === "consumable" ? "Solvent cement" : productName(product); };
  return <Section title={tr("Change from the original")}>
    <table className="fa-table"><thead><tr><th>{tr("Item")}</th><th className="num">{tr("Original")}</th><th className="num">{tr("Revised")}</th><th className="num">{tr("Change")}</th></tr></thead>
      <tbody>{delta.materials.map(m => <tr key={m.id}>
        <td>{name(m.id)}</td>
        <td className="num">{m.baselineQuantity ?? tr("Unknown")}</td>
        <td className="num">{m.candidateQuantity ?? <span className="fa-unknown">{tr("Unknown")}</span>}</td>
        <td className="num strong">{signedCount(m.quantityDelta)}</td>
      </tr>)}</tbody></table>
    <div className="fa-kv compact">
      <span>{tr("Centerline")}</span><strong><Length q={delta.centerlineDeltaM === null ? null : { value: delta.centerlineDeltaM, unit: "m", basis: "proposed_inputs" }} signed /></strong>
      <span>{tr("Total cut length")}</span><strong><Length q={delta.cutLengthDeltaM === null ? null : { value: delta.cutLengthDeltaM, unit: "m", basis: "proposed_inputs" }} signed /></strong>
      <span>{tr("Joints")}</span><strong className="mono">{signedCount(delta.jointCountDelta)}</strong>
      <span>{tr("Operations")}</span><strong className="mono">{signedCount(delta.operationCountDelta)}</strong>
    </div>
    <ul className="fa-deltas">{delta.pieces.map(p => <li key={p.pieceId}>
      <span className={`fa-delta-mark ${p.state}`}>{p.state === "added" ? "+" : p.state === "removed" ? "−" : "~"}</span>{tr("Piece")}{" "}{callouts.piece.get(p.pieceId) ?? p.pieceId} <span className="fa-muted">{p.state}</span>
      <span className="mono">{metresText(p.cutLengthDeltaM, true).primary}</span>
    </li>)}</ul>
    {baselineResult && <p className="fa-muted small">{tr("The original baseline is preserved unchanged:")}{" "}{baselineResult.cuts.length}{" "}{tr("piece")}{baselineResult.cuts.length === 1 ? "" : tr("s")}, {baselineResult.cuts.map(c => lengthText(c.length).primary).join(", ")}.</p>}
  </Section>;
}
