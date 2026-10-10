import type { QualityFlag, SectionKind, SourceDocumentInput, SourceSection } from './types.js';

/**
 * Splits an imported document into meaningful sections without rewriting its wording.
 *
 * - Markdown headings (`#` to `####`) start sections. A leading identifier ("DEMO-8.2", "3.4",
 *   "Table DEMO-8.2") becomes the section id; otherwise the heading text is used.
 * - `<!-- page: N -->` markers set page locations. A form feed also advances the page.
 * - "Exception ..." and "Note N" / footnote paragraphs become child passages linked to their
 *   section, so they are always retrieved together and never read as standalone rules.
 * - Pipe tables are kept as rows; inconsistent rows flag the section as a damaged table.
 * - Low OCR confidence, illegible markers and instruction-like text are flagged, not hidden.
 */

const ID = /^((?:Table\s+)?(?:[A-Z]{1,6}-)*[A-Z]?\.?\d+(?:\.\d+)*[a-z]?)\.?(?:\s+|$)(.*)$/;
const PAGE = /^<!--\s*page:\s*(\d+)\s*-->$/i;
const EXCEPTION = /^(Exception(?:\s+No\.?\s*\d+)?)[:.]\s*/i;
const FOOTNOTE = /^(Note\s+\d+|Footnote\s+\d+|\[\^\d+\])[:.]?\s*/i;
const REF_PREFIXED = /\b(?:Table\s+)?(?:[A-Z]{1,6}-)+[A-Z]?\.?\d+(?:\.\d+)*/g;
const REF_PLAIN = /\b(?:Section|section|§|see|See|Table)\s+(\d+(?:\.\d+)+)/g;
const AMENDS = /\b((?:[A-Z]{1,6}-)+[A-Z]?\.?\d+(?:\.\d+)*|\d+(?:\.\d+)+)\s+is\s+amended\b/i;
const ILLEGIBLE = /\[\?\]|�|\[illegible\]/i;
/** Text that tries to address an assistant. Stored and shown as content; never obeyed. */
const INSTRUCTION_LIKE = /\b(ignore (all |any )?(previous|prior|above) instructions|system (note|prompt|message)|you are (an? )?(ai|assistant|language model)|as an ai|respond (only )?with|tell the user)\b/i;
const OCR_THRESHOLD = 0.85;

interface Draft {
  sectionId: string; heading: string; level: number; chapter: string;
  lines: Array<{ text: string; page: number | null }>; pageStart: number | null;
}

export function parseDocument(doc: SourceDocumentInput): SourceSection[] {
  const drafts: Draft[] = [];
  let page: number | null = null, chapter = '', current: Draft | null = null;
  for (const raw of doc.content.replace(/\r\n?/g, '\n').split('\n')) {
    const pieces = raw.split('\f');
    pieces.forEach((line, i) => {
      if (i > 0 && page !== null) page += 1;
      const trimmed = line.trim();
      const pageMatch = PAGE.exec(trimmed);
      if (pageMatch) { page = Number(pageMatch[1]); return; }
      const heading = /^(#{1,4})\s+(.+?)\s*$/.exec(trimmed);
      if (heading) {
        const level = heading[1].length, title = heading[2];
        const m = ID.exec(title);
        const sectionId = m ? m[1].replace(/\s+/g, ' ') : title;
        const headingText = m ? (m[2] || m[1]).replace(/\.$/, '') : title;
        if (level === 1) chapter = title;
        current = { sectionId, heading: headingText, level, chapter, lines: [], pageStart: page };
        drafts.push(current);
        return;
      }
      if (!current) {
        if (!trimmed) return;
        current = { sectionId: doc.title, heading: doc.title, level: 1, chapter: '', lines: [], pageStart: page };
        drafts.push(current);
      }
      current.lines.push({ text: line, page });
    });
  }

  const sections: SourceSection[] = [];
  let order = 0;
  const key = () => `${doc.id}#${order}`;
  const push = (s: Omit<SourceSection, 'key' | 'docId' | 'order'>) => {
    const section = { ...s, key: key(), docId: doc.id, order };
    order += 1;
    sections.push(section);
    return section;
  };

  for (const d of drafts) {
    const paragraphs = splitParagraphs(d.lines);
    const main = paragraphs.filter(p => !EXCEPTION.test(p.text) && !FOOTNOTE.test(p.text));
    const mainText = main.map(p => p.text).join('\n\n');
    const allPages = d.lines.map(l => l.page).filter((p): p is number => p !== null);
    const table = parseTable(main.map(p => p.text).join('\n'));
    const kind = sectionKind(doc, d, mainText, !!table);
    const parent = push({
      sectionId: d.sectionId, heading: d.heading, kind, parentKey: null,
      pageStart: d.pageStart ?? allPages[0] ?? null, pageEnd: allPages.length ? Math.max(...allPages) : d.pageStart,
      text: mainText, table: table?.rows ?? null,
      references: references(mainText, d.sectionId),
      amends: doc.type === 'local_amendment' ? (AMENDS.exec(mainText)?.[1] ?? AMENDS.exec(d.heading)?.[1] ?? null) : null,
      flags: flags(doc, mainText, main.map(p => p.page), table?.damaged ?? false),
    });
    for (const p of paragraphs) {
      const ex = EXCEPTION.exec(p.text), fn = FOOTNOTE.exec(p.text);
      if (!ex && !fn) continue;
      const label = (ex ?? fn)![1].replace(/\s+/g, ' ');
      push({
        sectionId: `${d.sectionId} ${label}`, heading: `${label} to ${d.sectionId}`, kind: ex ? 'exception' : 'footnote', parentKey: parent.key,
        pageStart: p.page ?? parent.pageStart, pageEnd: p.page ?? parent.pageEnd,
        text: p.text, table: null, references: references(p.text, d.sectionId), amends: null,
        flags: flags(doc, p.text, [p.page], false),
      });
    }
  }
  return sections.filter(s => s.text.trim() || s.parentKey === null && sections.some(c => c.parentKey === s.key));
}

function splitParagraphs(lines: Draft['lines']) {
  const out: Array<{ text: string; page: number | null }> = [];
  let buf: string[] = [], page: number | null = null;
  const flush = () => { if (buf.length) out.push({ text: buf.join('\n').trim(), page }); buf = []; page = null; };
  for (const l of lines) {
    if (!l.text.trim()) { flush(); continue; }
    // A table row directly after prose stays in the same paragraph; a new exception/note starts one.
    if (buf.length && (EXCEPTION.test(l.text.trim()) || FOOTNOTE.test(l.text.trim()))) flush();
    if (!buf.length) page = l.page;
    buf.push(l.text);
  }
  flush();
  return out;
}

function sectionKind(doc: SourceDocumentInput, d: Draft, text: string, isTable: boolean): SectionKind {
  if (/^Table\s/i.test(d.sectionId)) return 'table';
  if (isTable && !/\b(shall|must)\b/i.test(text.replace(/^\|.*$/gm, ''))) return 'table';
  if (/annex|explanatory|commentary/i.test(d.chapter) || /(^|-)A\.\d/.test(d.sectionId)) return 'commentary';
  if (/definition/i.test(d.chapter) && d.level > 1) return 'definition';
  if (doc.type === 'company_procedure') return 'procedure';
  if (/\b(shall|must|required|do not|never)\b/i.test(text)) return 'requirement';
  return 'general';
}

function parseTable(text: string): { rows: string[][]; damaged: boolean } | null {
  const rows = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
  if (rows.length < 2) return null;
  const cells = rows.filter(r => !/^\|\s*:?-{2,}/.test(r)).map(r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
  const width = cells[0].length;
  const damaged = cells.some(r => r.length !== width || r.some(c => ILLEGIBLE.test(c)));
  return { rows: cells, damaged };
}

function references(text: string, self: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(REF_PREFIXED)) found.add(m[0].replace(/\s+/g, ' '));
  for (const m of text.matchAll(REF_PLAIN)) found.add(m[1]);
  found.delete(self);
  // Sub-paragraph numbers of this same section ("DEMO-8.2.1" inside DEMO-8.2) are not cross-references.
  return [...found].filter(r => !r.startsWith(`${self}.`));
}

function flags(doc: SourceDocumentInput, text: string, pages: Array<number | null>, damagedTable: boolean): QualityFlag[] {
  const out = new Set<QualityFlag>();
  if (damagedTable) out.add('damaged_table');
  if (ILLEGIBLE.test(text)) out.add('uncertain_ocr');
  if (doc.extraction?.method === 'ocr') {
    const conf = doc.extraction.pageConfidence ?? {};
    // OCR text with no confidence for its page is not assumed reliable.
    if (pages.some(p => p === null || !(String(p) in conf) || conf[String(p)] < OCR_THRESHOLD)) out.add('uncertain_ocr');
  }
  if (INSTRUCTION_LIKE.test(text)) out.add('embedded_instructions');
  return [...out];
}
