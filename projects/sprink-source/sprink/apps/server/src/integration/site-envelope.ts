import { adaptationFrame, geometryFactUsable, type PackagePlan, type WorkPackageSnapshot } from '@sprink/core';
import type { CheckResult } from './profiles.js';

/** Conservative box-envelope arithmetic, not a swept-motion or support-design solver. */
export function siteEnvelopeChecks(s: WorkPackageSnapshot, plan: PackagePlan): CheckResult[] {
  if (s.intent !== 'adapt_to_site' || !s.siteWork) return [];
  const number = (field: string) => {
    const f = [...s.siteFacts, ...s.detailing].find(f => f.field === field && !f.subjectIds.length);
    const k = { mm:1, m:1000, in:25.4, ft:304.8 }[f?.unit as 'mm'];
    return f && geometryFactUsable(f) && typeof f.value === 'number' && k ? { value:f.value*k, id:f.id } : null;
  };
  const axes = ['x','y','z'] as const;
  const box = (prefix: string) => { const min=axes.map(a=>number(`${prefix}.min.${a}`)),max=axes.map(a=>number(`${prefix}.max.${a}`));return [...min,...max].every(Boolean)?{min:min.map(v=>v!.value),max:max.map(v=>v!.value),ids:[...min,...max].map(v=>v!.id)}:null; };
  const duct=box('duct'), work=box('workEnvelope');
  let local: ReturnType<typeof adaptationFrame> | null=null;
  try {local=adaptationFrame(s);} catch { /* Inputs remain unknown below. */ }
  const affected = new Set(s.changeRequest?.affectedEntityIds ?? []);
  const unchanged = new Set(s.baselinePlan?.entities.filter(e=>!affected.has(e.id)).map(e=>e.id));
  return ['fittingEnvelopeRadius','assemblyEnvelopeRadius'].map(field=>{
    const radius=number(field), id=`SITE_${field}`, refs=[...(duct?.ids??[]),...(work?.ids??[]),...(radius?[radius.id]:[])];
    const result = (status: CheckResult['status'],reason:string):CheckResult=>({id,subjectIds:[],status,state:'bounded_geometry',reason,sourceRefs:refs});
    if(!radius||!duct||!work||!local)return result('unknown',`${field}: confirmed/synthetic radius, duct, work bounds and frame required. No physical clearance inferred.`);
    if(radius.value<0||axes.some((_,i)=>duct.min[i]>=duct.max[i]||work.min[i]>=work.max[i]))return result('fail',`${field}: invalid radius or box bounds.`);
    const pieces=plan.entities.filter(e=>!unchanged.has(e.id)&&(field==='fittingEnvelopeRadius'?e.kind==='fitting':e.kind==='pipe'||e.kind==='fitting'));
    if(!pieces.length)return result('not_applicable',`${field}: no affected components of this type.`);
    const failed:string[]=[];
    for(const piece of pieces){
      if(piece.ports.some(p=>!p.position))return result('unknown',`${field}: component position missing.`);
      const points=piece.ports.map(p=>{const q=local!.toLocal(p.position!);return [q.x,q.y,q.z];});
      const min=axes.map((_,i)=>Math.min(...points.map(p=>p[i]))-radius.value),max=axes.map((_,i)=>Math.max(...points.map(p=>p[i]))+radius.value);
      const collision=axes.every((_,i)=>min[i]<=duct.max[i]&&max[i]>=duct.min[i]);
      const contained=axes.every((_,i)=>min[i]>=work.min[i]&&max[i]<=work.max[i]);
      if(collision||!contained)failed.push(`${piece.id}: ${collision?'intersects duct':'outside work bounds'}`);
    }
    return result(failed.length?'fail':'pass',`${field}: ${failed.join('; ')||'supplied conservative envelopes fit the modeled bounds and avoid the duct'}. Checks supplied boxes only; product shape, movement and site accuracy need review.`);
  });
}
