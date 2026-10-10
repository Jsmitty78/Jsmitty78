import "./drawing-editor.css";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { newDrawingId, closestPipe, connectAt, defaultDrawingLayers, referenceChanges, referenceProvenance, drawingBody, drawingReference, drawingTransform, exampleDrawing, pipeLength, renderDrawingSvg, SHEET, validateDrawing, type DrawingModel, type PlanPoint } from '@sprink/core';
import type { Action, TaskSnapshot } from './types.js';
import { taskPath, write } from './api.js';
import { Badge, Button, Section } from './ui.js';

type Tool = 'select' | 'pan' | 'pipe' | 'head' | 'wall';
type Selection = {kind:'node'|'pipe'|'head'|'wall';id:string};
const copy = (d: DrawingModel) => structuredClone(d);
const initialCamera = {x:0,y:0,w:SHEET.width,h:SHEET.height};
const nextId = newDrawingId;
function download(name:string,content:string,type:string) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function restoreDraft(task:TaskSnapshot) {
  const fallback={drawing:copy(task.plan.drawing??exampleDrawing(task.plan.orientation)),base:task.revision,saved:JSON.stringify(task.plan.drawing??exampleDrawing(task.plan.orientation))};
  try {
    const raw=sessionStorage.getItem(`sprink.draft.${task.id}`);if(!raw)return fallback;
    const cached=JSON.parse(raw);
    if(typeof cached.base!=='number'||typeof cached.saved!=='string')return fallback;
    return {drawing:validateDrawing(cached.drawing),base:cached.base,saved:cached.saved};
  }catch{return fallback;}
}
export function PlanEditor({task,token,action,busy}:{task:TaskSnapshot;token:string;action:Action;busy:string}) {
  const [restored]=useState(()=>restoreDraft(task));
  const [draft,setDraft]=useState<DrawingModel>(restored.drawing);
  const [base,setBase]=useState(restored.base);
  const [saved,setSaved]=useState(restored.saved);
  const [undo,setUndo]=useState<DrawingModel[]>([]),[redo,setRedo]=useState<DrawingModel[]>([]);
  const [tool,setTool]=useState<Tool>('select'),[selection,setSelection]=useState<Selection|null>(null);
  const [camera,setCamera]=useState(initialCamera),[layers,setLayers]=useState(defaultDrawingLayers);
  const [snap,setSnap]=useState(true),[start,setStart]=useState<PlanPoint|null>(null),[cursor,setCursor]=useState<PlanPoint|null>(null);
  const [message,setMessage]=useState(''),[expanded,setExpanded]=useState(false);
  const svg=useRef<SVGSVGElement>(null),importInput=useRef<HTMLInputElement>(null);
  const drag=useRef<{type:'node'|'pan';point:PlanPoint;client?:PlanPoint;started?:boolean;node?:string;before:DrawingModel;camera:typeof camera}|null>(null);
  const dirty=JSON.stringify(draft)!==saved,disabled=!!busy||task.state==='cancelled'||layers.referenceMode==='original';
  const stale=dirty&&base!==task.revision;
  useEffect(()=>{
    if(!dirty) {
      const next=copy(task.plan.drawing??exampleDrawing(task.plan.orientation));
      setDraft(next);setSaved(JSON.stringify(next));setBase(task.revision);setUndo([]);setRedo([]);
    }
  // Polling must not replace a local draft.
  },[task.revision]);
  useEffect(()=>{
    try {
      const key=`sprink.draft.${task.id}`;
      if(dirty)sessionStorage.setItem(key,JSON.stringify({drawing:draft,base,saved}));else sessionStorage.removeItem(key);
    }catch {setMessage('ブラウザーに下書きを保管できません。JSONを書き出して保管してください。');}
  },[draft,base,saved,dirty,task.id]);
  useEffect(()=>{
    const el=svg.current;if(!el)return;
    const prevent=(e:WheelEvent)=>e.preventDefault();
    el.addEventListener('wheel',prevent,{passive:false});return()=>el.removeEventListener('wheel',prevent);
  },[]);
  useEffect(()=>{
    if(!dirty)return;
    const prevent=(event:BeforeUnloadEvent)=>event.preventDefault();
    window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);
  },[dirty]);
  function commit(next:DrawingModel) {
    try {const valid=validateDrawing(next);setUndo(v=>[...v.slice(-49),copy(draft)]);setRedo([]);setDraft(valid);setMessage('');}
    catch(error){setMessage((error as Error).message);}
  }
  function change(edit:(next:DrawingModel)=>void) {const next=copy(draft);edit(next);commit(next);}
  function history(direction:'undo'|'redo') {
    const source=direction==='undo'?undo:redo,last=source.at(-1);if(!last)return;
    if(direction==='undo'){setUndo(source.slice(0,-1));setRedo(v=>[...v,copy(draft)]);}else{setRedo(source.slice(0,-1));setUndo(v=>[...v,copy(draft)]);}
    setDraft(copy(last));setSelection(null);setStart(null);setMessage('');
  }
  function point(event:{clientX:number;clientY:number}):PlanPoint {
    const matrix=svg.current!.getScreenCTM()!;
    const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());return {x:p.x,y:p.y};
  }
  function modelPoint(p:PlanPoint):PlanPoint {
    const t=drawingTransform(draft),round=(n:number)=>snap?Math.round(n/50)*50:Math.round(n);
    return {x:Math.max(0,Math.min(draft.width,round((p.x-t.x)/t.scale))),y:Math.max(0,Math.min(draft.height,round((p.y-t.y)/t.scale)))};
  }
  function nearest(p:PlanPoint) {
    const tolerance=12*camera.w/SHEET.width/drawingTransform(draft).scale;
    return draft.nodes.filter(n=>Math.hypot(n.x-p.x,n.y-p.y)<=tolerance).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
  }
  function down(event:ReactPointerEvent<SVGSVGElement>) {
    if(event.button!==0&&event.button!==1)return;
    const raw=point(event),p=modelPoint(raw),target=event.target as Element;
    if(tool==='pan'||event.button===1){event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={type:'pan',point:{x:event.clientX,y:event.clientY},before:copy(draft),camera};return;}
    if(disabled)return;
    if(tool==='select') {
      const head=target.closest('[data-head]')?.getAttribute('data-head'),node=target.closest('[data-node]')?.getAttribute('data-node'),pipe=target.closest('[data-pipe]')?.getAttribute('data-pipe'),wall=target.closest('[data-wall]')?.getAttribute('data-wall');
      setSelection(head?{kind:'head',id:head}:node?{kind:'node',id:node}:pipe?{kind:'pipe',id:pipe}:wall?{kind:'wall',id:wall}:null);
      if(node){event.currentTarget.setPointerCapture(event.pointerId);drag.current={type:'node',node,point:raw,client:{x:event.clientX,y:event.clientY},before:copy(draft),camera};}
      return;
    }
    const t=drawingTransform(draft);
    if(raw.x<t.x||raw.x>t.x+draft.width*t.scale||raw.y<t.y||raw.y>t.y+draft.height*t.scale)return;
    if(tool==='head') {
      const n=nearest(p),found=closestPipe(draft,p,8*camera.w/SHEET.width/t.scale);
      if(!n&&!found){setMessage('ヘッドは配管上をクリックして追加します。途中なら接続点を作成します。');return;}
      if(n&&draft.heads.some(h=>h.nodeId===n.id)){setMessage('この節点にはヘッドがあります。');return;}
      const next=copy(draft),nodeId=n?.id??connectAt(next,found!.point,.1),id=nextId(next,'H');
      next.heads.push({id,nodeId,orientation:'pendent',model:'UNSPECIFIED'});commit(next);setSelection({kind:'head',id});return;
    }
    const node=tool==='pipe'?nearest(p):undefined;
    const projected=tool==='pipe'&&!node?closestPipe(draft,p,8*camera.w/SHEET.width/t.scale)?.point:undefined;
    const at=node??projected??p;
    if(!start){setStart({x:at.x,y:at.y});setMessage('終点をクリック。Escで中止。Shiftで水平・垂直に固定。');return;}
    let end:PlanPoint={x:at.x,y:at.y};
    if(event.shiftKey)end=Math.abs(end.x-start.x)>Math.abs(end.y-start.y)?{x:end.x,y:start.y}:{x:start.x,y:end.y};
    if(Math.hypot(end.x-start.x,end.y-start.y)<1){setMessage('始点と異なる終点を指定してください。');return;}
    const next=copy(draft),id=nextId(next,tool==='pipe'?'P':'W');
    if(tool==='pipe') {
      const from=connectAt(next,start,.1),to=connectAt(next,end,.1);
      const pipeId=nextId(next,'P');next.pipes.push({id:pipeId,from,to,diameter:25});
      commit(next);setStart(null);setSelection({kind:'pipe',id:pipeId});return;
    }else next.walls.push({id,from:start,to:end,thickness:150});
    commit(next);setStart(null);setSelection({kind:'wall',id});
  }
  function move(event:ReactPointerEvent<SVGSVGElement>) {
    const d=drag.current;
    if(d?.type==='pan') {
      const box=svg.current!.getBoundingClientRect(),scale=Math.min(box.width/d.camera.w,box.height/d.camera.h);
      setCamera({...d.camera,x:d.camera.x-(event.clientX-d.point.x)/scale,y:d.camera.y-(event.clientY-d.point.y)/scale});return;
    }
    const p=modelPoint(point(event));setCursor(p);
    if(d?.type==='node') {
      if(!d.started&&Math.hypot(event.clientX-d.client!.x,event.clientY-d.client!.y)<3)return;
      d.started=true;
      const raw=point(event),t=drawingTransform(d.before),next=copy(d.before),n=next.nodes.find(n=>n.id===d.node)!;
      const round=(v:number)=>snap?Math.round(v/50)*50:v;
      n.x=Math.max(0,Math.min(next.width,round(n.x+(raw.x-d.point.x)/t.scale)));
      n.y=Math.max(0,Math.min(next.height,round(n.y+(raw.y-d.point.y)/t.scale)));setDraft(next);
    }
  }
  function endDrag(cancel=false) {
    const d=drag.current;drag.current=null;if(!d||d.type==='pan')return;
    if(cancel){setDraft(d.before);return;}
    try {validateDrawing(draft);if(JSON.stringify(draft)!==JSON.stringify(d.before)){setUndo(v=>[...v.slice(-49),d.before]);setRedo([]);}}
    catch(error){setDraft(d.before);setMessage((error as Error).message);}
  }
  function zoom(factor:number,anchor={x:camera.x+camera.w/2,y:camera.y+camera.h/2}) {
    const width=Math.min(SHEET.width*2,Math.max(SHEET.width/12,camera.w*factor)),ratio=width/camera.w;
    setCamera({x:anchor.x-(anchor.x-camera.x)*ratio,y:anchor.y-(anchor.y-camera.y)*ratio,w:width,h:width*SHEET.height/SHEET.width});
  }
  function remove() {
    if(!selection)return;
    if(selection.id==='H1'||selection.id==='P1'){setMessage('H1とP1は現場確認の対象のため削除できません。');return;}
    const next=copy(draft);
    if(selection.kind==='head')next.heads=next.heads.filter(h=>h.id!==selection.id);
    if(selection.kind==='wall')next.walls=next.walls.filter(w=>w.id!==selection.id);
    if(selection.kind==='pipe')next.pipes=next.pipes.filter(p=>p.id!==selection.id);
    if(selection.kind==='node') {setMessage('節点を削除するには、接続した配管とヘッドを先に削除してください。');return;}
    const used=new Set(next.pipes.flatMap(p=>[p.from,p.to]));
    if(next.heads.some(h=>!used.has(h.nodeId))){setMessage('ヘッドが孤立します。先に対象ヘッドを削除してください。');return;}
    next.nodes=next.nodes.filter(n=>used.has(n.id));commit(next);setSelection(null);
  }
  async function save() {
    try {validateDrawing(draft);}catch(error){setMessage((error as Error).message);return;}
    await action('図面を保存',async()=>{
      const result=await write<TaskSnapshot>(token,taskPath(task.id,'/drawing'),{baseRevision:base,drawing:draft});
      setDraft(copy(result.plan.drawing!));setSaved(JSON.stringify(result.plan.drawing));setBase(result.revision);setUndo([]);setRedo([]);
    });
  }
  const head=selection?.kind==='head'?draft.heads.find(h=>h.id===selection.id):undefined;
  const node=draft.nodes.find(n=>n.id===(head?.nodeId??(selection?.kind==='node'?selection.id:'')));
  const pipe=selection?.kind==='pipe'?draft.pipes.find(p=>p.id===selection.id):undefined;
  const wall=selection?.kind==='wall'?draft.walls.find(w=>w.id===selection.id):undefined;
  const t=drawingTransform(draft),project=(p:PlanPoint)=>({x:t.x+p.x*t.scale,y:t.y+p.y*t.scale});
  const selectedNodes=node?[node]:pipe?draft.nodes.filter(n=>n.id===pipe.from||n.id===pipe.to):[];
  const field=(label:string,value:number,onChange:(n:number)=>void,min:number,max:number)=> <label className="form-field"><span>{label}</span><input key={`${selection?.id}-${label}-${value}`} type="number" defaultValue={value} min={min} max={max} step="any" disabled={disabled} onBlur={e=>{if(e.target.value!==''&&e.target.validity.valid){const n=Number(e.target.value);if(n!==value)onChange(n);}else{e.target.value=String(value);setMessage(`${label}は${min}〜${max}で入力してください。`);}}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}} /></label>;
  return <div className={`drawing-workspace ${expanded?'drawing-expanded':''}`}><Section eyebrow="DRAWING WORKSPACE" title="スプリンクラー平面図" action={<div className="button-row"><Badge tone={dirty?'warning':'neutral'}>{dirty?'未保存の変更':`図面 v${task.plan.revision}`}</Badge><Button className="button-small" onClick={()=>setExpanded(v=>!v)}>{expanded?'通常表示':'大きく表示'}</Button><Button className="button-primary button-small" disabled={disabled||!dirty||stale} onClick={()=>void save()}>図面を保存</Button></div>}>
    <div className="drawing-toolbar" role="toolbar" aria-label="図面ツール">{([['select','選択・移動'],['pan','表示を移動'],['pipe','配管を描く'],['head','ヘッドを追加'],['wall','壁を描く']] as const).map(([id,title])=><button key={id} aria-pressed={tool===id} disabled={id!=='pan'&&disabled} onClick={()=>{setTool(id);setStart(null);setMessage('');}}>{title}</button>)}<span className="toolbar-divider"/><button disabled={disabled||!undo.length} onClick={()=>history('undo')} aria-label="元に戻す">↶</button><button disabled={disabled||!redo.length} onClick={()=>history('redo')} aria-label="やり直す">↷</button><button onClick={()=>zoom(.8)} aria-label="図面を拡大">＋</button><button onClick={()=>zoom(1.25)} aria-label="図面を縮小">−</button><button onClick={()=>setCamera(initialCamera)}>全体</button><button onClick={()=>{const t=drawingTransform(draft);const w=draft.width*t.scale+70;setCamera({x:t.x-35,y:t.y-35,w,h:Math.max(draft.height*t.scale+70,w*SHEET.height/SHEET.width)});}}>配管に合わせる</button><label><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/>50 mmスナップ</label></div>
    {draft.source&&<div className="reference-controls"><div className="button-row">{([['edit','編集図'],['original','原図'],['overlay','重ね合わせ']] as const).map(([id,title])=><button key={id} aria-pressed={(layers.referenceMode??'edit')===id} onClick={()=>{setLayers(v=>({...v,referenceMode:id}));setStart(null);setSelection(null);}}>{title}</button>)}</div><p>FS-01 中二階 · 原図19ヘッド / 32配管線 → 41接続区間 · <strong>変更 {referenceChanges(draft).pipes.length+referenceChanges(draft).heads.length} / 削除 {referenceChanges(draft).removed.length}</strong></p></div>}
    {stale&&<p className="drawing-warning" role="alert">保存後に仕事が更新されています。下書きはこのタブに保管しています。JSONを書き出して保管し、「最新を読み直す」で更新後、JSONを読み込んで保存してください。</p>}
    <div className="drawing-layout"><div className="drawing-canvas-wrap"><svg ref={svg} className={`drawing-canvas tool-${tool}`} viewBox={`${camera.x} ${camera.y} ${camera.w} ${camera.h}`} tabIndex={0} role="application" aria-label="図面編集キャンバス" onPointerDown={down} onPointerMove={move} onPointerUp={()=>endDrag()} onPointerCancel={()=>endDrag(true)} onWheel={e=>{e.stopPropagation();zoom(e.deltaY>0?1.12:.89,point(e));}} onKeyDown={e=>{if(e.key==='Escape'){endDrag(true);setStart(null);setTool('select');}if(disabled)return;if((e.metaKey||e.ctrlKey)&&e.key==='z'){e.preventDefault();history(e.shiftKey?'redo':'undo');}if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();remove();}}}>
      <g dangerouslySetInnerHTML={{__html:drawingBody(draft,task.plan.revision,{...layers,selectedId:selection?.id})}}/>
      <g fill="white" stroke="#ce7138" strokeWidth="2">{selectedNodes.map(n=><circle key={n.id} data-node={n.id} cx={project(n).x} cy={project(n).y} r="7" />)}{wall&&<path pointerEvents="none" d={`M${project(wall.from).x} ${project(wall.from).y}L${project(wall.to).x} ${project(wall.to).y}`} strokeWidth="4"/>}</g>
      {start&&<g stroke="#ce7138" fill="none" strokeWidth="1.5" pointerEvents="none"><circle cx={project(start).x} cy={project(start).y} r="5"/>{cursor&&<path strokeDasharray="5 3" d={`M${project(start).x} ${project(start).y}L${project(cursor).x} ${project(cursor).y}`}/>}</g>}
    </svg><div className="drawing-status"><span>{Math.round(SHEET.width/camera.w*100)}% · mm</span><span>{cursor?`X ${cursor.x.toLocaleString()} / Y ${cursor.y.toLocaleString()}`:'原点は図面左上'} · {draft.pipes.length}配管 / {draft.heads.length}ヘッド</span></div></div>
    <aside className="drawing-inspector"><p className="eyebrow">PROPERTIES</p><label className="form-field"><span>図面要素を選択</span><select value={selection?`${selection.kind}:${selection.id}`:''} onChange={e=>{const [kind,id]=e.target.value.split(':');setSelection(id?{kind:kind as Selection['kind'],id}:null);setTool('select');setStart(null);}}><option value="">対象を選択</option>{draft.pipes.map(p=><option key={p.id} value={`pipe:${p.id}`}>{p.id} · DN{p.diameter}</option>)}{draft.heads.map(h=><option key={h.id} value={`head:${h.id}`}>{h.id} · ヘッド</option>)}{draft.walls.map(w=><option key={w.id} value={`wall:${w.id}`}>{w.id} · 壁</option>)}</select></label><h3>{selection?`${selection.id} の編集`:'対象を選択'}</h3>{!selection&&<p className="muted">配管・壁・ヘッドをクリック。丸いハンドルをドラッグすると接続した配管も動きます。</p>}
      {node&&<>{field('X (mm)',node.x,n=>change(d=>{d.nodes.find(v=>v.id===node.id)!.x=n;}),0,draft.width)}{field('Y (mm)',node.y,n=>change(d=>{d.nodes.find(v=>v.id===node.id)!.y=n;}),0,draft.height)}<p className="muted">接続節点 {node.id}</p></>}
      {head&&<><label className="form-field"><span>取付方向</span><select value={head.orientation} disabled={disabled} onChange={e=>change(d=>{d.heads.find(v=>v.id===head.id)!.orientation=e.target.value as typeof head.orientation;})}><option value="pendent">下向き</option><option value="upright">上向き</option><option value="sideways">横向き</option></select></label><p className="muted">{head.model==='UNSPECIFIED'?'型式：未指定':head.model}</p></>}
      {pipe&&<>{pipe.nominalInches&&<p className="muted">原図呼び径 {pipe.nominalInches}″ / DN換算表示</p>}{field('呼び径 DN',pipe.diameter,n=>change(d=>{const p=d.pipes.find(v=>v.id===pipe.id)!;p.diameter=n;delete p.nominalInches;}),15,300)}<p className="drawing-length">{pipeLength(draft,pipe).toFixed(1)} <small>mm</small></p><p className="muted">平面中心線長 / {pipe.from} → {pipe.to}</p>{[pipe.from,pipe.to].map(id=>{const n=draft.nodes.find(v=>v.id===id)!;return <div key={id}>{field(`${id} X (mm)`,n.x,x=>change(d=>{d.nodes.find(v=>v.id===id)!.x=x;}),0,draft.width)}{field(`${id} Y (mm)`,n.y,y=>change(d=>{d.nodes.find(v=>v.id===id)!.y=y;}),0,draft.height)}</div>;})}</>}
      {wall&&<>{field('壁厚 (mm)',wall.thickness,n=>change(d=>{d.walls.find(v=>v.id===wall.id)!.thickness=n;}),50,1000)}{(['from','to'] as const).map((end,i)=><div key={end}>{field(`${i?'終点':'始点'} X (mm)`,wall[end].x,n=>change(d=>{d.walls.find(v=>v.id===wall.id)![end].x=n;}),0,draft.width)}{field(`${i?'終点':'始点'} Y (mm)`,wall[end].y,n=>change(d=>{d.walls.find(v=>v.id===wall.id)![end].y=n;}),0,draft.height)}</div>)}</>}
      {selection&&draft.source&&<details className="drawing-provenance"><summary>原図の根拠</summary><pre>{JSON.stringify(referenceProvenance(selection.id),null,2)}</pre><p className="muted">PDF p.1 · 縮尺換算値。現場の実測精度は未確認。</p></details>}
      {selection&&<Button className="button-small" disabled={disabled} onClick={remove}>選択を削除</Button>}
      <div className="drawing-layers"><p className="eyebrow">LAYERS</p>{([['architecture','建築下図'],['dimensions','寸法'],['labels','記号・配管径'],['grid','500 mmグリッド']] as const).map(([key,title])=><label key={key}><input type="checkbox" checked={layers[key]} onChange={e=>setLayers(v=>({...v,[key]:e.target.checked}))}/>{title}</label>)}</div>
    </aside></div>
    <p className="drawing-help" role="status">{message||'配管・壁：始点→終点をクリック。Shiftで直交。選択：座標を数値入力、またはドラッグ。Escで中止。⌘/Ctrl+Zで元に戻す。'}</p>
    <div className="drawing-footer"><div className="button-row"><Button className="button-small" onClick={()=>download(`FP-01-v${task.plan.revision}${dirty?'-draft':''}.svg`,renderDrawingSvg(draft,task.plan.revision),'image/svg+xml')}>SVGを書き出す</Button><Button className="button-small" onClick={()=>download('drawing-draft.json',JSON.stringify(draft,null,2),'application/json')}>JSONを書き出す</Button><Button className="button-small" disabled={disabled} onClick={()=>importInput.current?.click()}>JSONを読み込む</Button><Button className="button-small" disabled={disabled} onClick={()=>{const next=copy(task.plan.drawing??exampleDrawing(task.plan.orientation));setDraft(next);setSaved(JSON.stringify(next));setBase(task.revision);setUndo(v=>[...v,copy(draft)]);setRedo([]);setSelection(null);setStart(null);setMessage('保存済み図面を読み込みました。直前の下書きは「元に戻す」で復元できます。');}}>最新を読み直す</Button></div><a href={drawingReference} target="_blank" rel="noreferrer">参考にした実図面 ↗</a></div>
    <input ref={importInput} type="file" accept=".json,application/json" className="visually-hidden" aria-label="図面JSONを選択" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;try{if(file.size>1_000_000)throw new Error('図面JSONは1MB以下にしてください。');commit(validateDrawing(JSON.parse(await file.text())));setSelection(null);}catch(error){setMessage((error as Error).message);}}}/>
    <p className="panel-footnote">保存すると旧版の確認資料・追加依頼は失効します。描画精度は入力座標に基づきます。原図からの換算寸法は現場実測ではありません。施工可否・散水性能・加工寸法は検証していません。</p>
  </Section></div>;
}
