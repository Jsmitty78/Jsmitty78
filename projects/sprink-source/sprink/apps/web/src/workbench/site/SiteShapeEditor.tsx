import { tr, useLocale } from "../locale.js";
import { adaptationFrame } from "@sprink/core";
import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from "react";
import type { Common } from "../inputs.js";
import { patchClearing } from "../inputs.js";
import { Button } from "../ui.js";
import { SHAPES, hasFootprint, rectangle, shapePatch, shapeValues, type ShapeId, type Shapes, type XY } from "./shapes.js";
import "./shapes.css";

const labels = { duct: "Obstacle", workEnvelope: "Work boundary" };
export interface Surface { bounds: { x: number; y: number; w: number; h: number }; px: (n: number) => number; fromPlan: (p: XY) => XY; toPlan: (p: XY) => XY }
export type ShapeOverlay = (surface: Surface) => ReactNode;
export function SiteShapeEditor({ s, act, busy, setNotice, enabled, drawingBlocked, interactionKey, children }: Common & { enabled: boolean; drawingBlocked?: boolean; interactionKey: string; children: (overlay: ShapeOverlay | undefined) => ReactNode }) {
  useLocale();
  const [state, setState] = useState(() => ({ revision: s.inputRevision, draft: shapeValues(s), history: [] as Shapes[] }));
  const [mode, setMode] = useState<"off" | "select" | ShapeId>("off");
  const [selected, select] = useState<ShapeId | null>(null);
  const [gesture, setGesture] = useState<{ id: ShapeId; start: XY; before: Shapes; corner: number | null; draw: boolean } | null>(null);
  useEffect(() => {
    setMode("off");
    setGesture(null);
  }, [interactionKey]);
  const latest = useRef(state.draft); latest.current = state.draft;
  const dirty = JSON.stringify(state.draft) !== JSON.stringify(shapeValues(s));
  const conflict = state.revision !== s.inputRevision;
  // A refreshed snapshot is adopted only when there are no local edits.
  if (conflict && (!dirty || !state.history.length) && !gesture) setState({ revision: s.inputRevision, draft: shapeValues(s), history: [] });
  let frame: ReturnType<typeof adaptationFrame> | null = null;
  try { frame = adaptationFrame(s); } catch { /* Invalid frame is explained below. */ }
  const scaleMissing = s.baselinePlan?.coordinateFrame.id === "drawing-plan" && s.sourceDrawing?.scale.basis !== "confirmed_inputs";
  const blocked = !enabled || !!busy || !frame || scaleMissing || conflict || !!drawingBlocked;
  useEffect(() => {
    if (blocked && gesture) {
      setState(old => ({ ...old, draft: gesture.before }));
      setGesture(null);
    }
  }, [blocked, gesture]);
  const edit = (draft: Shapes) => setState(old => ({ ...old, draft, history: [...old.history, old.draft] }));
  const reset = () => { setState({ revision: s.inputRevision, draft: shapeValues(s), history: [] }); setGesture(null); };
  const undo = () => setState(old => old.history.length ? { ...old, draft: old.history.at(-1)!, history: old.history.slice(0, -1) } : old);
  const save = async () => {
    await act("site-shapes", async cur => {
      if (cur.inputRevision !== state.revision) throw new Error(tr("Inputs changed. Discard this draft and retry against the latest inputs."));
      await patchClearing(cur, shapePatch(cur, state.draft), setNotice);
    });
  };
  const overlay: ShapeOverlay = surface => {
    if (!frame || scaleMissing || drawingBlocked || conflict) return null;
    const toLocal = (p: XY) => frame!.toLocal({ ...surface.toPlan(p), z: 0 });
    const toScreen = (p: XY) => surface.fromPlan(frame!.toDrawing({ ...p, z: 0 }));
    const eventPoint = (e: PointerEvent<SVGGElement>) => {
      const svg = e.currentTarget.ownerSVGElement!;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
      const local = toLocal(p);
      return { x: Math.round(local.x * 10) / 10, y: Math.round(local.y * 10) / 10 };
    };
    const active = mode !== "off" && !blocked;
    const stop = (e: PointerEvent<SVGGElement>) => e.stopPropagation();
    const down = (e: PointerEvent<SVGGElement>) => {
      if (!active || e.button !== 0) return;
      stop(e);
      const target = (e.target as Element).closest("[data-shape]");
      const id = mode === "select" ? target?.getAttribute("data-shape") as ShapeId | null : mode;
      select(id);
      if (!id) return;
      const handle = target?.getAttribute("data-corner");
      setGesture({ id, start: eventPoint(e), before: state.draft, corner: handle == null ? null : Number(handle), draw: mode !== "select" });
      e.currentTarget.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent<SVGGElement>) => {
      if (!gesture || !active) return;
      stop(e);
      const p = eventPoint(e), g = gesture, v = g.before[g.id];
      let next: Array<number | null>;
      if (g.draw) next = rectangle(g.start, p, v);
      else if (g.corner !== null) {
        const opposite = [{ x: v[3]!, y: v[4]! }, { x: v[0]!, y: v[4]! }, { x: v[0]!, y: v[1]! }, { x: v[3]!, y: v[1]! }][g.corner];
        next = rectangle(opposite, p, v);
      } else next = v.map((value, i) => value === null || i % 3 === 2 ? value : value + (i % 3 === 0 ? p.x - g.start.x : p.y - g.start.y));
      setState(old => ({ ...old, draft: { ...g.before, [g.id]: next } }));
    };
    const cancel = () => { if (gesture) setState(old => ({ ...old, draft: gesture.before })); setGesture(null); };
    const up = (e: PointerEvent<SVGGElement>) => {
      if (!active) return;
      stop(e);
      if (!gesture) return;
      if (!hasFootprint(latest.current[gesture.id])) cancel();
      else { setState(old => ({ ...old, history: JSON.stringify(old.draft) === JSON.stringify(gesture.before) ? old.history : [...old.history, gesture.before] })); setGesture(null); setMode("select"); }
    };
    return <g className="fa-shape-layer" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} style={{ pointerEvents: active ? "auto" : "none" }}>
      {active && <rect {...{ x: surface.bounds.x, y: surface.bounds.y, width: surface.bounds.w, height: surface.bounds.h }} fill="transparent" />}
      {[...SHAPES].reverse().filter(id => hasFootprint(state.draft[id])).map(id => {
        const v = state.draft[id], points = [{ x: v[0]!, y: v[1]! }, { x: v[3]!, y: v[1]! }, { x: v[3]!, y: v[4]! }, { x: v[0]!, y: v[4]! }].map(toScreen);
        const on = active && selected === id;
        return <g key={id} data-shape={id} style={{ cursor: active ? "move" : undefined }}>
          <polygon points={points.map(p => `${p.x},${p.y}`).join(" ")} fill={id === "duct" ? "#ec99432b" : "var(--fa-blue-soft)"} fillOpacity={id === "workEnvelope" ? 0.2 : 1} stroke={on ? "var(--fa-blue)" : id === "duct" ? "#b86d1d" : "var(--fa-blue)"} strokeWidth={surface.px(on ? 2.5 : 1.5)} strokeDasharray={id === "workEnvelope" ? `${surface.px(6)} ${surface.px(4)}` : undefined} />
          <text x={points[0].x} y={points[0].y - surface.px(12)} fontSize={surface.px(12)} fill="#20354b" paintOrder="stroke" stroke="white" strokeWidth={surface.px(3)} pointerEvents="none">{tr(labels[id])} · {Math.round(v[3]! - v[0]!)} × {Math.round(v[4]! - v[1]!)} mm{v[2] === null || v[5] === null ? ` · ${tr("height unknown")}` : ""}</text>
          {on && points.map((p, i) => <rect key={i} data-shape={id} data-corner={i} x={p.x - surface.px(5)} y={p.y - surface.px(5)} width={surface.px(10)} height={surface.px(10)} fill="white" stroke="var(--fa-blue)" strokeWidth={surface.px(2)} style={{ cursor: "crosshair" }} />)}
        </g>;
      })}
    </g>;
  };
  const v = selected ? state.draft[selected] : null;
  return <div className="fa-shape-editor" tabIndex={0} onKeyDown={e => {
    if ((e.target as Element).closest("input,select,textarea") || busy || mode === "off") return;
    if (e.key === "Escape") { if (gesture) setState(old => ({ ...old, draft: gesture.before })); setGesture(null); setMode("select"); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !gesture) { e.preventDefault(); undo(); }
    if ((e.key === "Delete" || e.key === "Backspace") && selected && !gesture) { e.preventDefault(); edit({ ...state.draft, [selected]: [null, null, null, null, null, null] }); }
  }}>
    {enabled && <div className="fa-shape-tools">
      <div className="fa-actions" role="toolbar" aria-label={tr("Site shapes")}>
        {(["off", "select", "duct", "workEnvelope"] as const).map(m => <button type="button" key={m} aria-pressed={mode === m} disabled={blocked} onClick={() => { setMode(m); if (m === "duct" || m === "workEnvelope") select(m); }}>{tr(m === "off" ? "Pan / drawing tools" : m === "select" ? "Select shape" : m === "duct" ? "Insert obstacle" : "Insert work boundary")}</button>)}
        <Button disabled={!state.history.length || !!busy || !!gesture} onClick={undo}>{tr("Undo")}</Button>
        <Button disabled={!selected || !!busy || !!gesture} onClick={() => selected && edit({ ...state.draft, [selected]: [null, null, null, null, null, null] })}>{tr("Delete")}</Button>
        <Button disabled={!dirty || !!busy || !!gesture} onClick={reset}>{tr("Discard edits")}</Button>
        <Button variant="primary" disabled={!dirty || blocked || !!gesture || SHAPES.some(id => { const v = state.draft[id]; return v[2] !== null && v[5] !== null && v[2]! >= v[5]!; })} busy={busy === "site-shapes"} onClick={() => void save()}>{tr("Save shapes")}</Button>
      </div>
      <small>{drawingBlocked ? tr("Save drawing scale, axes and trace edits before editing site shapes.") : !frame ? tr("Complete the site frame first.") : scaleMissing ? tr("Confirm drawing scale before placing shapes.") : conflict ? tr("Inputs changed while editing. Discard edits to use the latest revision.") : dirty ? tr("Unsaved edits — save shapes to update calculation inputs.") : tr("Saved inputs. Draw a rectangle, then select to move or resize it.")}</small>
      <details className="fa-shape-limits"><summary>{tr("Shape limits")}</summary><small>{tr("One obstacle and one work boundary. Shapes follow the site X/Y axes; rotation is not supported. Height stays unknown until entered.")}</small></details>
      {mode !== "off" && <div className="fa-shape-inspector">{v && selected && hasFootprint(v) ? <div className="fa-shape-properties" aria-label={tr("{shape} dimensions", { shape: tr(labels[selected]) })}>
        <b>{tr(labels[selected])} · mm</b>
        {(["X", "Y", "Width", "Depth", "Bottom Z", "Top Z"] as const).map((label, i) => {
          const value = i < 2 ? v[i] : i === 2 ? v[3]! - v[0]! : i === 3 ? v[4]! - v[1]! : v[i === 4 ? 2 : 5];
          return <label key={label}>{tr(label)}<input aria-label={tr("Shape {dimension}", { dimension: tr(label) })} type="number" step="any" disabled={blocked} value={value === null ? "" : Math.round(value * 1e4) / 1e4} placeholder={tr("Unknown")} onChange={e => {
            const n = e.target.value === "" ? null : Number(e.target.value); if (n !== null && !Number.isFinite(n)) return;
            const next = [...v];
            if (i < 2) { if (n === null) return; next[i + 3] = v[i + 3]! + n - v[i]!; next[i] = n; }
            else if (i < 4) { if (n === null || n <= 0) return; next[i + 1] = v[i - 2]! + n; }
            else next[i === 4 ? 2 : 5] = n;
            edit({ ...state.draft, [selected]: next });
          }} /></label>;
        })}
        <small>{v[2] !== null && v[5] !== null && v[2] >= v[5] ? `${tr("Top Z must be above Bottom Z.")} ` : ""}{tr("Changed values are unverified. Review measurements and evidence in Site evidence.")}</small>
      </div> : <small>{tr("Select a shape to adjust its dimensions. Drag on the canvas to insert.")}</small>}</div>}
    </div>}
    {children(enabled ? overlay : undefined)}
  </div>;
}
