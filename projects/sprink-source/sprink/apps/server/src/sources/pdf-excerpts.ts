import type { SourceDocument, SourceSection } from './types.js';
import { SourceError, type SourceStore } from './store.js';

/** Normalized coordinates in the unchanged original page. */
export interface PdfBox { x: number; y: number; w: number; h: number }
export interface PdfExcerpt {
  id: string; sectionKey: string; page: number; label: string; text: string;
  box: PdfBox; contextBox: PdfBox; pageWidth: number; pageHeight: number;
}
export interface PdfExcerptPackage { sha256: string; excerpts: PdfExcerpt[] }
const validBox = (b: PdfBox) => b && [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0 && b.x + b.w <= 1.000001 && b.y + b.h <= 1.000001;

/** Operator-reviewed boundaries, tied to the original's exact bytes and verbatim indexed text. */
export function preparePdfExcerpts(store: SourceStore, docId: string, pkg: PdfExcerptPackage) {
  const doc = store.document(docId);
  if (!doc?.pdf || doc.pdf.sha256 !== pkg.sha256) throw new SourceError(422, 'pdf_mismatch', 'Excerpt boundaries must match the attached PDF hash.');
  if (!Array.isArray(pkg.excerpts) || pkg.excerpts.length > 500) throw new SourceError(422, 'invalid_excerpts', 'Invalid excerpt list.');
  const ids = new Set<string>();
  for (const e of pkg.excerpts) {
    const s = store.section(e.sectionKey);
    if (!/^[a-z0-9-]{1,80}$/.test(e.id) || ids.has(e.id) || !s || s.docId !== docId || s.pageStart !== e.page || s.pageEnd !== e.page || !e.label?.trim() || e.label.length > 200 || !e.text?.trim() || !s.text.includes(e.text)) throw new SourceError(422, 'invalid_excerpt', 'Each excerpt must identify a single indexed page and verbatim text.');
    ids.add(e.id);
    const b = e.box, c = e.contextBox;
    if (!validBox(b) || !validBox(c) || c.x > b.x || c.y > b.y || c.x + c.w + 1e-6 < b.x + b.w || c.y + c.h + 1e-6 < b.y + b.h || !Number.isFinite(e.pageWidth) || !Number.isFinite(e.pageHeight) || e.pageWidth <= 0 || e.pageHeight <= 0) throw new SourceError(422, 'invalid_crop', 'Context must include the complete excerpt within the page.');
  }
  const updated = { ...doc, pdf: { ...doc.pdf, excerpts: pkg.excerpts } };
  store.db.prepare('UPDATE source_documents SET data=? WHERE id=?').run(JSON.stringify(updated), docId);
  return updated;
}

/** Additional search candidates use original wording; whole-page candidates remain searchable. */
export function excerptSections(doc: SourceDocument, sections: SourceSection[]): SourceSection[] {
  if (doc.authorization.display !== 'full') return [];
  return (doc.pdf?.excerpts ?? []).flatMap(e => {
    const source = sections.find(s => s.key === e.sectionKey);
    return source ? [{ ...source, key: `${source.key}:excerpt:${e.id}`, heading: e.label, text: e.text, table: null, parentKey: null, references: [], pdfExcerpt: e }] : [];
  });
}
