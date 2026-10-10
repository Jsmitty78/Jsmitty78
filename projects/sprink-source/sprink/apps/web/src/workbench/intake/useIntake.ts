import { useEffect, useMemo, useRef, useState } from "react";
import type { DrawingView } from "@sprink/core";
import type { Snapshot } from "../api.js";
import { findFact } from "../model.js";
import {
  emptyTrace, parseRatioNumber, scaleFromPrinted, scaleFromTwoPoints, sheetDistance, traceFromPlan, transformOf,
  type LengthUnit, type SheetPoint, type Trace, type TraceNodeKind, type ViewTransform,
} from "./sheet.js";

export type IntakeTool = "pan" | "area" | "calibrate" | "axis" | "origin" | "trace" | "head" | "context_pipe";
export interface Rect { x: number; y: number; width: number; height: number }
export interface CalibrationDraft {
  method: "two_point" | "printed_scale";
  a: SheetPoint | null; b: SheetPoint | null;
  distance: string; distanceUnit: LengthUnit;
  paper: string; paperUnit: LengthUnit; real: string; realUnit: LengthUnit;
  reference: string;
}
export interface SheetInfo { unit: DrawingView["sheetUnit"]; width: number; height: number; pages: number }

const draftKey = (id: string) => `sprink.intake.${id}`;

/**
 * The drawing-intake state both the sheet (where the user clicks) and the panel (where they type)
 * read. Everything saved lives in the work package; the draft trace is also kept in this browser so a
 * reload before saving does not lose clicked points.
 */
export function useIntake(s: Snapshot | null) {
  const d = s?.sourceDrawing ?? null;
  const view = d?.view;
  const [tool, setTool] = useState<IntakeTool>("pan");
  const [sheet, setSheet] = useState<SheetInfo | null>(null);
  const [pending, setPending] = useState<SheetPoint[]>([]);
  const [workArea, setWorkArea] = useState<Rect | null>(view?.workArea ?? null);
  const [cal, setCal] = useState<CalibrationDraft>(() => calibrationDraft(view));
  const [origin, setOrigin] = useState<SheetPoint | null>(view?.frame.origin ?? null);
  const [rotation, setRotation] = useState(String(view?.frame.rotationDeg ?? 0));
  const [pickTolerance, setPickTolerance] = useState<number>(() => savedTolerance(view, d?.scale.value ?? null));
  const [trace, setTraceState] = useState<Trace>(() => initialTrace(s));
  const [traceDirty, setTraceDirty] = useState(() => restoredDraft(s) !== null);
  const [viewDirty, setViewDirty] = useState(false);

  // A newer saved revision replaces what is shown, unless the user has unsaved edits of that part.
  const revision = s?.inputRevision;
  const asset = d?.assetId;
  const seen = useRef<string | undefined>(undefined);
  const seenSource = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!s || seen.current === `${s.id}:${revision}`) return;
    seen.current = `${s.id}:${revision}`;
    const sourceKey = `${s.id}:${asset}:${d?.page}`;
    const sourceChanged = seenSource.current !== undefined && seenSource.current !== sourceKey;
    seenSource.current = sourceKey;
    if (sourceChanged) {
      setTraceDirty(false); setViewDirty(false); setTool("pan"); setPending([]);
      try { localStorage.removeItem(draftKey(s.id)); } catch { /* ignore */ }
    }
    if (!viewDirty || sourceChanged) {
      setWorkArea(view?.workArea ?? null); setCal(calibrationDraft(view)); setOrigin(view?.frame.origin ?? null);
      setRotation(String(view?.frame.rotationDeg ?? 0)); setPickTolerance(savedTolerance(view, d?.scale.value ?? null));
    }
    if (!traceDirty || sourceChanged) {
      setTraceState(initialTrace(s));
      setTraceDirty(restoredDraft(s) !== null);
    }
    if (s.baselinePlan?.confirmation === "confirmed" || d?.approval === "approved") { setTool("pan"); setPending([]); }
  }, [s?.id, revision, asset, d?.page]);

  const setTrace = (next: Trace) => {
    setTraceState(next); setTraceDirty(true);
    if (s) try { localStorage.setItem(draftKey(s.id), JSON.stringify({ assetId: asset, page: d?.page, trace: next })); } catch { /* storage unavailable */ }
  };
  const markTraceSaved = () => { setTraceDirty(false); if (s) try { localStorage.removeItem(draftKey(s.id)); } catch { /* ignore */ } };
  const markViewSaved = () => setViewDirty(false);
  const touchView = () => setViewDirty(true);

  const scale = useMemo(() => {
    if (cal.method === "two_point") {
      const v = Number(cal.distance);
      return cal.a && cal.b && v > 0 ? scaleFromTwoPoints(cal.a, cal.b, v, cal.distanceUnit) : null;
    }
    if (sheet?.unit !== "pdf_pt") return null;
    const paper = parseRatioNumber(cal.paper), real = parseRatioNumber(cal.real);
    return paper && real ? scaleFromPrinted({ value: paper, unit: cal.paperUnit }, { value: real, unit: cal.realUnit }) : null;
  }, [cal, sheet?.unit]);

  const rotationDeg = Number.isFinite(Number(rotation)) && Math.abs(Number(rotation)) <= 360 ? Number(rotation) : null;
  const effectiveOrigin = origin ?? (workArea ? { x: workArea.x, y: workArea.y } : { x: 0, y: 0 });
  /** The transform the user is editing; may differ from the saved one until they save. */
  const draftTransform: ViewTransform | null = scale && rotationDeg !== null ? { scale, origin: effectiveOrigin, rotationDeg } : null;
  const savedTransform = transformOf(view, d?.scale.value ?? null);

  /** A click on the sheet, in sheet units, with the pick tolerance at the current zoom. */
  const click = (p: SheetPoint, tolerance: number) => {
    const addTolerance = () => setPickTolerance(t => Math.max(t, tolerance));
    if (s?.baselinePlan?.confirmation === "confirmed" || d?.approval === "approved") return;
    switch (tool) {
      case "calibrate": {
        const next = cal.a && !cal.b ? { ...cal, b: p } : { ...cal, a: p, b: null };
        setCal(next); touchView(); addTolerance();
        if (next.b) setTool("pan");
        return;
      }
      case "axis": {
        const pts = [...pending, p];
        if (pts.length < 2) { setPending(pts); return; }
        setPending([]);
        const dx = pts[1].x - pts[0].x, dy = -(pts[1].y - pts[0].y);
        if (dx || dy) { setRotation(String(Math.round((-Math.atan2(dy, dx) * 180 / Math.PI) * 1e6) / 1e6)); touchView(); }
        setTool("pan");
        return;
      }
      case "origin": setOrigin(p); touchView(); setTool("pan"); return;
      case "trace": {
        // The new point is the run's end; the previous end (unless it is the start) becomes a turn.
        const nodes = [...trace.nodes];
        const prevEnd = nodes.length >= 2 ? nodes[nodes.length - 1] : null;
        if (prevEnd) nodes[nodes.length - 1] = { ...prevEnd, kind: "elbow", head: false, label: "" };
        const kind: TraceNodeKind = prevEnd?.kind === "open_end" ? "open_end" : "interface";
        nodes.push({ kind, at: p, head: prevEnd?.head ?? false, label: prevEnd?.label ?? "" });
        const pipeLabels = [...trace.pipeLabels];
        while (pipeLabels.length < nodes.length - 1) pipeLabels.push("");
        setTrace({ ...trace, nodes, pipeLabels }); addTolerance();
        return;
      }
      case "head": {
        const reach = tolerance * 8;
        const end = trace.nodes.findIndex((n, i) => (i === 0 || i === trace.nodes.length - 1) && n.kind !== "elbow" && sheetDistance(n.at, p) <= reach);
        if (end >= 0) setTrace({ ...trace, nodes: trace.nodes.map((n, i) => i === end ? { ...n, head: true } : n) });
        else setTrace({ ...trace, context: [...trace.context, { kind: "head", points: [p], label: "" }] });
        addTolerance();
        return;
      }
      case "context_pipe": {
        const pts = [...pending, p];
        if (pts.length < 2) { setPending(pts); return; }
        setPending([]);
        setTrace({ ...trace, context: [...trace.context, { kind: "pipe", points: pts, label: "" }] }); addTolerance();
        return;
      }
      default:
    }
  };
  const chooseTool = (t: IntakeTool) => { setPending([]); setTool(tool === t ? "pan" : t); };

  return {
    tool, chooseTool, sheet, setSheet, pending, click,
    workArea, setWorkArea: (r: Rect | null) => { setWorkArea(r); touchView(); },
    cal, setCal: (c: CalibrationDraft) => { setCal(c); touchView(); },
    origin: effectiveOrigin, originSet: origin !== null, setOrigin: (p: SheetPoint | null) => { setOrigin(p); touchView(); },
    rotation, setRotation: (r: string) => { setRotation(r); touchView(); }, rotationDeg,
    scale, pickTolerance, draftTransform, savedTransform,
    trace, setTrace, traceDirty, markTraceSaved, viewDirty, markViewSaved,
    resetTrace: () => { setTraceState(emptyTrace()); setTool("pan"); setPending([]); markTraceSaved(); },
  };
}
export type Intake = ReturnType<typeof useIntake>;

function calibrationDraft(view: DrawingView | undefined): CalibrationDraft {
  const c = view?.calibration;
  const printed = c?.printedScale ? /^(.+?)\s*(mm|m|in|ft)\s*=\s*(.+?)\s*(mm|m|in|ft)$/.exec(c.printedScale) : null;
  return {
    method: c?.method ?? "two_point", a: c?.a ?? null, b: c?.b ?? null,
    distance: c?.realDistance ? String(c.realDistance.value) : "", distanceUnit: c?.realDistance?.unit ?? "ft",
    paper: printed?.[1] ?? "1/8", paperUnit: (printed?.[2] as LengthUnit) ?? "in", real: printed?.[3] ?? "1", realUnit: (printed?.[4] as LengthUnit) ?? "ft",
    reference: c?.reference ?? "",
  };
}
function savedTolerance(view: DrawingView | undefined, scale: number | null) {
  const u = view?.calibration?.pointUncertaintyMm;
  return u && scale ? u / scale : 0;
}
function restoredDraft(s: Snapshot | null): Trace | null {
  if (!s || s.baselinePlan?.confirmation === "confirmed" || s.sourceDrawing?.approval === "approved") return null;
  try {
    const raw = localStorage.getItem(draftKey(s.id));
    if (raw) {
      const saved = JSON.parse(raw) as { assetId?: string; page?: number; trace?: Trace };
      if (saved.trace && saved.assetId === s.sourceDrawing?.assetId && saved.page === s.sourceDrawing?.page) return saved.trace;
    }
  } catch { /* ignore a bad draft */ }
  return null;
}
function initialTrace(s: Snapshot | null): Trace {
  if (!s) return emptyTrace();
  const draft = restoredDraft(s);
  if (draft) return draft;
  const t = transformOf(s.sourceDrawing?.view, s.sourceDrawing?.scale.value ?? null);
  const label = (id: string) => {
    const f = findFact(s, "sourceLabel", id);
    return typeof f?.value === "string" ? f.value : "";
  };
  return (t && traceFromPlan(s.baselinePlan, s.scope, t, label)) || emptyTrace();
}
