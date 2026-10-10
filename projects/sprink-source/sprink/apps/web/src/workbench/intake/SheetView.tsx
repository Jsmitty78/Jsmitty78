import { tr } from "../locale.js";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { api, type Snapshot } from "../api.js";
import { lengthText } from "../format.js";
import { Callout, Icon, Spinner } from "../ui.js";
import { imageSize, openPdf, renderPage, type SheetRaster } from "./pdf.js";
import { planToSheet, sheetToPlan, spanLengths, type SheetPoint } from "./sheet.js";
import { planShape, labelFor, type Plan, type Callouts } from "../model.js";
import type { Intake, Rect } from "./useIntake.js";

import type { ShapeOverlay } from "../site/SiteShapeEditor.js";

interface Box { x: number; y: number; w: number; h: number }
const TOOL_HINT: Record<string, string> = {
  area: "Drag a box around the part of the sheet this work covers.",
  calibrate: "Click the two ends of a dimension you can read on the sheet.",
  axis: "Click two points along a line that should run along plan X (for example a grid line).",
  origin: "Click the point that should be the plan origin (0, 0).",
  trace: "Click along the run in order. Each click adds a point; the last one is the end.",
  head: "Click a head. Near a traced end it marks a retained head at that station; elsewhere it is context.",
  context_pipe: "Click the two ends of a context pipe. It stays visible and outside the work.",
};

/**
 * The uploaded sheet in its own units (PDF points or image pixels, Y down), with the intake overlays.
 * The page is drawn by the browser; nothing on it is read automatically.
 */
export function SheetView({ s, intake, readOnly = false, displayPlan, comparisonPlan, selectedIds = [], context, onSelectPiece, callouts, shapeOverlay }: { s: Snapshot; intake: Intake; shapeOverlay?: ShapeOverlay; readOnly?: boolean; displayPlan?: Plan | null; comparisonPlan?: Plan | null; selectedIds?: string[]; context?: ReadonlySet<string>; onSelectPiece?: (id: string | null) => void; callouts?: Callouts }) {
  const d = s.sourceDrawing!;
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [error, setError] = useState("");
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [image, setImage] = useState<{ url: string; width: number; height: number } | null>(null);
  const [overview, setOverview] = useState<SheetRaster | null>(null);
  const [detail, setDetail] = useState<SheetRaster | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const drag = useRef<{ x: number; y: number; box: Box; moved: boolean; start: SheetPoint } | null>(null);
  const [dragRect, setDragRect] = useState<Rect | null>(null);
  const { sheet, setSheet } = intake;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: Math.max(entry.contentRect.width, 50), h: Math.max(entry.contentRect.height, 50) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load the uploaded file once per asset.
  useEffect(() => {
    let live = true, made: string | null = null;
    setDoc(null); setImage(null); setOverview(null); setDetail(null); setError("");
    (async () => {
      const blob = await api.asset(s.id, d.assetId);
      if (blob.type === "application/pdf") {
        const pdf = await openPdf(blob);
        if (live) setDoc(pdf);
      } else {
        const dims = await imageSize(blob);
        made = URL.createObjectURL(blob);
        if (live) { setImage({ url: made, ...dims }); setSheet({ unit: "image_px", width: dims.width, height: dims.height, pages: 1 }); }
      }
    })().catch(e => live && setError(e instanceof Error ? e.message : "Could not open the drawing"));
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [s.id, d.assetId]);

  // PDF: draw the whole page for orientation, and the work area sharply on top of it.
  useEffect(() => {
    if (!doc) return;
    let live = true;
    const page = Math.min(Math.max(d.page, 1), doc.numPages);
    renderPage(doc, page, null, 2400).then(r => {
      if (!live) { URL.revokeObjectURL(r.url); return; }
      setOverview(old => { if (old) URL.revokeObjectURL(old.url); return r; });
      setSheet({ unit: "pdf_pt", width: r.pageWidth, height: r.pageHeight, pages: doc.numPages });
    }).catch(e => live && setError(e instanceof Error ? e.message : "Could not draw the page"));
    return () => { live = false; };
  }, [doc, d.page]);
  const area = intake.workArea;
  useEffect(() => {
    if (!doc || !area) { setDetail(null); return; }
    let live = true;
    const page = Math.min(Math.max(d.page, 1), doc.numPages);
    renderPage(doc, page, area, 4096).then(r => {
      if (!live) { URL.revokeObjectURL(r.url); return; }
      setDetail(old => { if (old) URL.revokeObjectURL(old.url); return r; });
    }).catch(() => undefined);
    return () => { live = false; };
  }, [doc, d.page, area?.x, area?.y, area?.width, area?.height]);

  // Fit the view to the work area when there is one, otherwise the sheet.
  const fitTo = (r: Rect | null) => {
    if (!sheet) return;
    const t = r ?? { x: 0, y: 0, width: sheet.width, height: sheet.height };
    const aspect = size.w / size.h, pad = 1.08;
    let w = t.width * pad, h = t.height * pad;
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    setBox({ x: t.x + t.width / 2 - w / 2, y: t.y + t.height / 2 - h / 2, w, h });
  };
  useEffect(() => { fitTo(area); }, [sheet?.width, sheet?.height, sheet?.unit, size.w > 50]);

  if (error) return <div className="fa-drawing"><Callout tone="red" title={tr("Could not open the drawing")}>{error}</Callout></div>;
  if (!sheet || !box) return <div className="fa-drawing" ref={host}><Spinner label={tr("Opening the drawing…")} /></div>;

  const k = box.w / size.w; // sheet units per screen pixel
  const px = (n: number) => n * k;
  const toSheet = (e: { clientX: number; clientY: number }): SheetPoint => {
    const m = svg.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 };
  };
  const onDown = (e: ReactPointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, box, moved: false, start: toSheet(e) };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
    if (!g.moved) return;
    if (!readOnly && intake.tool === "area") {
      const p = toSheet(e);
      setDragRect({ x: Math.min(p.x, g.start.x), y: Math.min(p.y, g.start.y), width: Math.abs(p.x - g.start.x), height: Math.abs(p.y - g.start.y) });
    } else setBox({ ...g.box, x: g.box.x - dx * k, y: g.box.y - dy * k });
  };
  const onUp = (e: ReactPointerEvent) => {
    const g = drag.current;
    drag.current = null;
    if (!g) return;
    if (!readOnly && intake.tool === "area" && g.moved && dragRect) {
      if (dragRect.width > 0 && dragRect.height > 0) { intake.setWorkArea(dragRect); intake.chooseTool("area"); }
      setDragRect(null);
      return;
    }
    // Half a screen pixel at this zoom, in sheet units: how precisely this click can be placed.
    if (!g.moved) {
      if (readOnly) onSelectPiece?.(document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-piece]")?.getAttribute("data-piece") ?? null);
      else intake.click(toSheet(e), k / 2);
    }
  };
  const zoomBy = (f: number, at?: SheetPoint) => {
    const c = at ?? { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const w = Math.min(Math.max(box.w / f, 1), sheet.width * 4), h = w * (box.h / box.w);
    setBox({ x: c.x - (c.x - box.x) * (w / box.w), y: c.y - (c.y - box.y) * (h / box.h), w, h });
  };

  const t = intake.viewDirty ? intake.draftTransform : intake.savedTransform ?? intake.draftTransform;
  const nodes = intake.trace.nodes;
  const lengths = t ? spanLengths(intake.trace, t) : [];
  const cal = intake.cal;
  const raster = image ? { url: image.url, x: 0, y: 0, width: image.width, height: image.height } : overview;
  // A saved plan that this editor did not draw (typed coordinates, sample) is still shown on the sheet.
  const untraced = !nodes.length && s.baselinePlan && intake.savedTransform ? s.baselinePlan : null;

  return <div className={`fa-sheet tool-${intake.tool}`} ref={host}>
    <svg ref={svg} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} width="100%" height="100%" role="img" aria-label={tr("Drawing {id}, page {page}", { id: d.drawingId, page: d.page })}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={e => zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, toSheet(e))}>
      <rect x={0} y={0} width={sheet.width} height={sheet.height} className="fa-sheet-paper" />
      {raster && <image href={raster.url} x={raster.x} y={raster.y} width={raster.width} height={raster.height} preserveAspectRatio="none" />}
      {detail && <image href={detail.url} x={detail.x} y={detail.y} width={detail.width} height={detail.height} preserveAspectRatio="none" />}
      {area && <rect className="fa-sheet-area" x={area.x} y={area.y} width={area.width} height={area.height} strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`} />}
      {dragRect && <rect className="fa-sheet-area is-drag" x={dragRect.x} y={dragRect.y} width={dragRect.width} height={dragRect.height} strokeWidth={px(1.5)} />}
      {!readOnly && <>
      {cal.a && <g className="fa-sheet-cal">
        {cal.b && <line x1={cal.a.x} y1={cal.a.y} x2={cal.b.x} y2={cal.b.y} strokeWidth={px(2)} />}
        {[cal.a, cal.b].filter(Boolean).map((p, i) => <g key={i} transform={`translate(${p!.x} ${p!.y})`}><line x1={px(-7)} x2={px(7)} strokeWidth={px(1.5)} /><line y1={px(-7)} y2={px(7)} strokeWidth={px(1.5)} /></g>)}
        {cal.b && cal.distance && <text x={(cal.a.x + cal.b.x) / 2 + px(8)} y={(cal.a.y + cal.b.y) / 2 - px(8)} fontSize={px(12)}>{cal.distance} {cal.distanceUnit}</text>}
      </g>}
      {t && <Axes t={t} px={px} />}
      {untraced && t && <g className="fa-sheet-plan">
        {untraced.entities.filter(e => e.kind === "pipe").map(e => {
          const [a, b] = e.ports.map(p => p.position && planToSheet(p.position, t));
          return a && b ? <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={px(3)} /> : null;
        })}
      </g>}
      <g className="fa-sheet-context">
        {intake.trace.context.map((c, i) => c.kind === "pipe"
          ? <line key={i} x1={c.points[0].x} y1={c.points[0].y} x2={c.points[1].x} y2={c.points[1].y} strokeWidth={px(3)} strokeDasharray={`${px(6)} ${px(4)}`} />
          : <HeadMark key={i} at={c.points[0]} px={px} />)}
      </g>
      <g className="fa-sheet-trace">
        {nodes.slice(1).map((n, i) => <line key={i} x1={nodes[i].at.x} y1={nodes[i].at.y} x2={n.at.x} y2={n.at.y} strokeWidth={px(3)} />)}
        {nodes.slice(1).map((n, i) => {
          const len = lengths[i];
          if (len === undefined) return null;
          const txt = lengthText({ value: len, unit: "mm" });
          return <text key={`l${i}`} className="fa-sheet-len" x={(nodes[i].at.x + n.at.x) / 2 + px(8)} y={(nodes[i].at.y + n.at.y) / 2 - px(6)} fontSize={px(11.5)}>
            {intake.trace.pipeLabels[i] ? `${intake.trace.pipeLabels[i]} · ` : `Span ${i + 1} · `}{txt.known ? txt.secondary : "?"}
          </text>;
        })}
        {nodes.map((n, i) => <g key={i} transform={`translate(${n.at.x} ${n.at.y})`} className={`node-${n.kind}`}>
          {n.kind === "elbow" ? <circle r={px(5)} strokeWidth={px(1.5)} /> : n.kind === "interface" ? <rect x={px(-6)} y={px(-6)} width={px(12)} height={px(12)} strokeWidth={px(1.5)} /> : <line x1={px(-7)} x2={px(7)} strokeWidth={px(3)} />}
          {n.head && <HeadMark at={{ x: 0, y: 0 }} px={px} />}
          <text x={px(10)} y={px(16)} fontSize={px(11)}>{i + 1}{n.label ? ` ${n.label}` : ""}</text>
        </g>)}
      </g>
      {intake.pending.map((p, i) => <circle key={i} className="fa-sheet-pending" cx={p.x} cy={p.y} r={px(5)} />)}
      </>}
      {readOnly && intake.savedTransform && [comparisonPlan, displayPlan].map((plan, index) => plan && <g key={`${index}-${plan.id}`} opacity={index === 0 ? .45 : 1}>{planShape(plan, context).segments.map(segment => {
        const a = planToSheet(segment.a, intake.savedTransform!), b = planToSheet(segment.b, intake.savedTransform!);
        const selected = selectedIds.includes(segment.id);
        return <g key={segment.id} data-piece={index === 1 && !segment.context ? segment.id : undefined}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={selected ? "var(--fa-blue-soft)" : "transparent"} strokeWidth={px(18)} />
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={index === 0 || segment.context ? "#7e8b9c" : "var(--fa-blue)"} strokeWidth={px(selected ? 5 : 3)} strokeDasharray={index === 0 ? `${px(6)} ${px(5)}` : undefined} />
          {index === 1 && !segment.context && <text x={(a.x+b.x)/2} y={(a.y+b.y)/2-px(10)} fontSize={px(12)} fill="var(--fa-blue-ink)" stroke="white" strokeWidth={px(3)} paintOrder="stroke">{callouts ? labelFor(callouts, segment.id) : segment.id}</text>}
        </g>;
      })}{planShape(plan, context).markers.map(marker => { const at = planToSheet(marker.at, intake.savedTransform!); return <circle key={marker.id} data-piece={index === 1 && !marker.context ? marker.id : undefined} cx={at.x} cy={at.y} r={px(selectedIds.includes(marker.id) ? 9 : 5)} fill={selectedIds.includes(marker.id) ? "var(--fa-blue)" : "white"} stroke={marker.context ? "#7e8b9c" : "var(--fa-blue)"} strokeWidth={px(2)} />; })}</g>)}
      {shapeOverlay && intake.savedTransform && s.baselinePlan?.coordinateFrame.id === "drawing-plan" && shapeOverlay({ bounds: box, px, fromPlan: p => planToSheet(p, intake.savedTransform!), toPlan: p => sheetToPlan(p, intake.savedTransform!) })}
    </svg>
    {!readOnly && TOOL_HINT[intake.tool] && <div className="fa-sheet-hint" role="status"><Icon name="select" size={14} />{TOOL_HINT[intake.tool]}</div>}
    <details className="fa-sheet-bar"><summary>{d.drawingId}</summary><div>
      <b className="mono">{d.drawingId}</b>{" "}{tr("Rev")}{" "}{d.revision}{" "}{tr("· page")}{" "}{d.page}{sheet.pages > 1 ? ` of ${sheet.pages}` : ""}
      <span className="fa-muted">{sheet.unit === "pdf_pt" ? tr("Sheet units: PDF points") : tr("Sheet units: image pixels")}{t ? ` · ${round(t.scale)} mm per unit` : tr(" · scale not set")}</span>
      {d.view?.derivativeOf && <span className="fa-muted">{tr("Copy of")}{" "}{d.view.derivativeOf}</span>}
    </div></details>
    <div className="fa-zoom" role="toolbar" aria-label={tr("Zoom")}>
      <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label={tr("Zoom out")}><Icon name="minus" /></button>
      <button type="button" onClick={() => zoomBy(1.25)} aria-label={tr("Zoom in")}><Icon name="plus" /></button>
      <button type="button" onClick={() => fitTo(area)} aria-label={tr("Fit to work area")} title={tr("Fit to work area")}><Icon name="fit" /></button>
      {area && <button type="button" onClick={() => fitTo(null)} aria-label={tr("Whole sheet")} title={tr("Whole sheet")}><Icon name="drawing" /></button>}
    </div>
  </div>;
}

function HeadMark({ at, px }: { at: SheetPoint; px: (n: number) => number }) {
  return <g className="fa-sheet-head" transform={`translate(${at.x} ${at.y})`}>
    <circle r={px(9)} strokeWidth={px(1.5)} /><line x1={px(-6)} y1={px(-6)} x2={px(6)} y2={px(6)} strokeWidth={px(1.2)} /><line x1={px(6)} y1={px(-6)} x2={px(-6)} y2={px(6)} strokeWidth={px(1.2)} />
  </g>;
}

/** Plan +X and +Y drawn from the origin, so the frame the plan uses is visible on the sheet. */
function Axes({ t, px }: { t: NonNullable<Intake["draftTransform"]>; px: (n: number) => number }) {
  const o = t.origin, len = px(60) * t.scale;
  const x = planToSheet({ x: len, y: 0 }, t), y = planToSheet({ x: 0, y: len }, t);
  const o2 = planToSheet(sheetToPlan(o, t), t);
  return <g className="fa-sheet-axes">
    <line x1={o2.x} y1={o2.y} x2={x.x} y2={x.y} strokeWidth={px(1.5)} markerEnd="" />
    <line x1={o2.x} y1={o2.y} x2={y.x} y2={y.y} strokeWidth={px(1.5)} />
    <text x={x.x + px(4)} y={x.y + px(4)} fontSize={px(11)}>{tr("+X")}</text>
    <text x={y.x + px(4)} y={y.y + px(4)} fontSize={px(11)}>{tr("+Y")}</text>
    <circle cx={o2.x} cy={o2.y} r={px(3)} />
  </g>;
}

const round = (n: number) => Math.round(n * 10000) / 10000;
