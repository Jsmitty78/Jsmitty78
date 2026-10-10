import { adaptationFrame } from '@sprink/core';
import type { Snapshot } from '../api.js';
import { planShape } from '../model.js';
import { Section } from '../ui.js';

/** Orthographic local X/Z projection. It never fills missing heights from a photograph. */
export function SiteSection({ s }: { s: Snapshot }) {
  let frame: ReturnType<typeof adaptationFrame>;
  try { frame = adaptationFrame(s); } catch { return null; }
  const plans = [
    { label: '元の配管', plan: s.baselinePlan, color: '#8b929b' },
    ...(s.outputs.candidates?.candidates ?? []).map((c, i) => ({ label: `案 ${String.fromCharCode(65 + i)}`, plan: c.plan, color: i ? '#b46a26' : '#35635b' })),
  ];
  const lines = plans.flatMap(({ label, plan, color }) => planShape(plan).segments.filter(line => line.a.z !== undefined && line.b.z !== undefined).map(line => ({ label, color, id: line.id, a: frame.toLocal({...line.a,z:line.a.z!}), b: frame.toLocal({...line.b,z:line.b.z!}) })));
  if (!lines.length) return null;
  const value = (field: string) => {
    const f = s.siteFacts.find(f => f.field === field && !f.subjectIds.length);
    const factor = { mm: 1, m: 1000, in: 25.4, ft: 304.8 }[f?.unit as 'mm'];
    return typeof f?.value === 'number' && factor ? f.value * factor : null;
  };
  const boxes = ['workEnvelope', 'duct'].map(id => ({ id, x0:value(`${id}.min.x`), x1:value(`${id}.max.x`), z0:value(`${id}.min.z`), z1:value(`${id}.max.z`) })).filter(b => b.x0 !== null && b.x1 !== null && b.z0 !== null && b.z1 !== null);
  const xs = [...lines.flatMap(l => [l.a.x,l.b.x]), ...boxes.flatMap(b => [b.x0!,b.x1!])];
  const zs = [...lines.flatMap(l => [l.a.z,l.b.z]), ...boxes.flatMap(b => [b.z0!,b.z1!])];
  const xmin = Math.min(...xs), xmax = Math.max(...xs), zmin = Math.min(...zs), zmax = Math.max(...zs);
  const x = (n: number) => 30 + (n-xmin) / Math.max(1,xmax-xmin) * 560;
  const z = (n: number) => 185 - (n-zmin) / Math.max(1,zmax-zmin) * 155;
  const stale = s.outputs.candidates && (s.outputs.candidates.inputRevision !== s.inputRevision || s.outputs.candidates.configVersion !== s.configVersion);
  return <Section title="断面（配管方向 X／高さ Z）"><p>保存した座標の投影です。平面内の迂回は重なって表示されます。{stale?'候補は以前の入力に対する結果です。':''}</p>
    <svg viewBox="0 0 620 225" role="img" aria-label="Site X Z section" style={{width:'100%',display:'block'}}>
      {boxes.map(b=><rect key={b.id} x={x(b.x0!)} y={z(b.z1!)} width={Math.max(0,x(b.x1!)-x(b.x0!))} height={Math.max(0,z(b.z0!)-z(b.z1!))} fill={b.id==='duct'?'#e5b07555':'none'} stroke={b.id==='duct'?'#a36d22':'#8b929b'} strokeDasharray={b.id==='duct'?undefined:'5 4'}/>)}
      {lines.map((l,i)=><line key={`${l.label}-${l.id}`} x1={x(l.a.x)} y1={z(l.a.z)} x2={x(l.b.x)} y2={z(l.b.z)} stroke={l.color} strokeWidth="2" strokeDasharray={i?'7 3':undefined}/>)}
      <text x="30" y="215" fontSize="11">X {Math.round(xmin)}〜{Math.round(xmax)} mm / Z {Math.round(zmin)}〜{Math.round(zmax)} mm</text>
    </svg><p>{plans.map(p=>p.label).join('・')}。ダクトと作業範囲の高さが未確定の場合、その矩形は描画しません。</p>
  </Section>;
}
