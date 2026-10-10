import { tr } from "./locale.js";
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { lengthText, type Quantity } from "./format.js";
import { callouts as makeCallouts, planShape, type Box, type Callouts, type Plan, type Point, type RouteOption } from "./model.js";
import { Icon } from "./ui.js";

import type { ShapeOverlay } from "./site/SiteShapeEditor.js";

export interface CanvasProps {
  shapeOverlay?: ShapeOverlay;
  highlightedIds?: string[];
  hideOriginal?: boolean;
  mode: "prepare" | "adapt";
  baseline: Plan | null;
  routes: RouteOption[];
  /** Routes generated for older inputs: drawn faded, none shown as the working route. */
  staleRoutes?: boolean;
  /** The route shown solid: the previewed one, or the selected one. */
  focusRouteId: string | null;
  selectedRouteId: string | null;
  duct: Box | null;
  envelope: Box | null;
  boxToDrawing?: (p: { x: number; y: number; z: number }) => { x: number; y: number; z: number };
  affectedIds: string[];
  cuts: Map<string, Quantity>;
  calloutsFor: (plan: Plan) => Callouts;
  selectedPiece: string | null;
  onSelectPiece: (id: string | null) => void;
  onSelectRoute?: (planId: string) => void;
  tool: "select" | "pan";
  empty?: ReactNode;
  /** Entities outside the package scope: drawn as retained context, never selectable work. */
  context?: ReadonlySet<string>;
}

interface View { cx: number; cy: number; zoom: number }
const PAD = 0.2;

/** Plan view in the package's own mm frame (y up). Draws what the server's plans contain, nothing more. */
export function PlanCanvas(props: CanvasProps) {
  const { mode, baseline, routes, focusRouteId, selectedRouteId, duct, envelope, cuts, selectedPiece, onSelectPiece, tool } = props;
  const patternId = useId().replace(/:/g, "");
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [view, setView] = useState<View | null>(null);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: Math.max(entry.contentRect.width, 50), h: Math.max(entry.contentRect.height, 50) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const context = props.context;
  const baseShape = useMemo(() => planShape(baseline, context), [baseline, context]);
  const routeShapes = useMemo(() => routes.map(r => ({ route: r, shape: planShape(r.plan, context) })), [routes, context]);

  const protectedIds = new Set(mode === "adapt" && props.affectedIds.length ? baseline?.entities.filter(e => !props.affectedIds.includes(e.id)).map(e => e.id) : []);
  const boxPoints = (b: Box) => [b.min, { ...b.min, x: b.max.x }, b.max, { ...b.max, x: b.min.x }].map(p => props.boxToDrawing?.(p) ?? p);
  const polygon = (b: Box) => boxPoints(b).map(p => `${p.x},${-p.y}`).join(" ");
  const boxLabel = (b: Box) => boxPoints(b)[2];
  const fit = useMemo(() => {
    const pts: Point[] = [];
    for (const s of [baseShape, ...routeShapes.map(r => r.shape)]) {
      s.segments.filter(g => !protectedIds.has(g.id)).forEach(g => pts.push(g.a, g.b));
      s.markers.filter(m => !protectedIds.has(m.id)).forEach(m => pts.push(m.at));
    }
    for (const b of [duct, envelope]) if (b) pts.push(...boxPoints(b));
    if (!pts.length) return null;
    const xs = pts.map(p => p.x), ys = pts.map(p => -p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = Math.max(maxX - minX, 300), h = Math.max(maxY - minY, 300);
    const aspect = size.w / size.h;
    let vw = w * (1 + PAD * 2), vh = h * (1 + PAD * 2);
    if (vw / vh < aspect) vw = vh * aspect; else vh = vw / aspect;
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, vw, vh };
  }, [baseShape, routeShapes, duct, envelope, size, props.boxToDrawing, props.affectedIds]);

  const v = view ?? (fit ? { cx: fit.cx, cy: fit.cy, zoom: 1 } : null);
  if (!fit || !v) return <div className="fa-canvas fa-canvas-empty" ref={host}>{props.empty}</div>;
  const vw = fit.vw / v.zoom, vh = fit.vh / v.zoom;
  const k = vw / size.w; // plan mm per screen pixel
  const px = (n: number) => n * k;

  const zoomBy = (factor: number) => setView({ ...v, zoom: Math.min(40, Math.max(0.25, v.zoom * factor)) });
  const onDown = (e: ReactPointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, view: v, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setView({ ...d.view, cx: d.view.cx - dx * k, cy: d.view.cy - dy * k });
  };
  const onUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && tool === "select") {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-piece],[data-route]");
      if (!target) onSelectPiece(null);
      else if (target.getAttribute("data-route") && props.onSelectRoute) props.onSelectRoute(target.getAttribute("data-route")!);
      else if (target.getAttribute("data-piece")) onSelectPiece(target.getAttribute("data-piece"));
    }
  };

  const Y = (p: Point) => -p.y;
  const baseCallouts = baseline ? props.calloutsFor(baseline) : makeCallouts(null);
  const focus = props.staleRoutes ? undefined : routeShapes.find(r => r.route.plan.id === focusRouteId);
  const others = routeShapes.filter(r => props.staleRoutes || r.route.plan.id !== focusRouteId);
  const baselineIsWork = mode === "prepare" || !routes.length || !!props.staleRoutes;

  const drawPieces = (shape: ReturnType<typeof planShape>, c: Callouts, cls: string, interactive: boolean) => (
    <g className={cls}>
      {shape.segments.filter(s => s.context).map(s => <line key={s.id} className="fa-context-pipe" x1={s.a.x} y1={Y(s.a)} x2={s.b.x} y2={Y(s.b)} />)}
      {shape.segments.filter(s => !s.context).map(s => {
        const on = interactive && (s.id === selectedPiece || props.highlightedIds?.includes(s.id));
        return <g key={s.id} data-piece={interactive ? s.id : undefined} className={`${on ? "is-on" : ""} ${protectedIds.has(s.id) ? "fa-protected" : ""}`}>
          {on && <line className="fa-halo" x1={s.a.x} y1={Y(s.a)} x2={s.b.x} y2={Y(s.b)} />}
          <line className="fa-hit" x1={s.a.x} y1={Y(s.a)} x2={s.b.x} y2={Y(s.b)} />
          <line className="fa-pipe" x1={s.a.x} y1={Y(s.a)} x2={s.b.x} y2={Y(s.b)} />
        </g>;
      })}
      {shape.markers.map(m => <g key={m.id} data-piece={interactive ? m.id : undefined} className={`${protectedIds.has(m.id) ? "fa-protected" : ""} ${(m.id === selectedPiece || props.highlightedIds?.includes(m.id)) ? "is-on" : ""}`}>{m.kind === "tie_in"
        ? <rect key={m.id} className="fa-tie" x={m.at.x - px(6)} y={Y(m.at) - px(6)} width={px(12)} height={px(12)} />
        : m.kind === "fitting" ? <circle key={m.id} className="fa-fit" cx={m.at.x} cy={Y(m.at)} r={px(5)} /> : <circle key={m.id} className={`fa-head ${m.context ? "is-context" : ""}`} cx={m.at.x} cy={Y(m.at)} r={px(m.context ? 9 : 6)} />}</g>)}
      {interactive && shape.segments.filter(s => !s.context && !protectedIds.has(s.id)).map(s => {
        const mx = (s.a.x + s.b.x) / 2, my = (Y(s.a) + Y(s.b)) / 2;
        const label = c.piece.get(s.id) ?? "?";
        const on = (s.id === selectedPiece || props.highlightedIds?.includes(s.id));
        const unknown = cuts.has(s.id) && !lengthText(cuts.get(s.id)).known;
        const horizontal = Math.abs(s.b.x - s.a.x) >= Math.abs(Y(s.b) - Y(s.a));
        const ox = horizontal ? 0 : px(16), oy = horizontal ? -px(16) : 0;
        return <g key={`t-${s.id}`} data-piece={s.id} role="button" tabIndex={0} aria-label={tr("Select part {part}", { part: label })} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectPiece(s.id); } }} className={`fa-tag ${on ? "is-on" : ""} ${unknown ? "is-unknown" : ""}`} transform={`translate(${mx + ox} ${my + oy})`}>
          <rect x={px(-11)} y={px(-9)} width={px(22)} height={px(18)} rx={px(3)} />
          <text y={px(4)} fontSize={px(11)}>{label}</text>
        </g>;
      })}
      {interactive && size.w >= 560 && shape.markers.filter(m => !protectedIds.has(m.id)).map(m => {
        const label = c.fitting.get(m.id) ?? c.tieIn.get(m.id);
        return label ? <text key={`l-${m.id}`} className="fa-mlabel" x={m.at.x + px(9)} y={Y(m.at) + px(16)} fontSize={px(10.5)}>{label}</text> : null;
      })}
    </g>
  );

  const sel = [focus?.shape, baselineIsWork ? baseShape : undefined].filter(Boolean).flatMap(s => s!.segments).find(s => s.id === selectedPiece);
  const selCut = sel ? lengthText(cuts.get(sel.id)) : null;
  const selPlan = focus && focus.shape.segments.some(s => (s.id === selectedPiece || props.highlightedIds?.includes(s.id))) ? focus.route.plan : baseline;
  const selLabel = sel && selPlan ? props.calloutsFor(selPlan).piece.get(sel.id) : null;

  return (
    <div className={`fa-canvas tool-${tool}`} ref={host}>
      <svg viewBox={`${v.cx - vw / 2} ${v.cy - vh / 2} ${vw} ${vh}`} width="100%" height="100%" role="img" aria-label={tr("Plan view of the run")}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        onWheel={e => zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12)}>
        <defs>
          <pattern id={`${patternId}-grid`} width="500" height="500" patternUnits="userSpaceOnUse"><path d="M500 0H0V500" className="fa-grid" /></pattern>
          <pattern id={`${patternId}-hatch`} width={px(8)} height={px(8)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2={px(8)} className="fa-hatch" /></pattern>
        </defs>
        <rect x={v.cx - vw} y={v.cy - vh} width={vw * 2} height={vh * 2} fill={`url(#${patternId}-grid)`} />
        {envelope && !props.shapeOverlay && <g className="fa-envelope">
          <polygon points={polygon(envelope)} />
          <text x={boxLabel(envelope).x + px(8)} y={-boxLabel(envelope).y + px(16)} fontSize={px(11)}>{tr("Work boundary")}</text>
        </g>}
        {duct && !props.shapeOverlay && <g className="fa-duct">
          <polygon points={polygon(duct)} style={{ fill: `url(#${patternId}-hatch)` }} />
          <text x={boxLabel(duct).x} y={-boxLabel(duct).y - px(8)} fontSize={px(11.5)}>{tr("Duct")}</text>
        </g>}
        {baseline && (!props.hideOriginal || !focus) && (baselineIsWork ? drawPieces(baseShape, baseCallouts, "fa-work", true) : drawPieces(baseShape, baseCallouts, "fa-existing", false))}
        {others.map(({ route, shape }) => <g key={route.plan.id} data-route={route.plan.id} className={`fa-alt ${props.staleRoutes ? "is-stale" : ""}`}>
          {drawPieces(shape, props.calloutsFor(route.plan), "", false)}
          <RouteBadge shape={{ ...shape, segments: shape.segments.filter(s => !protectedIds.has(s.id)) }} letter={route.letter} px={px} Y={Y} />
        </g>)}
        {focus && <g className={`fa-focus ${focus.route.plan.id === selectedRouteId ? "is-selected" : ""}`}>
          {drawPieces(focus.shape, props.calloutsFor(focus.route.plan), "fa-work", true)}
          <RouteBadge shape={{ ...focus.shape, segments: focus.shape.segments.filter(s => !protectedIds.has(s.id)) }} letter={focus.route.letter} px={px} Y={Y} filled />
        </g>}
        {duct && !props.shapeOverlay && mode === "adapt" && <g className="fa-obstruction" transform={`translate(${boxLabel(duct).x} ${-boxLabel(duct).y})`}>
          <circle r={px(9)} /><text y={px(4)} fontSize={px(12)}>!</text>
          <text className="fa-obstruction-label" x={px(14)} y={px(4)} fontSize={px(11)}>{tr("Obstruction")}</text>
        </g>}
        {sel && selCut && <g className="fa-callout" transform={`translate(${(sel.a.x + sel.b.x) / 2} ${(Y(sel.a) + Y(sel.b)) / 2})`}>
          <rect x={px(18)} y={px(12)} width={px(Math.max(160, 24 + `Piece ${selLabel} · Cut ${selCut.primary}`.length * 7.4))} height={px(38)} rx={px(4)} />
          <text x={px(28)} y={px(28)} fontSize={px(11)} className="strong">{tr("Piece")}{" "}{selLabel}{" "}{tr("· Cut")}{" "}{selCut.primary}</text>
          <text x={px(28)} y={px(43)} fontSize={px(10)}>{selCut.known ? selCut.secondary : tr("Server could not size this piece")}</text>
        </g>}
        {props.shapeOverlay?.({ bounds: { x: v.cx - vw / 2, y: v.cy - vh / 2, w: vw, h: vh }, px, fromPlan: p => ({ x: p.x, y: -p.y }), toPlan: p => ({ x: p.x, y: -p.y }) })}
      </svg>
      <details className="fa-legend" aria-label={tr("Legend")}><summary>{tr("Legend")}</summary><div>
        {mode === "adapt" && routes.length > 0 && props.staleRoutes ? <>
          <span><i className="lg-route" />{tr("Existing run")}</span><span><i className="lg-alt" />{tr("Routes from older inputs")}</span>
        </> : mode === "adapt" && routes.length > 0 ? <>
          <span><i className="lg-route" />{tr("Route")}{" "}{focus?.route.letter ?? tr("A")}{focus && focus.route.plan.id === selectedRouteId ? tr(" (selected)") : tr(" (preview)")}</span>
          {others.length > 0 && <span><i className="lg-alt" />{tr("Other routes")}</span>}
          {!props.hideOriginal && <span><i className="lg-existing" />{tr("Existing route")}</span>}
        </> : <span><i className="lg-route" />{tr("Run")}</span>}
        {baseShape.markers.some(m => m.context) || baseShape.segments.some(s => s.context) ? <span><i className="lg-context" />{tr("Retained context")}</span> : null}
        {mode === "adapt" && <span><i className="lg-existing" />{tr("Protected context")}</span>}
        {duct && <span><i className="lg-duct" />{tr("Duct (saved input)")}</span>}
        {envelope && <span><i className="lg-env" />{tr("Work boundary")}</span>}
      </div></details>
      <div className="fa-zoom" role="toolbar" aria-label={tr("Zoom")}>
        <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label={tr("Zoom out")}><Icon name="minus" /></button>
        <span>{Math.round(v.zoom * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.25)} aria-label={tr("Zoom in")}><Icon name="plus" /></button>
        <button type="button" onClick={() => setView(null)} aria-label={tr("Fit to view")}><Icon name="fit" /></button>
      </div>
      {baseShape.undrawable.length > 0 && <div className="fa-canvas-note">{baseShape.undrawable.length}{" "}{tr("item(s) have no known position and are not drawn.")}</div>}
    </div>
  );
}

function RouteBadge({ shape, letter, px, Y, filled }: { shape: ReturnType<typeof planShape>; letter: string; px: (n: number) => number; Y: (p: Point) => number; filled?: boolean }) {
  const s = shape.segments[Math.floor(shape.segments.length / 2)];
  if (!s) return null;
  // A quarter of the way along the middle segment, clear of the piece tag at its midpoint.
  const x = s.a.x + (s.b.x - s.a.x) * 0.25, y = Y(s.a) + (Y(s.b) - Y(s.a)) * 0.25;
  const vertical = Math.abs(s.b.x - s.a.x) < Math.abs(Y(s.b) - Y(s.a));
  return <g className={`fa-badge ${filled ? "is-filled" : ""}`} transform={`translate(${vertical ? x + px(44) : x} ${vertical ? y : y - px(20)})`}>
    <rect x={px(-30)} y={px(-11)} width={px(60)} height={px(22)} rx={px(11)} />
    <text y={px(4)} fontSize={px(11)}>{tr("Route")}{" "}{letter}</text>
  </g>;
}
