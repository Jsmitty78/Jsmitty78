import data from './reference/itd-mezzanine.json' with { type: 'json' };
import type { DrawingModel, DrawingLayers, PlanPoint } from './plan.js';

export const referenceSource = data.source;
export const referenceCounts = data.counts;
export function referenceDrawing(): DrawingModel { return structuredClone(data.model) as DrawingModel; }
export function referenceTransform(d:DrawingModel) {return {x:115,y:115,scale:Math.min(620/d.width,510/d.height)};}
export function referenceProvenance(id:string) {return (data.provenance as Record<string,unknown>)[id]??null;}
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const baseline=data.model;
export const referenceElementIds=[...baseline.nodes,...baseline.pipes,...baseline.heads].map(v=>v.id);
export function referenceChanges(d:DrawingModel) {
  const oldNodes=new Map(baseline.nodes.map(n=>[n.id,n]));
  const newNodes=new Map(d.nodes.map(n=>[n.id,n]));
  const moved=(id:string)=>{const a=oldNodes.get(id),b=newNodes.get(id);return !a||!b||Math.hypot(a.x-b.x,a.y-b.y)>.01;};
  const pipes=d.pipes.filter(p=>{const old=baseline.pipes.find(v=>v.id===p.id);return !old||p.from!==old.from||p.to!==old.to||p.diameter!==old.diameter||p.nominalInches!==old.nominalInches||moved(p.from)||moved(p.to);}).map(v=>v.id);
  const heads=d.heads.filter(h=>{const old=baseline.heads.find(v=>v.id===h.id);return !old||h.nodeId!==old.nodeId||h.orientation!==old.orientation||h.model!==old.model||moved(h.nodeId);}).map(v=>v.id);
  const removed=[...baseline.pipes,...baseline.heads].filter(v=>![...d.pipes,...d.heads].some(n=>n.id===v.id)).map(v=>v.id);
  return {pipes,heads,removed};
}
export function referenceBody(d:DrawingModel,revision:number,layers:DrawingLayers):string {
  const t=referenceTransform(d),u=t.scale*referenceSource.mmPerPdfPoint,mode=layers.referenceMode??'edit';
  const x=(n:number)=>t.x+n*t.scale,y=(n:number)=>t.y+n*t.scale;
  const text=(xx:number,yy:number,s:string,size=10,attrs='')=>`<text x="${xx}" y="${yy}" font-size="${size}" ${attrs}>${esc(s)}</text>`;
  const path=(a:PlanPoint,b:PlanPoint)=>`M${x(a.x)} ${y(a.y)}L${x(b.x)} ${y(b.y)}`;
  const changes=referenceChanges(d),hasChanges=changes.pipes.length+changes.heads.length+changes.removed.length>0,nodes=new Map(d.nodes.map(n=>[n.id,n]));
  let b=`<rect width="1080" height="760" fill="white"/><g font-family="Arial, sans-serif" fill="#25313b"><rect x="20" y="20" width="1040" height="720" stroke="#25313b" stroke-width=".8" fill="none"/>${text(40,48,'FS-01 / MEZZANINE — SOURCE-BASED DRAWING',17)}${text(40,70,'原図ベクトルから抽出 · 中二階のみ · PDF縮尺 1:96 · 現場実測未確認',11)}${text(1035,48,`REV ${revision}`,13,'text-anchor="end"')}`;
  // Nested SVG clips retained source vectors to the documented PDF crop. No raster trace.
  b+=`<svg x="${t.x}" y="${t.y}" width="${d.width*t.scale}" height="${d.height*t.scale}" viewBox="0 0 560 560" pointer-events="none" overflow="hidden">${layers.architecture?`<g opacity="${hasChanges&&mode!=='original'?.4:1}">${data.background}</g>`:''}${layers.architecture&&(mode==='original'||!hasChanges)?data.annotations:''}${mode==='original'?data.original:mode==='overlay'?`<g opacity=".28">${data.original}</g>`:''}</svg>`;
  if(mode!=='original') {
    if(layers.grid){b+='<g stroke="#76a893" stroke-width=".4" opacity=".25">';for(let xx=0;xx<=d.width;xx+=500)b+=`<path d="M${x(xx)} ${y(0)}V${y(d.height)}"/>`;for(let yy=0;yy<=d.height;yy+=500)b+=`<path d="M${x(0)} ${y(yy)}H${x(d.width)}"/>`;b+='</g>';}
    for(const p of d.pipes) {
      const a=nodes.get(p.from)!,c=nodes.get(p.to)!,changed=changes.pipes.includes(p.id),selected=layers.selectedId===p.id;
      const color=changed?'#b75020':mode==='overlay'?'#087fbc':'#000';
      b+=`<g data-pipe="${p.id}"><title>${esc(p.id)} · ${p.nominalInches?`${p.nominalInches} inch`:`DN${p.diameter}`} · ${Math.hypot(c.x-a.x,c.y-a.y).toFixed(1)} mm</title><path d="${path(a,c)}" stroke="transparent" stroke-width="12" fill="none" pointer-events="stroke"/><path d="${path(a,c)}" stroke="${color}" stroke-width="${1.68*u}" stroke-linecap="round" fill="none"/>`;
      if((changed&&layers.labels)||selected)b+=text((x(a.x)+x(c.x))/2+6,(y(a.y)+y(c.y))/2-7,`${p.id} · ${p.nominalInches?`${p.nominalInches}″`:`DN${p.diameter}`}`,9,'paint-order="stroke" stroke="white" stroke-width="3"');
      if(layers.dimensions&&selected)b+=text((x(a.x)+x(c.x))/2+6,(y(a.y)+y(c.y))/2+13,`≈ ${Math.hypot(c.x-a.x,c.y-a.y).toFixed(1)} mm`,9,'paint-order="stroke" stroke="white" stroke-width="3"');
      b+='</g>';
    }
    for(const h of d.heads) {
      const n=nodes.get(h.nodeId)!,r=4.425*u,changed=changes.heads.includes(h.id),color=changed?'#b75020':mode==='overlay'?'#087fbc':'#000';
      b+=`<g data-head="${h.id}" data-node="${n.id}" stroke="${color}" stroke-width="${1.44*u}"><title>${esc(h.id+' / '+h.model+' / '+h.orientation)}</title><circle cx="${x(n.x)}" cy="${y(n.y)}" r="9" fill="transparent" stroke="none"/>`;
      if(h.orientation==='sideways')b+=`<path d="M${x(n.x)-r} ${y(n.y)-r}L${x(n.x)+r} ${y(n.y)}L${x(n.x)-r} ${y(n.y)+r}Z" fill="white"/>`;
      else b+=`<circle cx="${x(n.x)}" cy="${y(n.y)}" r="${r}" fill="white"/>${h.orientation==='pendent'?`<path d="M${x(n.x)-r-1} ${y(n.y)+r+1}L${x(n.x)+r+1} ${y(n.y)-r-1}"/>`:''}`;
      if(layers.labels&&(changed||layers.selectedId===h.id))b+=text(x(n.x)+9,y(n.y)-6,h.id,9,'paint-order="stroke" stroke="white" stroke-width="3"');b+='</g>';
    }
    for(const n of d.nodes)if(!d.heads.some(h=>h.nodeId===n.id))b+=`<circle data-node="${n.id}" cx="${x(n.x)}" cy="${y(n.y)}" r="4" fill="transparent"/>`;
    if(layers.architecture)for(const w of d.walls)b+=`<path data-wall="${w.id}" d="${path(w.from,w.to)}" stroke="#b75020" stroke-width="${Math.max(1,w.thickness*t.scale)}"/>`;
    if(layers.architecture) {
      for(const door of d.doors) {
        const size=door.width*t.scale;
        b+=`<g transform="translate(${x(door.at.x)} ${y(door.at.y)}) rotate(${door.rotation})" stroke="#b75020" stroke-width="1" fill="none"><path d="M0 0V${-size}M0 ${-size}A${size} ${size} 0 0 1 ${size} 0"/></g>`;
      }
      for(const room of d.rooms)b+=text(x(room.x),y(room.y),room.name,10,'fill="#b75020" paint-order="stroke" stroke="white" stroke-width="3"');
    }
  }
  b+=`<path d="M775 95V645" stroke="#cad1d5" stroke-width=".7"/>${text(800,118,mode==='original'?'原図 / ORIGINAL':mode==='overlay'?'重ね合わせ / OVERLAY':'編集図 / EDITABLE',13)}${text(800,149,`配管 ${d.pipes.length}区間 / ヘッド ${d.heads.length}個`,11)}${text(800,173,hasChanges?'薄灰：固定の原図下図・引出線':'灰：保持した建築・注記ベクトル',10)}${text(800,195,'黒／青：抽出済み配管・ヘッド',10)}${text(800,217,'橙：原図から変更した要素',10)}${text(800,253,`変更 ${changes.pipes.length+changes.heads.length} / 削除 ${changes.removed.length}`,11)}${text(800,284,'SOURCE / 出典',12)}${text(800,307,'Idaho Transportation Dept.',10)}${text(800,326,'FM32361 / FS-01 / p.1',10)}${text(800,345,'2023-06-05 · MEZZANINE',10)}${text(800,380,'原紙 42 × 30 inch',10)}${text(800,400,'1/8 inch = 1 foot → 1:96',10)}${text(800,420,'1 PDF pt = 33.8666667 mm',10)}${text(800,455,'寸法はPDF座標からの換算値。',10)}${text(800,475,'現場精度・施工可否は未確認。',10)}${text(800,495,'型式：各要素の指定値を参照。',10)}${text(800,515,'主階との接続はこの範囲外。',10)}${text(800,548,'配管寸法は選択時に表示。',10)}${text(800,568,'交差だけでは接続しません。',10)}${text(800,588,hasChanges?'旧径・標高文字は原図のみ表示。':'原図の径・標高文字を表示。',10)}`;
  b+=`<path d="M20 660H1060" stroke="#25313b" stroke-width=".8"/>${text(40,686,'EXTRACTED VECTOR GEOMETRY / 原図由来の編集図',14)}${text(40,707,'crop [1460, 1500, 2020, 2060] PDF pt · 誤差許容 0.02 PDF pt（現場精度とは別）',10)}${text(40,725,`PDF SHA-256 ${referenceSource.sha256.slice(0,24)}… / 原図で再照合可能`,9)}${text(1015,704,`REV ${revision} / mm`,12,'text-anchor="end"')}</g>`;
  return b;
}
