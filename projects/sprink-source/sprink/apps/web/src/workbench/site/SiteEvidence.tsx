import { useEffect, useState } from 'react';
import { measurementFields, reviewTopics, type ReadingItem } from '@sprink/core';
import { api, type Snapshot } from '../api.js';
import type { PackageState } from '../usePackage.js';
import { Button, Section } from '../ui.js';
import { PRODUCT_SETS } from '../products.js';
import './site-evidence.css';

const names: Record<string, string> = {
  'span.length': '対象配管の長さ', pipeElevation: '配管の高さ', requiredPipeClearance: '必要な離隔',
  fittingEnvelopeRadius: '継手外形の包絡半径', assemblyEnvelopeRadius: '工具・組付け空間の包絡半径',
};
export const measurementLabel = (field: string) => names[field] ?? field.replace('duct.', 'ダクト ').replace('workEnvelope.', '作業範囲 ').replace('min.', '最小 ').replace('max.', '最大 ');
export function SiteEvidence({ s, pkg }: { s: Snapshot; pkg: PackageState }) {
  const work = s.siteWork;
  const [selected, setSelected] = useState(''), [role, setRole] = useState<'drawing'|'site'>('drawing'), [page, setPage] = useState(1), [synthetic, setSynthetic] = useState(false);
  const [instruction, setInstruction] = useState('変更する直線配管一区間と両端、周辺ヘッド、ダクト、明記された寸法を読み取ってください。寸法を推測しないでください。');
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 1, height: 1 });
  const [image, setImage] = useState(''), [reviewer, setReviewer] = useState(''), [length, setLength] = useState(''), [elevation, setElevation] = useState(''), [products, setProducts] = useState('none');
  const [frameSynthetic,setFrameSynthetic]=useState(false);
  const evidence = work?.evidence.find(e => e.id === selected) ?? work?.evidence.at(-1);
  const reading = work?.readings.filter(r => r.evidenceId === evidence?.id).at(-1);
  const [items, setItems] = useState<ReadingItem[]>([]), [accepted, setAccepted] = useState<string[]>([]), [activeItem, setActiveItem] = useState('');
  useEffect(() => {
    setItems(reading?.items ?? []); setAccepted(reading?.items.map(i => i.id) ?? []);
    const dim = reading?.items.find(i => i.field === 'span.length');
    if (dim?.value != null && dim.unit) setLength(String(dim.value * {mm:1,m:1000,in:25.4,ft:304.8}[dim.unit]));
    const z = reading?.items.find(i => i.field === 'pipeElevation');
    if (z?.value != null && z.unit) setElevation(String(z.value * {mm:1,m:1000,in:25.4,ft:304.8}[z.unit]));
  }, [reading?.id]);
  useEffect(() => { let alive = true, url = ''; setImage(''); if(evidence) void api.asset(s.id,evidence.imageAssetId).then(blob => {url=URL.createObjectURL(blob);if(alive)setImage(url);else URL.revokeObjectURL(url);}).catch(()=>{}); return()=>{alive=false;if(url)URL.revokeObjectURL(url);}; }, [s.id,evidence?.id]);
  const busy = !!pkg.busy || s.run?.status === 'running';
  const update = (id: string, patch: Partial<ReadingItem>) => setItems(xs=>xs.map(x=>x.id===id?{...x,...patch}:x));
  const startRead = () => pkg.act('read-evidence', async cur => { const next=await api.readingRequest(cur.id,{expectedRevision:cur.inputRevision,evidenceId:evidence!.id,instruction,crop});await api.start(cur.id,next.inputRevision,'read_site_evidence'); });
  return <Section title="資料をAIで読み取り・確認" defaultOpen={!s.baselinePlan}>
    <div className="site-evidence" data-testid="site-evidence">
      <div className="site-fields">
        <label>資料の種類<select aria-label="Evidence role" value={role} onChange={e=>setRole(e.target.value as typeof role)}><option value="drawing">元図面</option><option value="site">現場写真・寸法スケッチ</option></select></label>
        <label>ページ<input aria-label="Evidence page" type="number" min="1" value={page} onChange={e=>setPage(Number(e.target.value))}/></label>
      </div>
      <label><input type="checkbox" checked={synthetic} onChange={e=>setSynthetic(e.target.checked)}/>検証用の架空資料（実測として扱わない）</label>
      <label>PDF・画像を追加<input aria-label="Add site evidence" type="file" accept="application/pdf,image/*" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void pkg.act('upload-evidence',async cur=>{const asset=await api.upload(cur.id,file);await api.siteEvidence(cur.id,{expectedRevision:cur.inputRevision,assetId:asset.id,page,role,synthetic,label:file.name});});e.target.value='';}}/></label>
      {!!work?.evidence.length && <label>確認する資料<select aria-label="Evidence selection" value={evidence?.id??''} onChange={e=>setSelected(e.target.value)}>{work.evidence.map(e=><option key={e.id} value={e.id}>{e.label} · p{e.page}{e.synthetic?' · TEST':''}</option>)}</select></label>}
      {image && <div className="site-image" onClick={event=>{
        if(!activeItem)return;const rect=event.currentTarget.getBoundingClientRect();const p={x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};
        const item=items.find(i=>i.id===activeItem);if(item)update(activeItem,{points:[...item.points.slice(1),p]});
      }}><img src={image} alt="確認する元資料"/><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="AI読み取り位置">{items.filter(i=>accepted.includes(i.id)).map((i,n)=><g key={i.id}><polyline points={i.points.map(p=>`${p.x*100},${p.y*100}`).join(' ')} fill="none" stroke="currentColor" strokeWidth=".35"/>{i.points.map((p,k)=><circle key={k} cx={p.x*100} cy={p.y*100} r=".7"/>)}<text x={i.points[0].x*100} y={i.points[0].y*100-1}>{n+1}</text></g>)}</svg></div>}
      {evidence && <><label>読み取る対象・指示<textarea aria-label="Reading instruction" value={instruction} onChange={e=>setInstruction(e.target.value)}/></label>
      <details><summary>読み取り範囲（0〜1）</summary><div className="site-fields">{(['x','y','width','height'] as const).map(k=><label key={k}>{k}<input aria-label={`Crop ${k}`} type="number" min="0" max="1" step=".01" value={crop[k]} onChange={e=>setCrop({...crop,[k]:Number(e.target.value)})}/></label>)}</div></details>
      <Button disabled={busy} onClick={()=>void startRead()}>AIで読み取る</Button></>}
      {reading && <div aria-live="polite"><p>{reading.notes}</p><p>{reading.reviewedAt?'確認済み':reading.inputRevision!==s.inputRevision?'入力が変わっています。再読み取りしてください。':'元資料と照合し、採用する項目を確認してください。'}</p>
        {items.map((item,n)=><fieldset key={item.id}><legend><label><input type="checkbox" checked={accepted.includes(item.id)} onChange={e=>setAccepted(xs=>e.target.checked?[...xs,item.id]:xs.filter(x=>x!==item.id))}/>{n+1}. {item.label}{item.uncertain?' · 要確認':''}</label></legend>
          <p>{item.evidence}</p><label>種類<select value={item.kind} onChange={e=>update(item.id,{kind:e.target.value as ReadingItem['kind']})}>{['pipe','head','duct','dimension'].map(k=><option key={k}>{k}</option>)}</select></label>
          {item.kind==='dimension' && <><label>測定対象<select aria-label={`Reading field ${item.id}`} value={item.field??''} onChange={e=>update(item.id,{field:e.target.value||null})}><option value="">未特定</option>{measurementFields.map(f=><option key={f} value={f}>{measurementLabel(f)}</option>)}</select></label><div className="site-fields"><label>値<input aria-label={`Reading value ${item.id}`} type="number" value={item.value??''} onChange={e=>update(item.id,{value:e.target.value===''?null:Number(e.target.value)})}/></label><label>単位<select value={item.unit??''} onChange={e=>update(item.id,{unit:e.target.value as ReadingItem['unit']})}><option value="">不明</option>{['mm','m','in','ft'].map(u=><option key={u}>{u}</option>)}</select></label></div></>}
          <details><summary>位置を修正</summary>{item.points.map((p,k)=><div className="site-fields" key={k}>{(['x','y'] as const).map(axis=><label key={axis}>{k+1} {axis}<input aria-label={`Point ${item.id} ${k} ${axis}`} type="number" min="0" max="1" step=".001" value={p[axis]} onChange={e=>update(item.id,{points:item.points.map((q,j)=>j===k?{...q,[axis]:Number(e.target.value)}:q)})}/></label>)}</div>)}<Button onClick={()=>setActiveItem(activeItem===item.id?'':item.id)}>{activeItem===item.id?'位置指定を終了':'画像上で順番に位置を指定'}</Button></details>
        </fieldset>)}
        {!s.baselinePlan && evidence?.role==='drawing' && <><div className="site-fields"><label>確認した区間長 mm<input aria-label="Confirmed span length" type="number" value={length} onChange={e=>setLength(e.target.value)}/></label><label>確認した配管高さ mm<input aria-label="Confirmed pipe elevation" type="number" value={elevation} onChange={e=>setElevation(e.target.value)}/></label></div><label>元図面に対応する製品<select aria-label="Reading products" value={products} onChange={e=>setProducts(e.target.value)}>{Object.entries(PRODUCT_SETS).map(([k,p])=><option value={k} key={k}>{p.label}</option>)}</select></label></>}
        <label><input aria-label="Hypothetical elevation" type="checkbox" checked={frameSynthetic} onChange={e=>setFrameSynthetic(e.target.checked)}/>高さは試算用の仮定（実測ではない）</label>
        <label>確認者<input aria-label="Reading reviewer" value={reviewer} onChange={e=>setReviewer(e.target.value)}/></label>
        <Button disabled={busy||!reviewer.trim()||!!reading.reviewedAt||reading.inputRevision!==s.inputRevision} onClick={()=>void pkg.act('confirm-reading',cur=>api.confirmReading(cur.id,{expectedRevision:cur.inputRevision,readingId:reading.id,items:items.filter(i=>accepted.includes(i.id)),reviewer,frameSynthetic,spanLengthMm:length?Number(length):null,elevationMm:elevation?Number(elevation):null,pipeProductId:PRODUCT_SETS[products].pipe,fittingProductId:PRODUCT_SETS[products].elbow}))}>選択項目を確認して保存</Button>
      </div>}
    </div>
  </Section>;
}

/** A location on reviewed evidence when available, otherwise an explicitly unscaled guide. */
function MeasurementGuide({s,field}:{s:Snapshot;field:string}) {
  const matched=s.siteWork?.readings.filter(r=>r.reviewedAt).flatMap(r=>r.items.filter(i=>i.field===field).map(item=>({item,evidence:s.siteWork?.evidence.find(e=>e.id===r.evidenceId)}))).at(-1);
  const [image,setImage]=useState('');
  useEffect(()=>{let alive=true,url='';setImage('');if(matched?.evidence)void api.asset(s.id,matched.evidence.imageAssetId).then(blob=>{url=URL.createObjectURL(blob);if(alive)setImage(url);else URL.revokeObjectURL(url);}).catch(()=>{});return()=>{alive=false;if(url)URL.revokeObjectURL(url);};},[s.id,matched?.evidence?.id]);
  const axis=field.split('.').at(-1),isMin=field.includes('.min.'),spatial=field.startsWith('duct.')||field.startsWith('workEnvelope.');
  const vertical=axis==='z',target=vertical?(isMin?95:30):(isMin?100:245);
  return <div className="site-measurement-guide" data-testid="measurement-guide">
    <strong>{measurementLabel(field)}</strong>
    {image&&matched?<><div className="site-image"><img src={image} alt={`測定箇所の根拠資料：${measurementLabel(field)}`}/><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="資料上の測定箇所">{matched.item.points.map((p,i)=><circle key={i} cx={p.x*100} cy={p.y*100} r="1.5" fill="none" stroke="#b44726" strokeWidth=".5"/>)}</svg></div><p>{matched.evidence?.label} · p{matched.evidence?.page} · 確認した読み取り位置。円は測定対象の手掛かりで、実寸や奥行きではありません。</p></>:<p>元資料にこの測定位置が特定されていません。下図は測る面の説明で、現場写真との位置対応・実寸を表しません。</p>}
    <svg viewBox="0 0 340 155" role="img" aria-label={`測定案内：${measurementLabel(field)}（縮尺なし）`}>
      <rect x="100" y="30" width="145" height="65" fill="none" stroke="currentColor"/>
      <path d="M30 120H295 M30 120V15" stroke="#929b98" fill="none"/>
      {field==='requiredPipeClearance'?<><line x1="30" y1="62" x2="100" y2="62" stroke="#b44726" strokeWidth="3"/><text x="30" y="145" fontSize="11">配管の外面から障害物の外面までの必要離隔</text></>:spatial?<><line x1={vertical?85:target} y1={vertical?target:20} x2={vertical?255:target} y2={vertical?target:107} stroke="#b44726" strokeWidth="3"/><line x1="30" y1="120" x2={vertical?30:target} y2={vertical?target:120} stroke="#b44726" strokeWidth="3"/><text x="110" y="60" fontSize="11">{field.startsWith('duct')?'ダクト外面':'作業可能範囲の境界'}</text></>:<><circle cx="175" cy="62" r="45" fill="none" stroke="#b44726" strokeDasharray="4 3"/><line x1="175" y1="62" x2="220" y2="62" stroke="#b44726" strokeWidth="3"/><text x="103" y="145" fontSize="11">製品・作業条件の根拠で範囲を確定</text></>}
      {spatial&&<text x="30" y="145" fontSize="11">原点から {axis?.toUpperCase()} の{isMin?'小さい':'大きい'}側の面まで。負の値も使用します。</text>}
    </svg>
  </div>;
}

export function SiteMeasurements({ s, pkg }: {s: Snapshot;pkg:PackageState}) {
  const [field,setField]=useState<string>('duct.max.z'),[value,setValue]=useState(''),[unit,setUnit]=useState('mm'),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[synthetic,setSynthetic]=useState(false),[unavailable,setUnavailable]=useState(false),[evidence,setEvidence]=useState('');
  const fields=measurementFields.filter(f=>f!=='span.length'&&f!=='pipeElevation');
  const missing=fields.filter(f=>!s.siteFacts.some(v=>v.field===f&&v.value!==null));
  return <Section title="測定と不足情報" defaultOpen={!!s.baselinePlan&&!s.outputs.candidates}>
    <div className="site-evidence"><p>両端と周辺ヘッドを保持します。ダクト・作業範囲の座標は、対象配管の始点を原点、配管方向をX、左をY、上をZとして測定してください。</p>
    <svg viewBox="0 0 320 110" role="img" aria-label="配管始点を原点に、配管方向がX、左側がY、高さがZ"><path d="M30 85H290 M30 85V15 M30 85L90 25" fill="none" stroke="currentColor"/><text x="210" y="105">X 配管方向</text><text x="38" y="18">Z 高さ</text><text x="96" y="28">Y 左</text><text x="8" y="104">始点</text></svg>
    <p>必要な値が未確定：{missing.map(measurementLabel).join('、')||'なし'}</p>
    <details><summary>保存した寸法・測定不能の理由</summary>{s.siteFacts.filter(f=>fields.includes(f.field as typeof fields[number])).map(f=><p key={f.id}><strong>{measurementLabel(f.field)}</strong>：{f.value===null?`測定不能・未確認：${f.unknownReason??'理由未入力'}`:`${f.value} ${f.unit??''}`} · {f.provenance==='synthetic_assumption'?'検証用の仮定':f.confirmation==='confirmed'?'確認済み':'未確認'}<br/>{f.source.description}</p>)}</details>
    <label>測定対象<select aria-label="Measurement field" value={field} onChange={e=>{setField(e.target.value);setValue('');setConfirmed(false);}}>{fields.map(f=><option key={f} value={f}>{measurementLabel(f)}</option>)}</select></label>
    <MeasurementGuide s={s} field={field}/>
    <p>{field.startsWith('duct')?'ダクトの外側の位置を測ります。障害物を避けられるかの計算に使います。':field.startsWith('workEnvelope')?'壁・天井・周辺設備までの作業可能な境界を測ります。':field.includes('Envelope')?'継手外形または工具・組付け動作を含む包絡半径を、製品資料または確認した作業条件から入力します。':'必要な離隔の根拠と値を入力します。'}</p>
    <label><input type="checkbox" checked={unavailable} onChange={e=>setUnavailable(e.target.checked)}/>測定できない</label>
    {!unavailable&&<div className="site-fields"><label>値<input aria-label="Measurement value" type="number" value={value} onChange={e=>setValue(e.target.value)}/></label><label>単位<select value={unit} onChange={e=>setUnit(e.target.value)}>{['mm','m','in','ft'].map(u=><option key={u}>{u}</option>)}</select></label></div>}
    <label>{unavailable?'測定できない理由':'根拠・測定方法'}<textarea aria-label="Measurement reason" value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <label>根拠資料<select value={evidence} onChange={e=>setEvidence(e.target.value)}><option value="">手入力の記録</option>{s.siteWork?.evidence.map(e=><option value={e.id} key={e.id}>{e.label}</option>)}</select></label>
    <label><input type="checkbox" checked={synthetic} onChange={e=>setSynthetic(e.target.checked)}/>検証用の仮定</label><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>入力値と根拠を確認した</label>
    <Button disabled={!!pkg.busy||!reason.trim()||(!unavailable&&(!value||!confirmed))} onClick={()=>void pkg.act('measurement',cur=>api.measurement(cur.id,{expectedRevision:cur.inputRevision,field,subjectIds:[],value:unavailable?null:Number(value),unit,reason,evidenceId:evidence||null,synthetic,confirmed,unavailableReason:unavailable?reason:null}))}>測定結果を保存</Button>
    <Button disabled={!!pkg.busy||s.run?.status==='running'} onClick={()=>void pkg.act('resume',cur=>api.start(cur.id,cur.inputRevision,'adapt_to_site'))}>保存した情報でPiを再開</Button>
    </div>
  </Section>;
}

export function DesignerReviews({s,pkg}:{s:Snapshot;pkg:PackageState}) {
  const [checks,setChecks]=useState(reviewTopics.map(topic=>({topic,answer:'',evidence:''})));
  const topicLabels={supports:'支持：変更区間の支持位置・荷重と根拠',assembly:'接続・組付け：両端接続と工具・回転空間の根拠',heads:'ヘッド：保持対象・周辺の散水への影響と根拠',hydraulics:'水理：追加長・継手と再計算の必要性・根拠'};
  const [reviewer,setReviewer]=useState(''),[decision,setDecision]=useState('conditional'),[conditions,setConditions]=useState(''),[fingerprint,setFingerprint]=useState('');
  useEffect(()=>{void api.siteWork(s.id).then(r=>setFingerprint(r.fingerprint)).catch(()=>{});},[s.id,s.inputRevision]);
  return <Section title="設計者の回答・再確認" defaultOpen={!!s.selectedPlan}><div className="site-evidence">
    <p>アプリ内の回答記録です。回答を記録しても、計算の未確認事項は自動的に合格になりません。</p>
    {s.siteWork?.reviews.map(r=><article key={r.id}><strong>{r.decision} · {r.reviewer}</strong><p>{r.conditions}</p>{r.checks?.map(c=><p key={c.topic}>{topicLabels[c.topic]}：{c.answer||'未確認'} / {c.evidence||'根拠未入力'}</p>)}<small>対象版 {r.inputRevision} · {r.recordedAt} · {fingerprint===r.fingerprint?'現在の案への回答':'案が変更されています：再確認が必要'}</small></article>)}
    {checks.map((c,i)=><fieldset key={c.topic}><legend>{topicLabels[c.topic]}</legend><label>回答（空欄は未確認）<textarea aria-label={`Review ${c.topic} answer`} value={c.answer} onChange={e=>setChecks(xs=>xs.map((x,n)=>n===i?{...x,answer:e.target.value}:x))}/></label><label>根拠資料・対象箇所<input aria-label={`Review ${c.topic} evidence`} value={c.evidence} onChange={e=>setChecks(xs=>xs.map((x,n)=>n===i?{...x,evidence:e.target.value}:x))}/></label></fieldset>)}
    <label>回答者<input aria-label="Designer name" value={reviewer} onChange={e=>setReviewer(e.target.value)}/></label>
    <label>回答<select aria-label="Designer decision" value={decision} onChange={e=>setDecision(e.target.value)}><option value="accepted">了承</option><option value="conditional">条件付き</option><option value="revise">要修正</option></select></label>
    <label>条件・回答の根拠<textarea aria-label="Designer conditions" value={conditions} onChange={e=>setConditions(e.target.value)}/></label>
    <Button disabled={!!pkg.busy||!s.selectedPlan||!reviewer.trim()||!conditions.trim()} onClick={()=>void pkg.act('review',cur=>api.designerReview(cur.id,{expectedRevision:cur.inputRevision,reviewer,decision,conditions,evidenceIds:s.siteWork?.evidence.map(e=>e.id)??[],checks}))}>回答を記録</Button>
    <p>修正指示は測定欄・現況入力で確認して反映し、変更案を再計算してください。</p>
    </div></Section>;
}
