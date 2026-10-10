import { decodeImage, preview } from './decode.js';
import type { UploadKind } from './formats.js';
import type { Box, OcrEngine, OcrLine } from './ocr.js';
import { openPdf } from './pdf.js';

/**
 * Turns an upload into positioned lines of text, per page, with where each line came from
 * (the PDF text layer or OCR) and how sure the reading is. Nothing is summarized or rewritten.
 */

export type LineSource = 'text' | 'ocr';
export type ReviewKind = 'uncertain_number' | 'low_confidence' | 'table_structure' | 'no_text' | 'embedded_instructions';
export interface ExtractedLine {
  id: string; page: number; text: string; bbox: Box; source: LineSource; confidence: number; cells: string[]; height: number;
  /** OCR word confidences, kept so uncertain numbers can be pointed out. */
  words?: Array<{ text: string; confidence: number }>;
}
export interface ExtractedPage { n: number; width: number; height: number; method: 'text' | 'ocr' | 'mixed'; confidence: number | null; lines: ExtractedLine[] }
export interface ReviewItem { id: string; kind: ReviewKind; page: number; lineId: string | null; text: string; message: string; bbox: Box | null; blocking: boolean }
export interface Extraction {
  kind: UploadKind; pageCount: number; pages: ExtractedPage[]; notes: string[]; review: ReviewItem[];
  timings: { decodeMs: number; textMs: number; ocrMs: number; ocrPages: number; totalMs: number };
}
export interface ExtractedFiles { pages: Array<{ n: number; image: Buffer }>; preview: Buffer }

/** OCR words below this confidence (0-100) are shown for review. */
const LOW_CONFIDENCE = 70;
/** Numbers matter more: any OCR word with a digit below this confidence must be checked. */
const NUMBER_CONFIDENCE = 88;
const HAS_DIGIT = /\d/;
const FRACTION = /\b\d+\s*[-\s]\s*\d+\/\d+\b|\b\d+\/\d+\b/;
const INSTRUCTION_LIKE = /\b(ignore (all |any )?(previous|prior|above) instructions|system (note|prompt|message)|you are (an? )?(ai|assistant|language model)|as an ai|respond (only )?with|tell the user)\b/i;
/** Pages with less native text than this are treated as scanned. */
const MIN_NATIVE_CHARS = 40;

export async function extract(bytes: Buffer, kind: UploadKind, ocr: OcrEngine): Promise<{ extraction: Extraction; files: ExtractedFiles }> {
  const t0 = performance.now();
  const timings = { decodeMs: 0, textMs: 0, ocrMs: 0, ocrPages: 0, totalMs: 0 };
  const pages: ExtractedPage[] = [], images: ExtractedFiles['pages'] = [], notes: string[] = [];
  let lineNo = 0;
  const nextId = (page: number) => `p${page}l${++lineNo}`;

  const ocrPage = async (image: Buffer) => {
    const r = await ocr.recognize(image);
    timings.ocrMs += r.ms; timings.ocrPages += 1;
    return r;
  };

  if (kind === 'pdf') {
    const d0 = performance.now();
    const pdf = await openPdf(bytes);
    timings.decodeMs += performance.now() - d0;
    try {
      for (let n = 1; n <= pdf.pageCount; n++) {
        const tt = performance.now();
        const page = await pdf.page(n);
        const rendered = await page.render();
        timings.textMs += performance.now() - tt;
        images.push({ n, image: rendered.image });
        const native: ExtractedLine[] = page.lines.map(l => ({ id: nextId(n), page: n, text: l.text, bbox: l.bbox, source: 'text', confidence: 100, cells: l.cells, height: l.height }));
        const chars = native.reduce((s, l) => s + l.text.replace(/\s/g, '').length, 0);
        let method: ExtractedPage['method'] = 'text', confidence: number | null = null;
        let lines = native;
        if (chars < MIN_NATIVE_CHARS || page.paintsImages) {
          // Scanned page, or a page with pictures that may hold text (a pasted table, a stamp).
          const r = await ocrPage(rendered.image);
          const extra = r.lines.filter(o => !native.some(t => overlap(t.bbox, o.bbox) > 0.5));
          const ocrLines = extra.map(o => ocrLine(nextId(n), n, o));
          if (ocrLines.length) {
            method = native.length ? 'mixed' : 'ocr';
            confidence = extra.length ? extra.reduce((s, l) => s + l.confidence, 0) / extra.length : r.confidence;
            lines = [...native, ...ocrLines].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
          } else if (!native.length) { method = 'ocr'; confidence = r.confidence; }
        }
        pages.push({ n, width: rendered.width, height: rendered.height, method, confidence, lines });
      }
    } finally { await pdf.close(); }
  } else {
    const d0 = performance.now();
    const decoded = await decodeImage(bytes, kind);
    timings.decodeMs += performance.now() - d0;
    notes.push(...decoded.notes);
    for (const p of decoded.pages) {
      images.push({ n: p.n, image: p.image });
      const r = await ocrPage(p.image);
      const lines = r.lines.map(o => ocrLine(nextId(p.n), p.n, o));
      pages.push({ n: p.n, width: p.width, height: p.height, method: 'ocr', confidence: lines.length ? r.confidence : null, lines });
    }
  }
  const review = reviewItems(pages);
  timings.totalMs = performance.now() - t0;
  const round = (n: number) => Math.round(n);
  return {
    extraction: { kind, pageCount: pages.length, pages, notes, review, timings: { decodeMs: round(timings.decodeMs), textMs: round(timings.textMs), ocrMs: round(timings.ocrMs), ocrPages: timings.ocrPages, totalMs: round(timings.totalMs) } },
    files: { pages: images, preview: await preview(images[0].image) },
  };
}

const ocrLine = (id: string, page: number, o: OcrLine): ExtractedLine => ({
  id, page, text: o.text, bbox: o.bbox, source: 'ocr', confidence: o.confidence, cells: cellsOf(o), height: o.bbox.h,
  words: o.words.map(w => ({ text: w.text, confidence: Math.round(w.confidence) })),
});

function overlap(a: Box, b: Box) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.w * a.h, b.w * b.h);
}

/** Splits an OCR line into cells where the gap between words is wide (a table column). */
function cellsOf(l: { words: Array<{ text: string; bbox: Box }>; bbox: Box }): string[] {
  const cells: string[] = [];
  let cur = '', prevEnd = -Infinity;
  for (const w of l.words) {
    if (prevEnd > -Infinity && w.bbox.x - prevEnd > 1.4 * l.bbox.h) { cells.push(cur.trim()); cur = ''; }
    cur += ` ${w.text}`; prevEnd = w.bbox.x + w.bbox.w;
  }
  cells.push(cur.trim());
  return cells;
}

function reviewItems(pages: ExtractedPage[]): ReviewItem[] {
  const out: ReviewItem[] = [];
  let i = 0;
  const add = (x: Omit<ReviewItem, 'id'>) => out.push({ id: `r${++i}`, ...x });
  for (const p of pages) {
    if (!p.lines.length) add({ kind: 'no_text', page: p.n, lineId: null, text: '', bbox: null, blocking: true,
      message: `No readable text was found on page ${p.n}. Type the text in, or confirm the page has none.` });
    for (const l of p.lines) {
      if (l.source === 'ocr') {
        const words = l.words ?? [];
        const weakNumbers = words.filter(w => HAS_DIGIT.test(w.text) && w.confidence < NUMBER_CONFIDENCE);
        if (weakNumbers.length || FRACTION.test(l.text))
          add({ kind: 'uncertain_number', page: p.n, lineId: l.id, text: l.text, bbox: l.bbox, blocking: true,
            message: weakNumbers.length ? `Check ${weakNumbers.map(w => `“${w.text}”`).join(', ')} against the original; the reading is uncertain.`
              : 'Check the fraction against the original; OCR often misreads fractions.' });
        else if (l.confidence < LOW_CONFIDENCE)
          add({ kind: 'low_confidence', page: p.n, lineId: l.id, text: l.text, bbox: l.bbox, blocking: true, message: 'This line was hard to read. Check it against the original.' });
      }
      if (INSTRUCTION_LIKE.test(l.text))
        add({ kind: 'embedded_instructions', page: p.n, lineId: l.id, text: l.text, bbox: l.bbox, blocking: false,
          message: 'This text reads like an instruction to an assistant. It will be stored as document text and never followed.' });
    }
    // Two or more consecutive lines with the same number of columns look like a table.
    let run: ExtractedLine[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const box = union(run.map(r => r.bbox));
        add({ kind: 'table_structure', page: p.n, lineId: run[0].id, text: run.map(r => r.cells.join(' | ')).join('\n'), bbox: box, blocking: true,
          message: 'This looks like a table. Check that each value sits in the right row and column.' });
      }
      run = [];
    };
    for (const l of p.lines) {
      if (l.cells.length >= 2 && (!run.length || run[0].cells.length === l.cells.length)) run.push(l);
      else { flush(); if (l.cells.length >= 2) run.push(l); }
    }
    flush();
  }
  return out;
}

export function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  const r = Math.max(...boxes.map(b => b.x + b.w)), btm = Math.max(...boxes.map(b => b.y + b.h));
  return { x, y, w: r - x, h: btm - y };
}

// ------------------------------------------------------------------ draft text for review

const SECTION_START = /^(?:Table\s+)?(?:[A-Z]{1,6}-)*[A-Z]?\.?\d+(?:\.\d+)*[a-z]?\s+\S/;
const PARA_START = /^((?:[A-Z]{1,6}-)*[A-Z]?\.?\d+(?:\.\d+)+[a-z]?\s|Exception\b|Note\s+\d+|Footnote\s+\d+)/i;

/** A heading: a numbered line that reads as a title, not a sentence. */
export function isHeading(text: string) {
  const t = text.trim();
  return SECTION_START.test(t) && t.length <= 100 && !/[.;:]$/.test(t) && !/\b(shall|must)\b/i.test(t);
}

/**
 * The editable text that will be indexed: Markdown headings for numbered titles, page markers,
 * paragraphs joined across wrapped lines, and pipe tables for column-aligned rows.
 */
export function draftText(ex: Extraction): string {
  const out: string[] = [];
  for (const p of ex.pages) {
    out.push(`<!-- page: ${p.n} -->`);
    let para: string[] = [], prev: ExtractedLine | null = null, table: string[][] = [];
    const flushPara = () => { if (para.length) { out.push(para.join(' ').replace(/\s+/g, ' ').trim(), ''); para = []; } };
    const flushTable = () => {
      if (table.length) {
        const width = Math.max(...table.map(r => r.length));
        out.push(`| ${table[0].join(' | ')} |`, `|${' --- |'.repeat(width)}`, ...table.slice(1).map(r => `| ${r.join(' | ')} |`), '');
        table = [];
      }
    };
    for (const l of p.lines) {
      const text = l.text.replace(/\s{2,}/g, ' ').trim();
      if (!text) continue;
      if (isHeading(text) && l.cells.length < 2) { flushPara(); flushTable(); out.push(`## ${text}`, ''); prev = l; continue; }
      if (l.cells.length >= 2) { flushPara(); table.push(l.cells); prev = l; continue; }
      flushTable();
      const gap = prev ? l.bbox.y - (prev.bbox.y + prev.bbox.h) : 0;
      if (PARA_START.test(text) || gap > 0.9 * Math.max(l.height, 8)) flushPara();
      para.push(text);
      prev = l;
    }
    flushPara(); flushTable();
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
