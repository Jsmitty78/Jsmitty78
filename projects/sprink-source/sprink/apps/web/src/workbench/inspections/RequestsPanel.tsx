import { useState } from "react";
import { taskPath, write } from "./api.js";
import type { Action, EvidenceRequest, TaskSnapshot } from "./types.js";
import { Badge, Button, Empty, fieldLabel, label, Section } from "./ui.js";

const requestFields = ["model", "installation", "mounting", "orientation", "verticalReference"];

function RequestAnswer({ request, task, token, action, busy }: { request: EvidenceRequest; task: TaskSnapshot; token: string; action: Action; busy: string }) {
  const [observationIds, setObservationIds] = useState<string[]>([]);
  const [measurementIds, setMeasurementIds] = useState<string[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [reason, setReason] = useState("");
  const observations = task.observations.filter(o => !o.superseded && o.targetId === request.targetId);
  const measurements = task.measurements.filter(m => m.targetId === request.targetId);
  const canSubmit = unavailable ? !!reason.trim() : request.kind === "measurement" ? measurementIds.length > 0 : observationIds.length + measurementIds.length > 0;
  const stale = request.planRevision !== task.plan.revision;
  function toggle(id: string, checked: boolean, setter: React.Dispatch<React.SetStateAction<string[]>>) { setter(ids => checked ? [...ids, id] : ids.filter(item => item !== id)); }

  return <div className="request-answer">
    <label className="check-line"><input type="checkbox" checked={unavailable} onChange={event => setUnavailable(event.target.checked)} disabled={!!busy} /><span>現時点では取得できない</span></label>
    {unavailable ? <label className="form-field"><span>取得できない理由</span><textarea rows={2} value={reason} onChange={event => setReason(event.target.value)} placeholder="例：裏側が隠れており、現在の位置からは撮影できない" /></label> : <div className="answer-evidence">
      <div><p className="field-caption">回答に使う保存済みの観測</p>{observations.length ? observations.map((observation, index) => <label className="check-line" key={observation.id}><input type="checkbox" checked={observationIds.includes(observation.id)} disabled={!!busy} onChange={event => toggle(observation.id, event.target.checked, setObservationIds)} /><span>観測 {index + 1} {observation.synthetic && <span className="inline-tag">合成</span>}<small>{observation.id}</small></span></label>) : <p className="muted">iPhoneから写真を追加するか、合成リプレイの追加写真を読み込んでください。</p>}</div>
      {(request.kind === "measurement" || measurements.length > 0) && <div><p className="field-caption">回答に使う計測</p>{measurements.length ? measurements.map(measurement => <label className="check-line" key={measurement.id}><input type="checkbox" checked={measurementIds.includes(measurement.id)} disabled={!!busy} onChange={event => toggle(measurement.id, event.target.checked, setMeasurementIds)} /><span>{measurement.id}<small>{measurement.method === "ar_raycast" ? "AR概測 · 精度未評価" : measurement.method === "fixture" ? "合成座標" : "実測入力"}</small></span></label>) : <p className="muted">計測はまだ保存されていません。</p>}</div>}
    </div>}
    {stale && <p className="text-warning">古い図面版の依頼です。現行版の依頼を使用してください。</p>}
    <Button className="button-primary button-small" disabled={!!busy || !canSubmit || stale || task.state === "cancelled"} onClick={() => void action("追加依頼に回答", () => write(token, taskPath(task.id, "/answers"), { id: crypto.randomUUID(), requestId: request.id, observationIds: unavailable ? [] : observationIds, measurementIds: unavailable ? [] : measurementIds, ...(unavailable ? { unavailableReason: reason.trim() } : {}) }))}>この内容で回答</Button>
  </div>;
}

export function RequestsPanel({ task, token, action, busy }: { task: TaskSnapshot; token: string; action: Action; busy: string }) {
  const [kind, setKind] = useState<EvidenceRequest["kind"]>("capture");
  const [reason, setReason] = useState("");
  const [fields, setFields] = useState(["orientation", "verticalReference"]);
  const open = task.requests.filter(r => r.status === "open");
  const closed = task.requests.filter(r => r.status !== "open");
  return <Section eyebrow="NEXT OBSERVATION" title="追加情報のやりとり" action={<Badge tone={open.length ? "warning" : "neutral"}>{open.length}件の回答待ち</Badge>}>
    {open.length ? <div className="request-list">{open.map(request => <article className="request-card" key={request.id}><header><Badge tone="warning">{label(request.kind)}</Badge><span className="muted">図面 v{request.planRevision} · {request.targetId}</span></header><h3>{request.reason}</h3><div className="chip-row">{request.fields.map(field => <span className="field-chip" key={field}>{fieldLabel(field)}</span>)}</div><RequestAnswer request={request} task={task} token={token} action={action} busy={busy} /></article>)}</div> : <Empty title="回答待ちの依頼はありません">エージェントは、仕事に必要な写真・実測・確認が不足すると、ここへ依頼を残します。</Empty>}
    <details className="sub-details"><summary>確認したいことを追加する</summary><form className="request-form" onSubmit={event => { event.preventDefault(); void action("追加依頼を保存", () => write(token, taskPath(task.id, "/requests"), { kind, reason: reason.trim(), fields }), () => setReason("")); }}>
      <label className="form-field"><span>依頼の種類</span><select value={kind} onChange={event => setKind(event.target.value as EvidenceRequest["kind"])}>{["capture", "measurement", "confirmation"].map(value => <option value={value} key={value}>{label(value)}</option>)}</select></label>
      <label className="form-field"><span>必要な情報と、その理由</span><textarea required value={reason} rows={2} onChange={event => setReason(event.target.value)} placeholder="ヘッドの向きと重力方向が同時に分かる写真を追加してください" /></label>
      <fieldset><legend>確認する項目</legend><div className="check-grid">{requestFields.map(field => <label className="check-line" key={field}><input type="checkbox" checked={fields.includes(field)} onChange={event => setFields(values => event.target.checked ? [...values, field] : values.filter(value => value !== field))} /><span>{fieldLabel(field)}</span></label>)}</div></fieldset>
      <Button className="button-primary button-small" type="submit" disabled={!!busy || !reason.trim() || !fields.length || task.state === "cancelled"}>依頼を保存</Button>
    </form></details>
    {closed.length > 0 && <details className="sub-details"><summary>回答・依頼履歴 <span>{closed.length}件</span></summary><div className="request-history">{[...closed].reverse().map(request => <article key={request.id}><Badge>{label(request.status)}</Badge><p>{request.reason}</p>{request.answer?.unavailableReason && <p className="text-warning">取得不能：{request.answer.unavailableReason}</p>}{request.answer && <small className="muted">観測 {request.answer.observationIds.length}件 · 計測 {request.answer.measurementIds.length}件</small>}</article>)}</div></details>}
  </Section>;
}
