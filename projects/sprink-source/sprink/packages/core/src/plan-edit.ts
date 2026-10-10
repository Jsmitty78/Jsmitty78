import { referenceElementIds } from './reference.js';
import type { DrawingModel, PlanPoint, PlanPipe } from './plan.js';
export function newDrawingId(d:DrawingModel,prefix:string):string {
  const ids=new Set([...d.nodes,...d.pipes,...d.heads,...d.walls,...d.doors,...d.rooms].map(v=>v.id));if(d.source)for(const id of referenceElementIds)ids.add(id);let i=1;while(ids.has(`${prefix}${i}`))i++;return `${prefix}${i}`;
}
export function projectToPipe(d:DrawingModel,p:PlanPipe,point:PlanPoint) {
  const a=d.nodes.find(n=>n.id===p.from)!,b=d.nodes.find(n=>n.id===p.to)!;
  const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
  const fraction=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/l2));
  const at={x:a.x+fraction*dx,y:a.y+fraction*dy};return {point:at,distance:Math.hypot(at.x-point.x,at.y-point.y),fraction};
}
export function closestPipe(d:DrawingModel,point:PlanPoint,tolerance:number) {
  return d.pipes.map(pipe=>({pipe,...projectToPipe(d,pipe,point)})).filter(v=>v.distance<=tolerance).sort((a,b)=>a.distance-b.distance)[0];
}
/** Mutates a local clone. Splitting preserves the original ID on the first part. */
export function connectAt(d:DrawingModel,point:PlanPoint,tolerance=1):string {
  const node=d.nodes.find(n=>Math.hypot(n.x-point.x,n.y-point.y)<=tolerance);if(node)return node.id;
  const found=closestPipe(d,point,tolerance),at=found?.point??point,id=newDrawingId(d,'N');
  d.nodes.push({id,x:at.x,y:at.y});
  if(found){const p=found.pipe,oldTo=p.to;const newId=newDrawingId(d,'P');p.to=id;d.pipes.push({...p,id:newId,from:id,to:oldTo});}
  return id;
}
