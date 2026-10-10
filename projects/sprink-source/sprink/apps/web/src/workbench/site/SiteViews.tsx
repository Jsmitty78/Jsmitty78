import { tr } from "../locale.js";
import "./site.css";
import type { Snapshot } from "../api.js";
import { lengthText } from "../format.js";
import { contextIds, readBox, siteFrameOf } from "../model.js";

/**
 * Plan (X-Y) and elevation (X-Z) of the site geometry as entered: the span, the obstacle and the work
 * boundary. Along a site frame the views are in that frame; otherwise in the plan frame. Boxes are
 * drawn from saved values; dashed when not confirmed.
 */
export function SiteViews({ s }: { s: Snapshot }) {
  const site = siteFrameOf(s);
  const frame = site && !site.reason ? site : null;
  const plan = s.baselinePlan;
  const context = contextIds(s);
  const pipes = (plan?.entities ?? []).filter(e => e.kind === "pipe" && !context.has(e.id)).flatMap(e => {
    const [a, b] = [e.ports[0]?.position, e.ports.at(-1)?.position];
    if (!a || !b) return [];
    const [p, q] = frame ? [frame.toLocal!(a), frame.toLocal!(b)] : [a, b];
    return [{ id: e.id, a: p, b: q, pinned: !!frame && Math.abs(frame.toLocal!(a).y) < 1 && Math.abs(frame.toLocal!(b).y) < 1 }];
  });
  const boxes = (["workEnvelope", "duct"] as const).map(prefix => ({ prefix, ...readBox(s, prefix) })).filter(b => b.box);
  if (!pipes.length && !boxes.length) return <p className="fa-muted">{tr("The views appear once the run or a box is saved.")}</p>;
  if (site && !frame) return <p className="fa-warn small">{site.reason}</p>;

  const view = (u: "x", v: "y" | "z", title: string) => {
    const pts = [...pipes.flatMap(p => [p.a, p.b]), ...boxes.flatMap(b => [b.box!.min, b.box!.max])];
    const minU = Math.min(...pts.map(p => p[u])), maxU = Math.max(...pts.map(p => p[u]));
    const minV = Math.min(...pts.map(p => p[v])), maxV = Math.max(...pts.map(p => p[v]));
    const W = 320, H = 150, pad = 26;
    const k = Math.min((W - 2 * pad) / Math.max(maxU - minU, 1), (H - 2 * pad) / Math.max(maxV - minV, 1));
    const X = (n: number) => pad + (n - minU) * k, Y = (n: number) => H - pad - (n - minV) * k;
    const mm = (n: number) => lengthText({ value: n, unit: "mm", basis: "confirmed_inputs" }).primary;
    return <figure className="fa-siteview">
      <figcaption>{tr(title)}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr(title)}>
        <line className="axis" x1={X(0)} y1={H - 6} x2={X(0)} y2={6} opacity={minU <= 0 && maxU >= 0 ? 1 : 0} />
        <line className="axis" x1={6} y1={Y(0)} x2={W - 6} y2={Y(0)} opacity={minV <= 0 && maxV >= 0 ? 1 : 0} />
        {boxes.map(b => <g key={b.prefix} className={`box ${b.prefix} ${b.confirmed ? "" : "is-draft"}`}>
          <rect x={X(b.box!.min[u])} y={Y(b.box!.max[v])} width={(b.box!.max[u] - b.box!.min[u]) * k} height={(b.box!.max[v] - b.box!.min[v]) * k} />
          {b.prefix === "duct" && <text x={X((b.box!.min[u] + b.box!.max[u]) / 2)} y={Y(b.box!.max[v]) - 4} textAnchor="middle">{tr("Duct")}{" "}{mm(b.box!.max[u] - b.box!.min[u])} × {mm(b.box!.max[v] - b.box!.min[v])}</text>}
        </g>)}
        {pipes.map(p => <line key={p.id} className={`pipe ${p.pinned ? "is-pinned" : ""}`} x1={X(p.a[u])} y1={Y(p.a[v])} x2={X(p.b[u])} y2={Y(p.b[v])} />)}
        <text className="lbl" x={W - 8} y={Y(0) - 4} textAnchor="end">{frame ? tr("X") : tr("plan X")}</text>
        <text className="lbl" x={X(0) + 4} y={12}>{v === "z" ? tr("Z") : frame ? tr("Y") : tr("plan Y")}</text>
      </svg>
    </figure>;
  };
  return <div className="fa-siteviews">
    {view("x", "y", frame ? "Plan (X-Y, +Y to the left of the pipe)" : "Plan (plan X-Y)")}
    {view("x", "z", frame ? "Elevation (X-Z, pipe at Z = 0)" : "Elevation (plan X-Z)")}
    <p className="fa-muted small">{tr("Orange: obstacle. Blue: work boundary. Faded, dashed boxes are saved but not confirmed.")}</p>
  </div>;
}
