import { PlanEditor } from "./PlanEditor.js";
import { useEffect, useRef, useState } from "react";
import { ADOPTED_RULES, type RuleResult, type RuleStatus } from "@sprink/core";
import { read, taskPath, uploadObservation, write } from "./api.js";
import { FactsEditor } from "./FactsEditor.js";
import { RequestsPanel } from "./RequestsPanel.js";
import type { Action, Artifact, Observation, TaskSnapshot } from "./types.js";
import { AuthImage, Badge, Button, dateTime, Empty, fieldLabel, label, Section, type Tone } from "./ui.js";

const ruleLabels: Record<RuleStatus, string> = { pass: "採用条件に適合", fail: "採用条件に不適合", unknown: "必要情報が不足", not_applicable: "採用条件の適用外" };
const ruleTones: Record<RuleStatus, Tone> = { pass: "good", fail: "bad", unknown: "warning", not_applicable: "neutral" };
const scenarios = [
  { id: "normal", title: "通常の下向き取付け", note: "図面と一致し、採用した方向条件にも適合する例。" },
  { id: "nonconforming", title: "図面と違う上向き取付け", note: "図面の下向き指定との差異と、限定条件への不適合を分けて確認。" },
  { id: "matching_wrong", title: "図面と一致するが不適合", note: "上向きの図面に現物が一致しても、メーカー条件には不適合となる例。" },
  { id: "pressure_exceeded", title: "方向は適合、最高使用圧力は超過", note: "方向が図面・メーカー条件と一致しても、記録の最高使用圧力が採用上限を超える例。" },
  { id: "missing", title: "方向を確認できない", note: "初期画像では上下の基準が不足。追加写真を読み込んで続きを確認。" },
  { id: "other_model", title: "対象外の製品型式", note: "確認済みの別型式に、TY3231のルールを適用しない例。" },
  { id: "uninstalled", title: "取付け前の部品", note: "未取付けの部品に、取付け後の方向条件を適用しない例。" },
  { id: "obstacle", title: "周囲に障害物がある", note: "障害物の観測候補を記録。方向条件の判定から干渉や散水性能は判断しません。" },
];

function PhotoDialog({ observation, task, token, close }: { observation: Observation; task: TaskSnapshot; token: string; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="photo-dialog" onClose={close} onClick={event => { if (event.target === event.currentTarget) ref.current?.close(); }}><header><div><strong>観測画像</strong><p>{observation.id}</p></div><Button onClick={() => ref.current?.close()} autoFocus>閉じる ×</Button></header><AuthImage token={token} taskId={task.id} assetId={observation.assetId} alt={`対象${observation.targetId}の観測画像`} /><footer><Badge tone={observation.synthetic ? "warning" : "neutral"}>{observation.synthetic ? "合成画像・実写ではありません" : label(observation.source)}</Badge><span>{dateTime(observation.capturedAt)} · {observation.width} × {observation.height}</span></footer></dialog>;
}

function RuleCard({ result, ruleId }: { result?: RuleResult; ruleId: string }) {
  const definition = ADOPTED_RULES.find(rule => rule.id === ruleId);
  const title = result?.title ?? definition?.title ?? ruleId;
  const sources = result?.sourceRefs ?? definition?.sources ?? [];
  return <article className={`validation-card ${result?.status === "fail" ? "validation-card-fail" : ""}`}>
    <p className="eyebrow">MANUFACTURER CONDITION</p><h3>{title}</h3>
    {result ? <><Badge tone={ruleTones[result.status]}>{ruleLabels[result.status]}</Badge><p className="result-explanation">{result.reason}</p>{result.missingInputs.length > 0 && <div className="chip-row">{result.missingInputs.map((field, index) => <span className="field-chip" key={`${field}-${index}`}>{fieldLabel(field)}</span>)}</div>}</> : <p className="muted">再検証すると、適用条件と根拠を確認します。</p>}
    <details className="sub-details"><summary>適用範囲と根拠資料</summary><p className="validation-caption">{result?.scope ?? definition?.scope}</p><div className="source-list">{sources.map(source => <a key={`${source.document}-${source.page}-${source.purpose}`} href={`${source.url}#page=${source.page}`} target="_blank" rel="noreferrer"><span>{source.document} · {source.revision}<small>{source.purpose}</small></span><strong>p.{source.page} ↗</strong></a>)}</div><p className="muted">{ruleId}</p></details>
  </article>;
}

function ValidationPanel({ task, token, action, busy }: { task: TaskSnapshot; token: string; action: Action; busy: string }) {
  const current = task.validation?.taskRevision === task.revision && task.validation.planRevision === task.plan.revision;
  const report = current ? task.validation : null;
  const results = report ? report.rules ?? [report.rule] : [];
  return <Section eyebrow="INDEPENDENT CHECKS" title="図面比較と製品条件" action={<Button className="button-small" disabled={!!busy || task.state === "cancelled"} busy={busy === "検証を更新"} onClick={() => void action("検証を更新", () => write(token, taskPath(task.id, "/validate")))}>再検証</Button>}>
    <p className="section-intro">図面に一致することと、採用した{ADOPTED_RULES.length}項目のメーカー条件を満たすことは、それぞれ判定します。</p>
    <div className="validation-grid">
      <article className="validation-card"><p className="eyebrow">DRAWING</p><h3>図面との方向比較</h3>{report ? <><Badge tone={report.comparison.status === "match" ? "good" : report.comparison.status === "different" ? "warning" : "neutral"}>{report.comparison.status === "match" ? "図面と一致" : report.comparison.status === "different" ? "図面と差異あり" : "比較できる情報が不足"}</Badge><dl className="comparison-values"><div><dt>図面の指定</dt><dd>{label(report.comparison.planned)}</dd></div><span aria-hidden="true">→</span><div><dt>観測した方向</dt><dd>{label(report.comparison.observed)}</dd></div></dl>{report.comparison.missingInputs.length > 0 && <p className="muted">不足：{report.comparison.missingInputs.map(fieldLabel).join("、")}</p>}</> : <p className="muted">最新の検証結果がありません。</p>}<p className="validation-caption">図面との比較結果です。製品条件への適合を意味しません。</p></article>
      {report ? results.map(result => <RuleCard key={result.ruleId} ruleId={result.ruleId} result={result} />) : ADOPTED_RULES.map(rule => <RuleCard key={rule.id} ruleId={rule.id} />)}
    </div>
    <div className="scope-note"><strong>この検証の範囲</strong><p>TYCO TFP171から採用した製品条件を個別に判定します。NFPA全体への適合、散水障害、配置寸法、水理計算、設備全体の施工可否は判定しません。</p></div>
    {report && <p className="muted">仕事 v{report.taskRevision} / 図面 v{report.planRevision} · {dateTime(report.checkedAt)}</p>}
  </Section>;
}

function ArtifactPanel({ task, token, action, busy }: { task: TaskSnapshot; token: string; action: Action; busy: string }) {
  const artifact = task.artifact?.taskRevision === task.revision && task.artifact.planRevision === task.plan.revision ? task.artifact : null;
  async function download() {
    const data = await read<Artifact>(token, taskPath(task.id, "/artifact"));
    const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = objectUrl; link.download = `field-report-${task.id}-v${data.taskRevision}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
  return <Section eyebrow="HANDOFF" title="変更検討・確認資料" action={<Button className="button-primary button-small" disabled={!!busy || task.state === "cancelled" || !task.observations.length} busy={busy === "確認資料を作成"} onClick={() => void action("確認資料を作成", () => write(token, taskPath(task.id, "/artifact")))}>{artifact ? "資料を作り直す" : "確認資料を作成"}</Button>}>
    {artifact ? <div className="artifact-content"><div className="artifact-head"><div className="document-icon" aria-hidden="true">≡</div><div><h3>{artifact.title}</h3><p className="muted">{dateTime(artifact.createdAt)} · 仕事 v{artifact.taskRevision} / 図面 v{artifact.planRevision}</p></div><Badge tone="good">資料作成済み</Badge></div>{artifact.synthetic && <p className="synthetic-note">合成画像・合成の確認データを含む資料です。実物の検証結果ではありません。</p>}<div className="artifact-stats"><span><b>{artifact.observations.length}</b>観測</span><span><b>{artifact.measurements.length}</b>計測記録</span><span><b>{artifact.findings?.length ?? 0}</b>現場の候補</span></div><div className="validation-grid">{(artifact.validation.rules ?? [artifact.validation.rule]).map(result => <RuleCard key={result.ruleId} ruleId={result.ruleId} result={result} />)}</div>{artifact.unresolved.length > 0 ? <div className="unresolved-box"><strong>残っている問題・確認事項</strong><ul>{artifact.unresolved.map((item, index) => <li key={`${item}-${index}`}>{fieldLabel(item)}</li>)}</ul></div> : <p className="muted">採用した確認項目に、未解決事項の記録はありません。</p>}<p className="scope-text">{artifact.scope}</p><div className="button-row"><Button className="button-small" disabled={!!busy} onClick={() => void action("資料をダウンロード", download)}>資料をダウンロード ↓</Button></div></div> : <Empty title="現行版の確認資料はまだありません">追加依頼の回答と根拠をそろえて作成します。不適合や取得不能の項目は、資料に残ります。</Empty>}
    <p className="panel-footnote">観測・図面の更新後は、以前の資料を現行版として使用できません。「資料作成済み」は施工可能の判定ではありません。</p>
  </Section>;
}

export function TaskDetail({ task, token, action, busy }: { task: TaskSnapshot; token: string; action: Action; busy: string }) {
  const [tab, setTab] = useState("overview");
  const [scenario, setScenario] = useState("normal");
  const [photo, setPhoto] = useState<Observation | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const disabled = !!busy || task.state === "cancelled";
  const synthetic = task.observations.some(observation => observation.synthetic);
  const openRequests = task.requests.filter(request => request.status === "open").length;

  return <>
    <header className="task-header"><div><p className="eyebrow">FIELD WORK / {task.targetId}</p><h1>{task.title}</h1><div className="task-meta"><Badge tone={task.state === "waiting" ? "warning" : task.state === "review_ready" ? "good" : "neutral"}>{label(task.state)}</Badge>{synthetic && <Badge tone="warning">合成データを含む</Badge>}<span>仕事 v{task.revision} · {dateTime(task.updatedAt)}更新</span></div></div><Button className="button-quiet button-small" disabled={disabled} onClick={() => void action("仕事を中止", () => write(token, taskPath(task.id, "/cancel")))}>仕事を中止</Button></header>
    <nav className="tabs" aria-label="仕事の表示"><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>現場と図面</button><button className={tab === "facts" ? "active" : ""} onClick={() => setTab("facts")}>観測の確認</button><button className={tab === "requests" ? "active" : ""} onClick={() => setTab("requests")}>追加情報 {openRequests > 0 && <span>{openRequests}</span>}</button><button className={tab === "report" ? "active" : ""} onClick={() => setTab("report")}>検証と資料</button></nav>
    {tab === "overview" && <div className="page-stack">
      <PlanEditor task={task} token={token} action={action} busy={busy} />
      <div className="overview-grid">
      <Section eyebrow="OBSERVATIONS" title="現場からの観測" action={<div className="button-row"><Badge>{task.observations.length}件</Badge><Button className="button-small" disabled={disabled} busy={busy === "写真を保存"} onClick={() => uploadInput.current?.click()}>写真を追加 ＋</Button></div>}><input ref={uploadInput} className="visually-hidden" type="file" accept="image/*" capture="environment" aria-label="観測画像を選択または撮影" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void action("写真を保存", () => uploadObservation(token, task.id, task.targetId, file)); }} />{task.observations.length ? <div className="photo-grid">{task.observations.map((observation, index) => <figure key={observation.id} className={observation.superseded ? "photo-superseded" : ""}><div className="photo-display"><AuthImage token={token} taskId={task.id} assetId={observation.assetId} alt={`観測${index + 1}、${observation.synthetic ? "合成" : "現場"}の画像`} /><button className="photo-zoom" type="button" onClick={() => setPhoto(observation)} aria-label={`観測${index + 1}を拡大`}>拡大 ↗</button></div><figcaption><div><strong>観測 {index + 1}</strong><Badge tone={observation.synthetic ? "warning" : "neutral"}>{observation.superseded ? "失効" : observation.synthetic ? "合成" : "撮影"}</Badge></div><span>{dateTime(observation.capturedAt)} · {observation.targetId}</span></figcaption></figure>)}</div> : <Empty title="現場の観測を待っています">「写真を追加」から画像を選択してください。下の合成リプレイでも流れを確認できます。</Empty>}<p className="panel-footnote">写真と確認済みの情報を使って検証を進めます。</p></Section></div>
      {(task.findings?.length ?? 0) > 0 && <Section eyebrow="FIELD FINDINGS" title="現場の差異・気になる箇所"><div className="findings-list">{task.findings.map(finding => <article key={finding.id}><Badge tone="warning">未確認の候補</Badge><p>{finding.description}</p><small className="muted">対象 {finding.targetId} · 根拠 {finding.evidenceIds.length}件</small></article>)}</div><p className="panel-footnote">この欄の観測候補は、取付方向の限定ルールとは別です。障害物の存在から、干渉や散水障害が確定したとは扱いません。</p></Section>}
      {task.measurements.length > 0 && <Section eyebrow="MEASUREMENTS" title="保存された計測"><div className="measurement-list">{task.measurements.map((measurement, index) => { const validation = task.validation?.measurements[index]; return <article key={measurement.id}><div><strong>{measurement.id}</strong><p>{measurement.method === "ar_raycast" ? "ARによる概測" : measurement.method === "fixture" ? "合成座標の計算" : "人が入力した計測"}</p></div><strong className="measurement-value">{validation?.valueMeters != null ? `${validation.valueMeters.toFixed(3)} m` : "未確定"}</strong><Badge tone={validation?.qualityRecorded ? "neutral" : "warning"}>{validation?.qualityRecorded ? "記録あり・精度未評価" : "取得情報が不足"}</Badge></article>; })}</div><p className="panel-footnote">追跡状態や座標の整合を確認しても、物理的な精度・測定点の正しさは保証されません。</p></Section>}
      <Section eyebrow="SYNTHETIC REPLAY" title="合成データで流れを確認"><p className="section-intro">実写・実機の評価ではなく、既知の入力による処理の確認です。ケースごとに新しい仕事を作ると比較しやすくなります。</p><div className="replay-controls"><label className="form-field"><span>確認するケース</span><select value={scenario} onChange={event => setScenario(event.target.value)} disabled={disabled}>{scenarios.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><div className="button-row"><Button disabled={disabled} busy={busy === "合成リプレイを読み込み"} onClick={() => void action("合成リプレイを読み込み", () => write(token, taskPath(task.id, "/replay"), { scenario, phase: "initial" }))}>初期状態を読み込む</Button><Button disabled={disabled} onClick={() => void action("追加写真を読み込み", () => write(token, taskPath(task.id, "/replay"), { scenario, phase: "answer" }))}>追加写真で回答</Button></div></div><p className="replay-note">{scenarios.find(item => item.id === scenario)?.note}</p></Section>
    </div>}
    {tab === "facts" && <FactsEditor task={task} token={token} action={action} busy={busy} />}
    {tab === "requests" && <RequestsPanel task={task} token={token} action={action} busy={busy} />}
    {tab === "report" && <div className="page-stack"><ValidationPanel task={task} token={token} action={action} busy={busy} /><ArtifactPanel task={task} token={token} action={action} busy={busy} /></div>}
    {photo && <PhotoDialog observation={photo} task={task} token={token} close={() => setPhoto(null)} />}
  </>;
}
