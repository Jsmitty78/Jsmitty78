import { SiteSection } from './site/SiteSection.js';
import { getLocale, tr, LanguageSwitch } from "./locale.js";
import { adaptationFrame, geometryFactUsable, isSyntheticPackageFact } from "@sprink/core";
import { useEffect, useMemo, useState } from "react";
import { metresText } from "./format.js";
import { api, type Snapshot } from "./api.js";
import { ChangeInputs, DetailingInputs, EvidenceInputs, RunEditor, type Unit } from "./inputs.js";
import { callouts, contextIds, findFact, readBox, requirements, siteFrameOf, sourceLabel, resultFor, routeOptions, runBlockers, labelFor, type Plan } from "./model.js";
import { SiteBoxInputs, SiteFrameInputs, SiteLengthInput } from "./site/SiteInputs.js";
import { SiteViews } from "./site/SiteViews.js";
import { IntakeInputs } from "./intake/IntakeInputs.js";
import { SheetView } from "./intake/SheetView.js";
import { FRAME_ID } from "./intake/sheet.js";
import { useIntake } from "./intake/useIntake.js";
import "./intake/intake.css";
import { Assembly, Checks, Freshness, MaterialsCuts, PackageDelta, RouteComparison, SourceLinks } from "./outputs.js";
import { SiteShapeEditor } from "./site/SiteShapeEditor.js";
import { SiteEvidence, SiteMeasurements, DesignerReviews } from "./site/SiteEvidence.js";
import { PlanCanvas } from "./PlanCanvas.js";
import { hasSampleData, sampleDrawing, sampleInputs } from "./sample.js";
import { Badge, Button, Callout, Icon, Section, Spinner } from "./ui.js";
import { usePackage } from "./usePackage.js";
import { AskPanel } from "./ask/AskPanel.js";
import { SprinkLogo } from "./logo.js";
import { copyForSiteChange, WORKFLOWS, materialSelection, sourcePlanForDisplay, type Workflow } from "./workflows.js";
import "./workflows.css";

export function Workbench({ id, onHome, onOpen, onAuthFailure }: { id: string; onHome: () => void; onOpen: (id: string) => void; onAuthFailure: () => void }) {
  const pkg = usePackage(id, onAuthFailure);
  const s = pkg.snapshot;
  const intake = useIntake(s);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const active = workflow ?? (s?.intent === "adapt_to_site" ? "site" : "materials");
  const [preview, setPreview] = useState<string | null>(null);
  const [piece, setPiece] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [viewChoice, setView] = useState<"drawing" | "plan" | null>(null);
  const view = viewChoice ?? (active === "site" ? "plan" : "drawing");
  const [comparison, setComparison] = useState<"original" | "overlay" | "proposal">("overlay");
  const [unit, setUnit] = useState<Unit>(() => { try { return localStorage.getItem("sprink.unit") === "in" ? "in" : "mm"; } catch { return "mm"; } });
  useEffect(() => { try { localStorage.setItem("sprink.unit", unit); } catch { /* Session-only preference. */ } }, [unit]);
  const [exportOpen, setExportOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const [sampleReview, setSampleReview] = useState<{ id: string; revision: number } | null>(null);
  const [codesVisited, setCodesVisited] = useState(false);
  const [returnTo, setReturnTo] = useState<"materials" | "site">("materials");
  const selectPiece = (id: string | null) => {
    setPiece(id); setGroup(null);
    if (id && !(s?.sourceDrawing?.view && intake.savedTransform && s.baselinePlan?.coordinateFrame.id === FRAME_ID)) setView("plan");
  };
  const switchWorkflow = (next: Workflow) => {
    if (next === "codes") { if (active !== "codes") setReturnTo(active); setCodesVisited(true); }
    setChecksOpen(false);
    setWorkflow(next);
  };
  const context = useMemo(() => contextIds(s ?? { scope: null }), [s?.scope]);
  const detailFor = (planId: string | undefined) => pkg.detail?.state?.details.find(d => d.plan.id === planId);
  const calloutsFor = useMemo(() => (plan: Plan) => callouts(plan, detailFor(plan.id)?.fabrication, context), [pkg.detail, context]);
  const header = <header className="wf-header"><button className="fa-brand" onClick={onHome} aria-label={tr("案件一覧")}><SprinkLogo /></button>
    <nav className="wf-nav" aria-label={tr("作業画面")}>{WORKFLOWS.map(([key, label]) => <button key={key} aria-current={active === key ? "page" : undefined} onClick={() => switchWorkflow(key)}>{tr(label)}</button>)}</nav>
    <LanguageSwitch /><div className="wf-header-actions">{active !== "codes" && <Button disabled={!s} onClick={() => setExportOpen(true)}><Icon name="download" size={16} />{tr("出力")}</Button>}</div></header>;
  if (pkg.loading && !s) return <>{header}<Spinner label={tr("図面と資料を読み込んでいます…")} /></>;
  if (!s) return <>{header}<Callout tone="red" title={tr("作業を開けませんでした")}>{pkg.error}</Callout></>;
  const sampleReviewed = sampleReview?.id === s.id && sampleReview.revision === s.inputRevision;
  const mode = s.intent === "adapt_to_site" ? "adapt" : "prepare";
  const baseline = s.baselinePlan;
  const base = resultFor(s, baseline?.id);
  const routes = routeOptions(s.outputs.candidates, s.outputs.results);
  const candidatesCurrent = !!s.outputs.candidates && s.freshness.candidates;
  const selectedId = s.selectedPlan && s.selectedPlan.id !== baseline?.id ? s.selectedPlan.id : null;
  const selectedResult = resultFor(s, selectedId ?? undefined);
  const focusId = preview && routes.some(r => r.plan.id === preview) ? preview : selectedId ?? routes[0]?.plan.id ?? null;
  const focus = routes.find(r => r.plan.id === focusId);
  const workPlan = mode === "adapt" ? focus?.plan ?? baseline : baseline;
  const workResult = mode === "adapt" ? focus?.result ?? base.result : base.result;
  const materialRoute = mode === "adapt" ? routes.find(r => r.plan.id === (selectedId ?? focusId)) : undefined;
  const materialPlan = mode === "adapt" ? (selectedId ? s.selectedPlan : materialRoute?.plan) ?? baseline : baseline;
  const materialResult = mode === "adapt"
    ? (selectedId ? selectedResult.result : materialRoute ? materialRoute.result : base.result)
    : base.result;
  const materialCurrent = mode === "prepare" ? base.current : selectedId ? selectedResult.current : materialRoute ? candidatesCurrent : base.current;
  const reviewResult = active === "materials" ? materialResult : workResult;
  const missingReasons = [...new Set(reviewResult?.gaps.map(g => g.reason) ?? [])];
  const materialLabel = mode === "adapt" && !selectedId && materialRoute ? tr("Preview of Route {route} · not selected", { route: materialRoute.letter }) : undefined;
  const current = mode === "prepare" ? base.current : selectedId === focusId ? selectedResult.current : candidatesCurrent;
  const detailCurrent = !!pkg.detail?.current && pkg.detail.state?.inputRevision === s.inputRevision;
  const cuts = new Map(((active === "materials" ? materialResult : workResult)?.cuts ?? []).map(c => [c.pieceId, c.length]));
  const sources = detailFor(workPlan?.id)?.fabrication?.sources;
  const materialSources = detailFor(materialPlan?.id)?.fabrication?.sources;
  const reqs = requirements(s), blockers = runBlockers(s);
  const running = s.run?.status === "running", disabled = !!pkg.busy || running;
  const common = { s, act: pkg.act, busy: disabled ? pkg.busy || "running" : "", unit, setNotice: pkg.setNotice };
  const baseCallouts = baseline ? calloutsFor(baseline) : callouts(null);
  const workCallouts = workPlan ? calloutsFor(workPlan) : callouts(null);
  const materialCallouts = materialPlan ? calloutsFor(materialPlan) : callouts(null);
  const displayCallouts = active === "materials" ? materialCallouts : workCallouts;
  const selectedIds = materialSelection(active === "materials" ? materialResult : workResult, group, piece);
  const d = s.sourceDrawing;
  const mapped = !!d?.view && !!intake.savedTransform && baseline?.coordinateFrame.id === FRAME_ID;
  const showSourceOnly = !!d && view === "drawing" && !mapped;
  let toDrawing: ((p: { x: number; y: number; z: number }) => { x: number; y: number; z: number }) | undefined;
  let frameError: string | null = null;
  try { toDrawing = adaptationFrame(s).toDrawing; } catch (e) { frameError = e instanceof Error ? e.message : String(e); }
  const workflowQuestion = pkg.detail?.state?.latestRun?.id === s.run?.id ? pkg.detail?.state?.latestRun?.question : undefined;
  const openRequests = s.outputs.requests.filter(r => s.freshness.requests.some(f => f.id === r.id && f.current && !f.answered) && !(workflowQuestion?.kind === "candidate_selection" && workflowQuestion.text === r.question));
  const start = (goal: "prepare_from_drawing" | "adapt_to_site" | "export_selected_package", label = "run") => pkg.act(label, cur => api.start(cur.id, cur.inputRevision, goal));
  const regenerate = () => pkg.act("run", async cur => {
    const next = cur.selectedPlan && cur.baselinePlan && cur.selectedPlan.id !== cur.baselinePlan.id
      ? await api.select(cur.id, cur.inputRevision, cur.baselinePlan.id) : cur;
    await api.start(next.id, next.inputRevision, "adapt_to_site");
  });
  const choose = (planId: string) => pkg.act("select", async cur => { const next = await api.select(cur.id, cur.inputRevision, planId); await api.start(next.id, next.inputRevision, "adapt_to_site"); });
  const loadSample = () => pkg.act("sample", async cur => { const asset = await api.upload(cur.id, await sampleDrawing(mode)); await api.edit(cur.id, cur.inputRevision, sampleInputs(mode, asset.id)); }).then(ok => { if (ok) setView("plan"); });
  const sitePlan = comparison === "original" ? baseline : workPlan;
  const displayedPlan = active === "site" ? sitePlan : materialPlan;
  const drawingProposal = active === "site" && comparison !== "original" && !candidatesCurrent && selectedId && selectedResult.current ? s.selectedPlan : displayedPlan;
  const drawingPlan = sourcePlanForDisplay(mode === "adapt", candidatesCurrent, !!selectedId && selectedResult.current, baseline, drawingProposal);
  const affectedTargets = [...new Set((s.changeRequest?.affectedEntityIds ?? []).map(id => labelFor(baseCallouts, id)).filter(Boolean))];
  const targetLabel = affectedTargets.length > 2 ? tr("{target} +{count} more", { target: affectedTargets.slice(0, 2).join(", "), count: affectedTargets.length - 2 }) : affectedTargets.join(", ");
  const siteHeading = affectedTargets.length ? tr("Change to {target}", { target: targetLabel }) : tr("Site change options");
  const onDrawingSelect = (id: string | null) => { selectPiece(id); if (active === "site" && id) setSiteOpen(true); };
  const startSite = () => pkg.act("copy-site", async cur => { const next = await copyForSiteChange(cur, getLocale()); onOpen(next.id); });
  const sourceRefs = [...new Set(workResult?.evaluations.flatMap(e => e.sourceRefs) ?? [])];
  const sourceInputs = <><Section title={tr("図面と対象範囲")}><IntakeInputs {...common} intake={intake} showSheet={() => { setView("drawing"); }} /></Section>
    {(!baseline || baseline.coordinateFrame.id !== FRAME_ID) && <Section title={tr("区間の座標を入力")} defaultOpen={!baseline}><RunEditor {...common} callouts={baseCallouts} /></Section>}
    <DetailingInputs {...common} callouts={baseCallouts} /></>;
  const canvasProps = { mode: active === "site" ? "adapt" as const : "prepare" as const, baseline: active === "site" ? baseline : materialPlan,
    routes: active === "site" && comparison !== "original" ? routes.filter(r => r.plan.id === focusId) : [], staleRoutes: active === "site" && !candidatesCurrent && !(selectedId && selectedResult.current), focusRouteId: focusId, selectedRouteId: selectedId,
    duct: active === "site" && !frameError ? readBox(s, "duct").box : null, envelope: null, boxToDrawing: toDrawing,
    context, affectedIds: s.changeRequest?.affectedEntityIds ?? [], cuts, calloutsFor, selectedPiece: piece, highlightedIds: selectedIds,
    onSelectPiece: onDrawingSelect, onSelectRoute: (id: string) => { setPreview(id); selectPiece(null); }, tool: "select" as const };
  return <>
    {header}
    <div className="wf-context"><div><strong>{s.title}</strong>{piece && <Badge tone="blue">{labelFor(workCallouts, piece)}</Badge>}{hasSampleData(s) && <Badge tone="sample">{tr("サンプル")}</Badge>}</div>
      <div>{active === "codes" ? <Button onClick={() => switchWorkflow(returnTo)}><Icon name="drawing" size={16} />{tr("図面に戻る")}</Button> : <><Button variant="quiet" onClick={() => setSetupOpen(true)}><Icon name="settings" size={16} />{tr("図面・入力設定")}</Button></>}</div></div>
    {pkg.detail?.state?.latestRun?.id === s.run?.id && pkg.detail?.state?.latestRun?.explanation && <details className="fa-toast"><summary>{tr("Work explanation")}{!pkg.detail.current ? tr(" (earlier inputs)") : ""}</summary><p style={{ whiteSpace: "pre-wrap" }}>{pkg.detail.state.latestRun.explanation}</p></details>}
    <RunBanner s={s} busy={pkg.busy} onCancel={() => s.run && void pkg.act("cancel", cur => api.cancel(cur.id, s.run!.id))} />
    {pkg.error && <div className="fa-toast tone-red" role="alert">{pkg.error}<Button variant="quiet" onClick={pkg.clearError}>{tr("閉じる")}</Button></div>}
    {pkg.notice && <div className="fa-toast tone-blue" role="status">{pkg.notice}<Button variant="quiet" onClick={() => pkg.setNotice("")}>{tr("閉じる")}</Button></div>}
    <div className={`wf-workspace wf-${active === "codes" ? returnTo : active}`} hidden={active === "codes"}>
      <main className="wf-drawing">
        <div className="wf-drawing-toolbar"><div className="fa-seg" aria-label={tr("図面表示")}>{([['drawing','元図面'],['plan','配管モデル']] as const).map(([key,label]) => <button key={key} className={view === key ? 'is-on' : ''} aria-pressed={view === key} onClick={() => setView(key)} disabled={key === 'drawing' && !d}>{tr(label)}</button>)}</div>
          {active === "site" && <div className="fa-seg" aria-label={tr("変更の比較")}>{([['original','元の配管'],['overlay','重ね合わせ'],['proposal','変更案']] as const).map(([key,label]) => <button key={key} className={comparison === key ? 'is-on' : ''} aria-pressed={comparison === key} onClick={() => setComparison(key)}>{tr(label)}</button>)}</div>}
          {active === "site" && <Button onClick={() => setSiteOpen(!siteOpen)} aria-expanded={siteOpen}>{tr("現況を入力")}</Button>}
        </div>
        <div className="wf-canvas-stage">
          <SiteShapeEditor {...common} enabled={active === "site" && mode === "adapt" && !!baseline && (view !== "drawing" || mapped)} interactionKey={`${active}/${intake.tool}/${setupOpen}`} drawingBlocked={view === "drawing" && (!intake.savedTransform || intake.viewDirty || intake.traceDirty)}>{shapeOverlay => d && view === "drawing" ? <SheetView shapeOverlay={shapeOverlay} s={s} intake={intake} readOnly={!setupOpen && intake.tool === "pan"} displayPlan={mapped ? drawingPlan : null} comparisonPlan={mapped && active === "site" && comparison === "overlay" && drawingPlan?.id !== baseline?.id ? baseline : null} selectedIds={selectedIds} context={context} onSelectPiece={onDrawingSelect} callouts={displayCallouts} /> :
            <PlanCanvas {...canvasProps} shapeOverlay={shapeOverlay} hideOriginal={active === "site" && comparison === "proposal"} empty={<div className="fa-empty big"><Icon name="drawing" size={34} /><h2>{tr("図面から作業を始める")}</h2><p>{tr("元図面と対象区間を登録してください。")}</p><div className="fa-actions center"><Button variant="primary" onClick={() => setSetupOpen(true)}>{tr("図面を登録")}</Button><Button disabled={disabled} busy={pkg.busy === "sample"} onClick={() => void loadSample()}>{tr("サンプルで試す")}</Button></div></div>} />}</SiteShapeEditor>
          {showSourceOnly && baseline && <div className="wf-map-note">{tr("この図面とモデルの位置合わせは未設定です。")}<button className="fa-link" onClick={() => setView("plan")}>{tr("配管モデルで対応箇所を見る")}</button></div>}
          {active === "materials" && mode === "adapt" && view === "plan" && !materialCurrent && (materialRoute || selectedId) && <div className="wf-map-note">{tr("Preview uses older inputs. Regenerate before using it.")}</div>}
          {<section hidden={active !== "site" || !siteOpen} className="wf-site-popover" aria-label={tr("この場所の現況")}><header><div><small>{tr("現場で確認したこと")}</small><h2>{tr("この場所の現況")}</h2></div><Button variant="quiet" aria-label={tr("現況入力を閉じる")} onClick={() => setSiteOpen(false)}><Icon name="x" /></Button></header>
            {mode === "prepare" ? <><p>{tr("元図面と入力を引き継いで、現場変更の作業を作成します。")}</p><Button variant="primary" disabled={disabled || !baseline || !d} busy={pkg.busy === "copy-site"} onClick={() => void startSite()}>{tr("この図面から現場変更を始める")}</Button></> : <><ChangeInputs {...common} callouts={baseCallouts} selectedPiece={piece} /><EvidenceInputs {...common} /><details><summary>{tr("障害物・作業範囲の実測値")}</summary><SiteFrameInputs {...common} callouts={baseCallouts} /><SiteViews s={s} /><SiteBoxInputs {...common} prefix="duct" title={tr("障害物")} help={tr(siteFrameOf(s) ? "Faces of the duct box along the pinned span." : "Faces of the duct box in the plan frame.")} /><SiteBoxInputs {...common} prefix="workEnvelope" title={tr("作業範囲")} help={tr("Where new pipe may go, in the same frame.")} /><SiteLengthInput {...common} field="requiredPipeClearance" label={tr("Required surface clearance, pipe to obstacle")} tag={tr("Test parameter")} help={tr("A parameter for this test, not a regulation. The planner keeps the pipe’s outside surface at least this far from the obstacle box.")} /></details></>}
          </section>}
        </div>
        {selectedIds.length > 0 && <div className="wf-drawing-caption"><button className="fa-link" onClick={() => selectPiece(null)}>{tr("Clear selection ({count})", { count: selectedIds.length })}</button></div>}
      </main>
      <aside className="wf-results" aria-label={active === "site" ? tr("変更案") : tr("材料と組立")}>
        <div className="wf-results-heading"><h1>{active === "site" ? siteHeading : tr("Materials & assembly")}</h1>{active === "site" && workResult && !current && <Freshness current={current} revision={s.inputRevision} resultRevision={workResult.inputRevision} />}</div>
        <div className={`wf-results-scroll ${active === "materials" ? "wf-materials-scroll" : ""}`}>
        {active === "materials" ? <>

          <MaterialsCuts result={materialResult} current={materialCurrent} revision={s.inputRevision} plan={materialPlan} callouts={materialCallouts} detail={detailFor(materialPlan?.id)} selectedPiece={piece} onSelectPiece={selectPiece} sources={materialSources} label={materialLabel} selectedMaterial={group} onSelectMaterial={id => { setGroup(id); setPiece(null); if (!mapped) setView("plan"); }} context={(baseline?.entities ?? []).filter(e => context.has(e.id)).map(e => ({ id: e.id, kind: e.kind, label: sourceLabel(s, e.id) }))} projected={!!s.sourceDrawing?.view && baseline?.coordinateFrame.id === FRAME_ID} />
          {materialResult && materialPlan && <Section title={tr("組立手順")} defaultOpen={false}><Assembly result={materialResult} callouts={materialCallouts} sources={materialSources} selectedPiece={piece} onSelectPiece={selectPiece} /></Section>}
        </> : <>
          <SiteEvidence s={s} pkg={pkg} />
          {s.baselinePlan && <><SiteMeasurements s={s} pkg={pkg} /><SiteSection s={s} /></>}
          {s.selectedPlan && <DesignerReviews s={s} pkg={pkg} />}
          {!s.changeRequest && <div className="wf-start-site"><Icon name="drawing" size={30} /><h2>{tr("図面と違うところを教えてください")}</h2><p>{tr("配管の位置を選び、写真・説明・実測値を入力すると変更案を検討できます。")}</p><Button variant="primary" onClick={() => setSiteOpen(true)}>{tr("現況を入力")}</Button></div>}
          {s.changeRequest && <section className="wf-observation"><small>{tr("Site report")}</small><p>{s.changeRequest.description}</p><Button variant="quiet" onClick={() => setSiteOpen(true)}>{tr("現況を追記")}</Button></section>}
          {focus && <section className="wf-proposal-summary">
            <div className="wf-route-tabs" aria-label={tr("変更案を比較")}>{routes.map(r => <button key={r.plan.id} aria-pressed={focusId === r.plan.id} onClick={() => { setPreview(r.plan.id); selectPiece(null); if (!mapped) setView("plan"); }}>{tr("案")}{" "}{r.letter}{selectedId === r.plan.id ? tr(" · 選択済み") : ""}</button>)}</div>

            <h2>{tr("部材の増減")}</h2><table className="fa-table"><thead><tr><th>{tr("項目")}</th><th className="num">{tr("元の配管との差")}</th></tr></thead><tbody>
              <tr><td>{tr("継手")}</td><td className="num">{focus.fittings - (baseline?.entities.filter(e => e.kind === "fitting").length ?? 0) >= 0 ? "+" : ""}{focus.fittings - (baseline?.entities.filter(e => e.kind === "fitting").length ?? 0)}</td></tr>
              <tr><td>{tr("配管延長（中心線）")}</td><td className="num">{focus.centerlineDeltaM === null ? tr("未確定") : metresText(focus.centerlineDeltaM, true).primary}</td></tr>
            </tbody></table>

          </section>}
          {(focus || s.outputs.candidates) && <Section title={tr("Proposal details & sources")} defaultOpen={false}>
          {routes.length > 0 || s.outputs.candidates ? <Section title={tr("候補の比較・生成条件")} defaultOpen={false}><RouteComparison routes={routes} baseline={baseline} baselineResult={base.result} focusId={focusId} selectedId={selectedId} current={candidatesCurrent} appliedAt={selectedId && selectedResult.current ? s.inputRevision : null} rejected={s.outputs.candidates?.rejected ?? []} searchDescription={s.outputs.candidates?.searchDescription ?? null} hasGeneration={!!s.outputs.candidates} noneReason={candidatesCurrent && s.outputs.candidates && !routes.length ? [...s.outputs.candidates.gaps.map(g => g.reason), ...s.outputs.candidates.rejected.map(r => r.reason)].filter((v,i,a) => a.indexOf(v) === i).join(" ") || null : null} onPreview={id => { setPreview(id); selectPiece(null); }} onRegenerate={() => void regenerate()} onShowPackage={() => switchWorkflow("materials")} busy={disabled} clearanceMissing={!geometryFactUsable(findFact(s,"requiredPipeClearance"))} syntheticGeometry={[...s.detailing, ...s.siteFacts].some(f => /^(adaptationFrame\.|duct\.|workEnvelope\.|requiredPipeClearance$)/.test(f.field) && isSyntheticPackageFact(f))} sources={sources} /></Section> : s.changeRequest && <Callout tone="neutral" title={tr("変更案はまだ生成されていません")}>{tr("現況と必要な寸法をそろえて、変更案を生成してください。")}</Callout>}
          {selectedId && focusId === selectedId && detailCurrent && <PackageDelta detail={detailFor(selectedId)} callouts={workCallouts} baselineResult={base.result} />}
          {sourceRefs.length > 0 && <section className="wf-sources"><h2>{tr("参照した根拠")}</h2><SourceLinks refs={sourceRefs} sources={sources} /></section>}
          </Section>}
          {frameError && <Callout title={tr("対象区間を確認してください")}>{frameError}</Callout>}
        </>}
        {openRequests.map(r => <RequestCallout key={r.id} s={s} request={r} act={pkg.act} busy={pkg.busy} onGoToInputs={() => active === "site" ? setSiteOpen(true) : setSetupOpen(true)} />)}
        {reviewResult && <Button variant="quiet" className="wf-review-link" onClick={() => setChecksOpen(true)}>{missingReasons.length ? tr("Unconfirmed conditions ({count})", { count: missingReasons.length }) : tr("確認結果・不足情報を見る")}</Button>}
        </div>
        <div className="wf-results-footer">
          {active === "site" && blockers.length > 0 && <p className="fa-muted small">{tr(blockers[0])}</p>}
          {!workResult && active === "materials" && <p className="fa-muted small">{tr(blockers[0] ?? "入力から部材と組立情報を生成できます。")}</p>}
          {active === "materials" && mode === "prepare" && hasSampleData(s) && <div className="wf-sample-review"><strong>架空条件での試算</strong><p>図面・寸法・施工条件はデモ用の仮定です。入力を確認してから暫定計算を実行できます。未確認の切断長や施工条件は未確定のまま残ります。</p><label><input type="checkbox" checked={sampleReviewed} onChange={e => setSampleReview(e.target.checked ? { id: s.id, revision: s.inputRevision } : null)} />架空の入力であることを確認した</label></div>}
          {active === "materials" && mode === "prepare" && ((!base.result || !base.current) || (hasSampleData(s) && !base.result?.evaluations.length)) && <Button variant="primary" disabled={disabled || blockers.length > 0 || (hasSampleData(s) && !sampleReviewed)} busy={pkg.busy === "run"} onClick={() => void start("prepare_from_drawing")}>{base.result && base.current ? "暫定検証を再実行" : tr("部材・組立を生成")}</Button>}
          {active === "site" && mode === "adapt" && <div className="wf-proposal-actions">{selectedId && !selectedResult.current && !candidatesCurrent && <Button variant="primary" disabled={disabled || blockers.length > 0} busy={pkg.busy === "run"} onClick={() => void start("adapt_to_site")}>{tr("Retry selected route")}</Button>}{focus && candidatesCurrent ? <><Button variant="primary" disabled={disabled || focus.centerlineDeltaM === null} busy={pkg.busy === "select"} onClick={() => void choose(focus.plan.id)}>{tr(selectedId === focus.plan.id ? "Rebuild selected Route {route}" : "Select & build Route {route}", { route: focus.letter })}</Button><Button variant="quiet" disabled={disabled || blockers.length > 0} busy={pkg.busy === "run"} onClick={() => void regenerate()}>{tr("Regenerate routes")}</Button></> : <Button variant={selectedId && !selectedResult.current ? "quiet" : "primary"} disabled={disabled || blockers.length > 0} busy={pkg.busy === "run"} onClick={() => void regenerate()}>{routes.length ? tr("Regenerate routes") : tr("変更案を生成")}</Button>}{selectedId && <Button variant="quiet" disabled={disabled} onClick={() => baseline && void pkg.act("clear",cur=>api.select(cur.id,cur.inputRevision,baseline.id))}>{tr("選択を解除")}</Button>}</div>}

        </div>
      </aside>
    </div>
    {codesVisited && <div className="wf-codes" hidden={active !== "codes"}><AskPanel embedded onClose={() => switchWorkflow(returnTo)} /></div>}
    {setupOpen && <div hidden={active === "codes"} className="wf-settings-backdrop"><section className="wf-settings" role="dialog" aria-label={tr("図面・入力設定")}><header><h2>{tr("図面・入力設定")}</h2><Button onClick={() => setSetupOpen(false)}>{tr("閉じる")}</Button></header><div className="wf-settings-body"><label className="fa-field"><span>{tr("入力単位")}</span><select value={unit} onChange={e=>setUnit(e.target.value as Unit)}><option value="mm">{tr("mm")}</option><option value="in">{tr("ft-in")}</option></select></label><MissingList reqs={reqs} />{sourceInputs}{!baseline && <Button disabled={disabled} onClick={() => void loadSample()}>{tr("サンプル入力を読み込む")}</Button>}</div>{intake.tool !== "pan" && <div className="wf-tool-handoff"><small>{tr("A drawing tool is selected. Continue on the drawing.")}</small><Button variant="primary" onClick={() => { setSetupOpen(false); setView("drawing"); }}>{tr("Use selected tool on drawing")}</Button></div>}</section></div>}
    {checksOpen && <div className="wf-settings-backdrop"><section className="wf-settings" role="dialog" aria-label={tr("確認結果")}><header><h2>{tr("確認結果・不足情報")}</h2><Button onClick={() => setChecksOpen(false)}>{tr("閉じる")}</Button></header><div className="wf-settings-body">{missingReasons.length ? <Section title={tr("未確認の条件があります")}><ul className="fa-list">{missingReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></Section> : null}<Checks result={active === "materials" ? materialResult : workResult} sources={active === "materials" ? materialSources : sources} callouts={active === "materials" ? materialCallouts : workCallouts} /></div></section></div>}
    {exportOpen && <ExportDialog s={s} artifacts={s.outputs.artifacts.filter(a=>s.freshness.artifacts.find(f=>f.id===a.id)?.current)} ready={mode === "prepare" ? !!base.result && base.current : !!selectedId && selectedResult.current} busy={pkg.busy} running={running} onCreate={() => void start("export_selected_package","export")} onClose={() => setExportOpen(false)} />}
  </>;
}

function MissingList({ reqs }: { reqs: ReturnType<typeof requirements> }) {
  const open = reqs.filter(r => !r.done);
  if (!open.length) return <Callout tone="blue" title={tr("All inputs are entered")}>{tr("Generate to get current results. The server may still report items it cannot decide.")}</Callout>;
  const groups = [...new Set(open.map(r => r.group))];
  return <Callout title={tr("{count} inputs still needed", { count: open.length })}>
    <ul className="fa-missing">{groups.map(g => <li key={g}><b>{tr(g)}:</b> {open.filter(r => r.group === g).map(r => tr(r.label)).join("; ")}</li>)}</ul>
  </Callout>;
}

function RunBanner({ s, busy, onCancel }: { s: Snapshot; busy: string; onCancel: () => void }) {
  const run = s.run;
  if (!run) return null;
  const current = run.inputRevision === s.inputRevision;
  if (run.status === "running") return <div className="fa-runbar"><span className="fa-spinner" /><span><b>{tr(goalLabel(run.goal))}</b> {run.progress}</span><Button variant="quiet" busy={busy === "cancel"} onClick={onCancel}>{tr("Cancel")}</Button></div>;
  if (!current || run.status === "completed" || run.status === "waiting_input") return null;
  const tone = run.status === "blocked" ? "amber" : "red";
  const reason = run.stopReason === "runner_failed" ? "The server stopped without saying why (runner_failed). Check the inputs listed under Inputs, then try again." : run.stopReason ?? run.progress;
  return <div className={`fa-toast tone-${tone}`} role="status"><Icon name="alert" size={16} /><span><b>{tr(goalLabel(run.goal))} {run.status}.</b> {reason}</span></div>;
}
const goalLabel = (g: string) => g === "read_site_evidence" ? "Reading evidence" : g === "export_selected_package" ? "Export" : g === "adapt_to_site" ? "Route generation" : "Preparation";

function RequestCallout({ s, request, act, busy, onGoToInputs }: { s: Snapshot; request: Snapshot["outputs"]["requests"][number]; act: ReturnType<typeof usePackage>["act"]; busy: string; onGoToInputs: () => void }) {
  const [reason, setReason] = useState("");
  const key = `answer-${request.id}`;
  return <div className="fa-request">
    <Callout title={tr("The server needs an answer")} action={<Button variant="quiet" onClick={onGoToInputs}>{tr("Enter it in inputs")}</Button>}>
      <p>{request.question}</p>
      <div className="fa-fact-edit">
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder={tr("If you cannot provide it, say why")} aria-label={tr("Reason it is unavailable")} />
        <Button busy={busy === key} disabled={!!busy || !reason.trim()} onClick={() => void act(key, cur => api.answer(cur.id, cur.inputRevision, request.id, null, reason.trim()))}>{tr("Mark unavailable")}</Button>
      </div>
    </Callout>
    <span className="sr-only">{tr("Request for revision")}{" "}{s.inputRevision}</span>
  </div>;
}

const ARTIFACT_LABEL: Record<string, [string, string]> = { pdf: ["Work package PDF", "pdf"], bom_csv: ["Materials CSV", "csv"], cut_csv: ["Cut list CSV", "csv"], manifest: ["Manifest", "json"] };

function ExportDialog({ s, artifacts, ready, busy, running, onCreate, onClose }: { s: Snapshot; artifacts: Snapshot["outputs"]["artifacts"]; ready: boolean; busy: string; running: boolean; onCreate: () => void; onClose: () => void }) {
  const [downloading, setDownloading] = useState("");
  const [error, setError] = useState("");
  const pending = s.run?.status === "waiting_input" && s.run.inputRevision === s.inputRevision && s.run.configVersion === s.configVersion
    ? s.outputs.requests.filter(r => s.freshness.requests.some(f => f.id === r.id && f.current && !f.answered)) : [];
  const download = async (a: Snapshot["outputs"]["artifacts"][number]) => {
    setDownloading(a.id); setError("");
    try {
      const blob = await api.artifact(s.id, a.id);
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href; link.download = `${s.title.replace(/[^a-zA-Z0-9_-]+/g, "-")}-rev${a.inputRevision}-${a.kind}.${ARTIFACT_LABEL[a.kind]?.[1] ?? "bin"}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 5000);
    } catch (e) { setError(e instanceof Error ? e.message : "Download failed"); } finally { setDownloading(""); }
  };
  return <div className="fa-modal" role="dialog" aria-modal="true" aria-label={tr("Export")} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="fa-modal-card">
      <div className="fa-modal-head"><h2>{tr("Export")}</h2><button type="button" className="fa-icon-btn" onClick={onClose} aria-label={tr("Close")}><Icon name="x" /></button></div>
      <p className="fa-muted">{tr("Exports are bound to one input revision and the")}{" "}{s.intent === "adapt_to_site" ? tr("selected route") : tr("prepared run")}{tr(". They are made by the server's exporter (the same bundle as the export API).")}</p>
      {pending.length > 0 && <Callout title="未回答事項を含む確認用資料" action={<Button onClick={onClose}>{tr("Close to answer")}</Button>}>{pending.map(request => <p key={request.id}>{request.question}</p>)}<p>未確認事項は資料に残ります。出力しても承認済みにはなりません。</p></Callout>}
      {artifacts.length > 0 ? <ul className="fa-downloads">{artifacts.map(a => <li key={a.id}>
        <div><strong>{tr(ARTIFACT_LABEL[a.kind]?.[0] ?? a.kind)}</strong><small>{tr("Rev")}{" "}{a.inputRevision}</small></div>
        <Button busy={downloading === a.id} onClick={() => void download(a)}><Icon name="download" size={14} />{tr("Download")}</Button>
      </li>)}</ul> : !ready ? <Callout title={tr("Nothing to export yet")}>{s.intent === "adapt_to_site" ? tr("Choose a route and build the revised package first.") : tr("Generate current materials and cuts first.")}</Callout>
        : <Callout tone="neutral" title={tr("No export for rev {revision} yet", { revision: s.inputRevision })}>{tr("Create one to get the PDF, materials CSV and cut list CSV for these inputs.")}</Callout>}
      {error && <Callout tone="red" title={tr("Download failed")}>{error}</Callout>}
      <div className="fa-actions end">
        <Button onClick={onClose}>{tr("Close")}</Button>
        {ready && artifacts.length === 0 && <Button variant="primary" busy={busy === "export" || running} onClick={onCreate}>{tr("Create export for rev")}{" "}{s.inputRevision}</Button>}
      </div>
    </div>
  </div>;
}
