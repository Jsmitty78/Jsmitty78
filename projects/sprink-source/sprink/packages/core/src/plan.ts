import { referenceBody, referenceSource, referenceTransform } from "./reference.js";
/** Millimetres are authoritative; SVG coordinates are presentation only. */
export interface PlanPoint { x: number; y: number }
export interface PlanNode extends PlanPoint { id: string }
export interface PlanPipe { id: string; from: string; to: string; diameter: number; nominalInches?: number }
export interface PlanHead { id: string; nodeId: string; orientation: 'pendent' | 'upright' | 'sideways'; model: string }
export interface PlanWall { id: string; from: PlanPoint; to: PlanPoint; thickness: number }
export interface PlanDoor { id: string; at: PlanPoint; width: number; rotation: number }
export interface PlanRoom extends PlanPoint { id: string; name: string }
export interface DrawingModel {
  version: 1;
  source?: typeof referenceSource;
  width: number;
  height: number;
  nodes: PlanNode[];
  pipes: PlanPipe[];
  heads: PlanHead[];
  walls: PlanWall[];
  doors: PlanDoor[];
  rooms: PlanRoom[];
}
export const drawingReference = 'https://apps.itd.idaho.gov/Apps/NonHwyConstructionProjects/PDFS/FM32361_ITB_Drawings_Fire_Sprinkler_Plan.pdf';
export function exampleDrawing(orientation: string = 'pendent'): DrawingModel {
  const nodes = [2000, 6000, 10000].flatMap((x, i) => [2000, 4000, 6000].map((y, j) => ({id: `N${i * 3 + j + 1}`, x, y})));
  const wall = (id: string, x: number, y: number, xx: number, yy: number): PlanWall => ({id, from:{x,y}, to:{x:xx,y:yy}, thickness:150});
  return {version:1,width:12000,height:8000,nodes,
    pipes: [
      {id:'P1',from:'N2',to:'N1',diameter:25},{id:'P2',from:'N2',to:'N3',diameter:25},
      {id:'P3',from:'N5',to:'N4',diameter:25},{id:'P4',from:'N5',to:'N6',diameter:25},
      {id:'P5',from:'N8',to:'N7',diameter:25},{id:'P6',from:'N8',to:'N9',diameter:25},
      {id:'P7',from:'N2',to:'N5',diameter:65},{id:'P8',from:'N5',to:'N8',diameter:50}],
    heads: ['N1','N3','N4','N6','N7','N9'].map((nodeId,i)=>({id:`H${i+1}`,nodeId,orientation:i===0?orientation as PlanHead['orientation']:'pendent',model:i===0?'TY3231':'UNSPECIFIED'})),
    walls:[wall('W1',0,0,12000,0),wall('W2',12000,0,12000,8000),wall('W3',12000,8000,0,8000),wall('W4',0,8000,0,0),wall('W5',8000,0,8000,3000),wall('W6',8000,4000,8000,8000)],
    doors:[{id:'D1',at:{x:8000,y:3000},width:1000,rotation:90}],
    rooms:[{id:'R1',name:'作業室 / WORKSHOP',x:4000,y:1000},{id:'R2',name:'事務室 / OFFICE',x:10000,y:1000}]
  };
}
export function pipeLength(d: DrawingModel, p: PlanPipe): number {
  const a=d.nodes.find(n=>n.id===p.from)!, b=d.nodes.find(n=>n.id===p.to)!;
  return Math.hypot(b.x-a.x,b.y-a.y);
}
/** Reject malformed geometry before persistence or rendering. No arbitrary SVG is accepted. */
export function validateDrawing(value: unknown): DrawingModel {
  const d=value as DrawingModel;
  const fail=(): never=>{throw new Error('図面データが不正です。寸法・接続先・IDを確認してください。');};
  const num=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
  const str=(s:unknown,max=100)=>typeof s==='string'&&s.length>0&&s.length<=max;
  if(!d||d.version!==1||!num(d.width,1000,100000)||!num(d.height,1000,100000))fail();
  if(d.source && (d.source.id!==referenceSource.id||d.source.sha256!==referenceSource.sha256))fail();
  if(d.source && (Math.abs(d.width-18965.3333)>.01||Math.abs(d.height-18965.3333)>.01))fail();
  const ids=new Set<string>();
  for(const list of [d.nodes,d.pipes,d.heads,d.walls,d.doors,d.rooms]) {
    if(!Array.isArray(list)||list.length>500)fail();
    for(const item of list) {if(!item||!str(item.id,40)||!/^[A-Za-z][A-Za-z0-9_-]*$/.test(item.id)||ids.has(item.id))fail();ids.add(item.id);}
  }
  const point=(p:PlanPoint)=>p&&num(p.x,0,d.width)&&num(p.y,0,d.height);
  if(!d.nodes.every(point))fail();
  const nodes=new Set(d.nodes.map(n=>n.id));
  const pairs=new Set<string>();
  for(const p of d.pipes) {
    if(!nodes.has(p.from)||!nodes.has(p.to)||p.from===p.to||!num(p.diameter,15,300)||pipeLength(d,p)<1)fail();
    if(p.nominalInches!==undefined) {
      const nominalDn:Record<number,number>={.5:15,.75:20,1:25,1.25:32,1.5:40,2:50,2.5:65,3:80,4:100,6:150,8:200,10:250,12:300};
      if(nominalDn[p.nominalInches]!==p.diameter)fail();
    }
    const pair=[p.from,p.to].sort().join(':');if(pairs.has(pair))fail();pairs.add(pair);
  }
  const occupied=new Set<string>();
  for(const h of d.heads) {
    if(!nodes.has(h.nodeId)||occupied.has(h.nodeId)||!['pendent','upright','sideways'].includes(h.orientation)||!str(h.model))fail();
    if(!d.pipes.some(p=>p.from===h.nodeId||p.to===h.nodeId))fail();
    occupied.add(h.nodeId);
  }
  if(!d.heads.some(h=>h.id==='H1')||!d.pipes.some(p=>p.id==='P1'))fail();
  if(!d.walls.every(w=>point(w.from)&&point(w.to)&&num(w.thickness,50,1000)&&Math.hypot(w.to.x-w.from.x,w.to.y-w.from.y)>=1))fail();
  if(!d.doors.every(door=>point(door.at)&&num(door.width,300,3000)&&num(door.rotation,0,360)))fail();
  if(!d.rooms.every(r=>point(r)&&str(r.name,80)))fail();
  // Strip unknown properties, including attempted SVG, rather than persisting user markup.
  return {version:1,width:d.width,height:d.height,...(d.source?{source:structuredClone(referenceSource)}:{}),
    nodes:d.nodes.map(({id,x,y})=>({id,x,y})),pipes:d.pipes.map(({id,from,to,diameter,nominalInches})=>({id,from,to,diameter,...(nominalInches!==undefined?{nominalInches}:{})})),
    heads:d.heads.map(({id,nodeId,orientation,model})=>({id,nodeId,orientation,model})),
    walls:d.walls.map(w=>({id:w.id,from:{x:w.from.x,y:w.from.y},to:{x:w.to.x,y:w.to.y},thickness:w.thickness})),
    doors:d.doors.map(v=>({id:v.id,at:{x:v.at.x,y:v.at.y},width:v.width,rotation:v.rotation})),rooms:d.rooms.map(({id,name,x,y})=>({id,name,x,y}))};
}
export const SHEET = {width:1080,height:760};
export function drawingTransform(d: DrawingModel) {if(d.source)return referenceTransform(d);return {x:100,y:145,scale:Math.min(650/d.width,420/d.height)};}
export const escapeXml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export type DrawingLayers = { architecture: boolean; dimensions: boolean; labels: boolean; grid: boolean; referenceMode?: 'edit' | 'original' | 'overlay'; selectedId?: string };
export const defaultDrawingLayers: DrawingLayers = {architecture:true, dimensions:true,labels:true,grid:false};
export function drawingBody(d: DrawingModel, revision: number, layers=defaultDrawingLayers): string {
  if(d.source)return referenceBody(d,revision,layers);
  const t=drawingTransform(d), s=t.scale;
  const x=(v:number)=>t.x+v*s,y=(v:number)=>t.y+v*s;
  const text=(xx:number,yy:number,value:string,size=10,attrs='')=>`<text x="${xx}" y="${yy}" font-size="${size}" ${attrs}>${escapeXml(value)}</text>`;
  const line=(a:number,b:number,c:number,e:number,attrs='')=>`<path d="M${a} ${b}L${c} ${e}" ${attrs}/>`;
  const symbol=(xx:number,yy:number,o:string)=>o==='sideways'?`<path d="M${xx-6} ${yy-5}L${xx+5} ${yy}L${xx-6} ${yy+5}Z" fill="white"/>`:`<circle cx="${xx}" cy="${yy}" r="5" fill="white"/>${o==='pendent'?line(xx-7,yy+7,xx+7,yy-7):''}`;
  const dim=(a:number,b:number,c:number,e:number,value:string)=>`<g stroke="#66717b" stroke-width=".6">${line(a,b,c,e)}${line(a-3,b+3,a+3,b-3)}${line(c-3,e+3,c+3,e-3)}</g>${text((a+c)/2,(b+e)/2-5,value,9,'text-anchor="middle" paint-order="stroke" stroke="white" stroke-width="4"')}`;
  const pipeDimension=(a:PlanPoint,b:PlanPoint,length:number)=>{
    const dx=x(b.x)-x(a.x),dy=y(b.y)-y(a.y),len=Math.hypot(dx,dy);
    const sign=Math.abs(dy)>Math.abs(dx)?(dy>0?-1:1):(dx<0?-1:1);
    const nx=dy/len*19*sign,ny=-dx/len*19*sign;
    let angle=Math.atan2(dy,dx)*180/Math.PI;if(angle>90||angle< -90)angle+=180;
    return `<g stroke="#a1aab0" stroke-width=".5" fill="none">${line(x(a.x)+nx*.4,y(a.y)+ny*.4,x(a.x)+nx*1.2,y(a.y)+ny*1.2)}${line(x(b.x)+nx*.4,y(b.y)+ny*.4,x(b.x)+nx*1.2,y(b.y)+ny*1.2)}${line(x(a.x)+nx,y(a.y)+ny,x(b.x)+nx,y(b.y)+ny)}${line(x(a.x)+nx-2,y(a.y)+ny+2,x(a.x)+nx+2,y(a.y)+ny-2)}${line(x(b.x)+nx-2,y(b.y)+ny+2,x(b.x)+nx+2,y(b.y)+ny-2)}</g><g transform="translate(${(x(a.x)+x(b.x))/2+nx} ${(y(a.y)+y(b.y))/2+ny}) rotate(${angle})">${text(0,-3,length.toLocaleString('en-US',{maximumFractionDigits:1}),8,'text-anchor="middle" fill="#677780" paint-order="stroke" stroke="white" stroke-width="3"')}</g>`;
  };
  let body=`<rect width="1080" height="760" fill="white"/><g font-family="Arial, Hiragino Kaku Gothic ProN, sans-serif" fill="#25313b"><rect x="20" y="20" width="1040" height="720" fill="none" stroke="#25313b" stroke-width="1.2"/>${text(42,51,'FIELDNOTE  /  FIRE SPRINKLER PLAN',18)}${text(42,73,'平面図 · 単位 mm · 編集用サンプル（現場未照合）',11)}${text(1038,52,`FP-01 / REV ${revision}`,14,'text-anchor="end"')}`;
  if(layers.grid) {body+='<g stroke="#e8edf0" stroke-width=".5">';for(let a=0;a<=d.width;a+=500)body+=line(x(a),y(0),x(a),y(d.height));for(let b=0;b<=d.height;b+=500)body+=line(x(0),y(b),x(d.width),y(b));body+='</g>';}
  body+='<g stroke="#afb6bb" stroke-width=".5" stroke-dasharray="9 3 2 3">';
  for(const a of [0,d.width/2,d.width])body+=line(x(a),y(0)-22,x(a),y(d.height)+25);
  for(const b of [0,d.height/2,d.height])body+=line(x(0)-25,y(b),x(d.width)+20,y(b));body+='</g>';
  [0,d.width/2,d.width].forEach((a,i)=>body+=`<circle cx="${x(a)}" cy="${y(0)-28}" r="8" fill="white" stroke="#879099" stroke-width=".6"/>${text(x(a),y(0)-25,String(i+1),9,'text-anchor="middle"')}`);
  [0,d.height/2,d.height].forEach((b,i)=>body+=`<circle cx="${x(0)-30}" cy="${y(b)}" r="8" fill="white" stroke="#879099" stroke-width=".6"/>${text(x(0)-30,y(b)+3,String.fromCharCode(65+i),9,'text-anchor="middle"')}`);
  if(layers.architecture) {
    body+='<g stroke-linecap="butt">';
    for(const w of d.walls)body+=`<g data-wall="${w.id}">${line(x(w.from.x),y(w.from.y),x(w.to.x),y(w.to.y),`stroke="#8f989f" stroke-width="${w.thickness*s}"`)}${line(x(w.from.x),y(w.from.y),x(w.to.x),y(w.to.y),`stroke="#eceff1" stroke-width="${Math.max(.5,w.thickness*s-1.4)}"`)}</g>`;
    for(const door of d.doors)body+=`<g transform="translate(${x(door.at.x)} ${y(door.at.y)}) rotate(${door.rotation})" fill="none" stroke="#84909a" stroke-width=".7"><path d="M0 0V${-door.width*s}M0 ${-door.width*s}A${door.width*s} ${door.width*s} 0 0 1 ${door.width*s} 0"/></g>`;
    for(const r of d.rooms)body+=text(x(r.x),y(r.y),r.name,10,'text-anchor="middle" fill="#84909a"');body+='</g>';
  }
  for(const p of d.pipes) {
    const a=d.nodes.find(n=>n.id===p.from)!,b=d.nodes.find(n=>n.id===p.to)!,xx=(x(a.x)+x(b.x))/2,yy=(y(a.y)+y(b.y))/2;
    body+=`<g data-pipe="${p.id}"><title>${escapeXml(p.id)} · DN${p.diameter} · ${pipeLength(d,p).toFixed(1)} mm</title>${line(x(a.x),y(a.y),x(b.x),y(b.y),'stroke="transparent" stroke-width="16" pointer-events="stroke"')}${line(x(a.x),y(a.y),x(b.x),y(b.y),`stroke="#253e4e" stroke-width="${p.diameter>=50?2.4:1.4}"`)}${layers.labels?text(xx+6,yy-8,`${p.id}  DN${p.diameter}`,9,'paint-order="stroke" stroke="white" stroke-width="3"'):''}${layers.dimensions?pipeDimension(a,b,pipeLength(d,p)):''}</g>`;
  }
  body+='<g stroke="#253e4e" stroke-width="1.2">';
  for(const n of d.nodes)body+=`<circle data-node="${n.id}" cx="${x(n.x)}" cy="${y(n.y)}" r="2.4" fill="#253e4e"/>`;
  for(const h of d.heads){const n=d.nodes.find(n=>n.id===h.nodeId)!;body+=`<g data-head="${h.id}" data-node="${n.id}"><title>${escapeXml(h.id+' / '+h.model+' / '+h.orientation)}</title><circle cx="${x(n.x)}" cy="${y(n.y)}" r="12" fill="transparent" stroke="none"/>${symbol(x(n.x),y(n.y),h.orientation)}${layers.labels?text(x(n.x)+13,y(n.y)+4,h.id,10,'stroke="white" stroke-width="3" paint-order="stroke"'):''}</g>`;}body+='</g>';
  if(layers.dimensions){body+=dim(x(0),y(0)-48,x(d.width),y(0)-48,`${d.width.toLocaleString('en-US')} mm`);body+=`<g transform="translate(${x(0)-53} ${(y(0)+y(d.height))/2}) rotate(-90)">${dim(-d.height*s/2,0,d.height*s/2,0,`${d.height.toLocaleString('en-US')} mm`)}</g>`;}
  body+=`<path d="M790 90V650" stroke="#c5ccd0" stroke-width=".8"/>${text(813,114,'SYMBOLS / 凡例',12)}`;
  ['pendent','upright','sideways'].forEach((o,i)=>body+=`<g stroke="#253e4e" stroke-width="1.2">${symbol(825,140+i*27,o)}</g>${text(843,144+i*27,['下向き / Pendent','上向き / Upright','横向き / Sideways'][i]!,10)}`);
  body+=`${text(813,242,'PIPE SCHEDULE / 配管',12)}${text(813,266,`区間 ${d.pipes.length} / ヘッド ${d.heads.length}`,10)}${text(813,287,`中心線総長 ${(d.pipes.reduce((sum,p)=>sum+pipeLength(d,p),0)/1000).toFixed(3)} m`,10)}${text(813,323,'DRAWING NOTES',12)}${text(813,347,'寸法値はモデル座標から算出。',10)}${text(813,367,'配管径は呼び径（DN）。',10)}${text(813,387,'交差だけでは接続しません。',10)}${text(813,407,'同じ節点IDで接続を表します。',10)}${text(813,427,'長さは平面中心線の寸法。',10)}${text(813,447,'継手控除・高低差は未算入。',10)}${text(813,485,'REFERENCE',12)}${text(813,509,'Idaho Transportation Dept.',10)}${text(813,527,'FM32361 / FS-01 (2023)',10)}${text(813,548,'記号・図面構成を参照。',10)}${text(813,566,'配置・寸法は独自サンプル。',10)}`;
  const scaleDistance=[100,200,500,1000,2000,5000,10000,20000].filter(v=>v*s<=120).at(-1)??100;
  const scaleLen=scaleDistance*s;
  body+=`<g stroke="#25313b" stroke-width="1">${line(100,618,100+scaleLen,618)}${line(100,612,100,624)}${line(100+scaleLen/2,612,100+scaleLen/2,624)}${line(100+scaleLen,612,100+scaleLen,624)}</g>${text(100,639,'0',9)}${text(100+scaleLen/2,639,String(scaleDistance/2000),9,'text-anchor="middle"')}${text(100+scaleLen,639,`${scaleDistance/1000} m`,9,'text-anchor="middle"')}${text(310,624,'SCALE BAR · 画面上の縮尺は表示倍率に依存',10)}<path d="M20 665H1060M790 665V740" stroke="#25313b" stroke-width=".8"/>${text(42,690,'1F  /  SPRINKLER COORDINATION',14)}${text(42,714,'検討用図面 — 施工図・水理計算・設備全体の適合判定ではありません。',11)}${text(813,690,'FIELDNOTE  /  FP-01',15)}${text(813,715,`REV ${revision}  ·  UNITS: mm`,11)}</g>`;
  return body;
}
export function renderDrawingSvg(d: DrawingModel, revision: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET.width} ${SHEET.height}" role="img" aria-label="スプリンクラー平面図">${d.source?`<metadata>${escapeXml(JSON.stringify({source:d.source,provenance:"reference/itd-mezzanine.json",revision}))}</metadata>`:""}${drawingBody(d,revision)}</svg>`;
}
