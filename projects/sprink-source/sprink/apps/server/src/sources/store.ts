import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { canonical } from '../store.js';
import { parseDocument } from './parse.js';
import {
  SOURCE_TYPES, type ExplanationFile, type ExplanationNote, type QualityFlag, type SourceDocument,
  type SourceDocumentInput, type SourceSection,
} from './types.js';

export class SourceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const fail = (status: number, code: string, message: string): never => { throw new SourceError(status, code, message); };
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/;
const text = (v: unknown, max = 500) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** Stored in the application's existing SQLite database, beside work packages. */
export class SourceStore {
  constructor(readonly db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS source_documents (id TEXT PRIMARY KEY, data TEXT NOT NULL, content TEXT NOT NULL, sha256 TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_sections (key TEXT PRIMARY KEY, doc_id TEXT NOT NULL, ord INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS source_sections_doc ON source_sections(doc_id, ord);
      CREATE TABLE IF NOT EXISTS source_notes (section_key TEXT NOT NULL, data TEXT NOT NULL);
    `);
  }

  /** Validates authorization and metadata, splits the text, and stores it. Same id and bytes is a no-op. */
  import(input: SourceDocumentInput, notes?: ExplanationFile): SourceDocument {
    validate(input);
    const sha256 = createHash('sha256').update(input.content).digest('hex');
    if (!input.demonstration && this.db.prepare("SELECT 1 FROM source_documents WHERE sha256=? AND json_extract(data, '$.demonstration')=1").get(sha256))
      fail(400, 'demonstration_required', 'Demonstration content must remain marked as demonstration.');
    const prior = this.db.prepare('SELECT sha256 FROM source_documents WHERE id=?').get(input.id) as { sha256: string } | undefined;
    if (prior) {
      if (prior.sha256 !== sha256) fail(409, 'document_id_conflict', `A different document is already stored as ${input.id}. Import a new edition or revision under its own id.`);
      const existing = this.document(input.id)!;
      const { content: _content, ...metadata } = input;
      const stored = Object.fromEntries(Object.keys(metadata).map(k => [k, existing[k as keyof SourceDocument]]));
      if (canonical(stored) !== canonical(metadata)) fail(409, 'document_metadata_conflict', 'Stored source metadata differs. Import a new revision under its own id.');
      return existing;
    }
    const sections = parseDocument(input);
    if (!sections.length) fail(400, 'no_sections', 'No sections were found. Use headings such as "## 8.2 Title" and page markers "<!-- page: 12 -->".');
    const docFlags = [...new Set(sections.flatMap(s => s.flags))] as QualityFlag[];
    const { content, ...meta } = input;
    const doc: SourceDocument = { ...meta, sha256, importedAt: new Date().toISOString(), sectionCount: sections.length, flags: docFlags };
    const resolvedNotes = notes ? resolveNotes(sections, notes) : [];
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO source_documents(id,data,content,sha256) VALUES(?,?,?,?)').run(doc.id, JSON.stringify(doc), content, sha256);
      const ins = this.db.prepare('INSERT INTO source_sections(key,doc_id,ord,data) VALUES(?,?,?,?)');
      for (const s of sections) {
        ins.run(s.key, s.docId, s.order, JSON.stringify(s));
      }
      const note = this.db.prepare('INSERT INTO source_notes(section_key,data) VALUES(?,?)');
      for (const n of resolvedNotes) note.run(n.sectionKey, JSON.stringify(n));
    })();
    return doc;
  }

  documents(): SourceDocument[] {
    return (this.db.prepare('SELECT id,data,sha256 FROM source_documents ORDER BY id').all() as DocumentRow[]).map(readDocument);
  }
  document(id: string): SourceDocument | undefined {
    const row = this.db.prepare('SELECT id,data,sha256 FROM source_documents WHERE id=?').get(id) as DocumentRow | undefined;
    return row ? readDocument(row) : undefined;
  }
  content(id: string): string | undefined {
    return (this.db.prepare('SELECT content FROM source_documents WHERE id=?').get(id) as { content: string } | undefined)?.content;
  }
  sections(docId: string): SourceSection[] {
    const doc = this.document(docId);
    const rows = this.db.prepare('SELECT key,doc_id,ord,data FROM source_sections WHERE doc_id=? ORDER BY ord').all(docId) as SectionRow[];
    if (!doc || rows.length !== doc.sectionCount) unavailable();
    const sections = rows.map(readSection);
    if (sections.some(s => s.parentKey && !sections.some(p => p.key === s.parentKey && p.parentKey === null))) unavailable();
    return sections;
  }
  section(key: string): SourceSection | undefined {
    const row = this.db.prepare('SELECT key,doc_id,ord,data FROM source_sections WHERE key=?').get(key) as SectionRow | undefined;
    return row ? this.sections(row.doc_id).find(s => s.key === key) : undefined;
  }
  notes(key: string): ExplanationNote[] {
    return (this.db.prepare('SELECT data FROM source_notes WHERE section_key=?').all(key) as { data: string }[]).map(r => JSON.parse(r.data));
  }
  /** Records where each passage sits on its uploaded page images, for highlighting in the viewer. */
  setRegions(docId: string, regions: Record<string, NonNullable<SourceSection['regions']>>) {
    const upd = this.db.prepare('UPDATE source_sections SET data=? WHERE key=? AND doc_id=?');
    this.db.transaction(() => {
      for (const s of this.sections(docId)) if (regions[s.key]) upd.run(JSON.stringify({ ...s, regions: regions[s.key] }), s.key, docId);
    })();
  }
  /** Registered sections, not a lexical probe, determine readiness for semantic search. */
  searchable(docId: string): boolean {
    const doc = this.document(docId);
    const sections = this.sections(docId);
    return !!doc && sections.length > 0 && sections.length === doc.sectionCount;
  }
  remove(id: string) {
    this.db.transaction(() => {
      const keys = (this.db.prepare('SELECT key FROM source_sections WHERE doc_id=?').all(id) as { key: string }[]).map(r => r.key);
      for (const k of keys) this.db.prepare('DELETE FROM source_notes WHERE section_key=?').run(k);
      // Old databases may still carry the retired derived index; remove deleted documents there too.
      if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='source_fts'").get())
        this.db.prepare('DELETE FROM source_fts WHERE doc_id=?').run(id);
      this.db.prepare('DELETE FROM source_sections WHERE doc_id=?').run(id);
      this.db.prepare('DELETE FROM source_documents WHERE id=?').run(id);
    })();
  }
}

function validate(d: SourceDocumentInput) {
  if (!d || typeof d !== 'object') fail(400, 'invalid_document', 'Document metadata is required.');
  if (typeof d.id !== 'string' || !ID.test(d.id)) fail(400, 'invalid_id', 'Document id must be 1-120 letters, digits, dots, dashes or underscores.');
  for (const f of ['title', 'publisher', 'edition', 'filename'] as const) if (!text(d[f])) fail(400, `missing_${f}`, `The document ${f} is required.`);
  if (!SOURCE_TYPES.includes(d.type)) fail(400, 'invalid_type', `Document type must be one of: ${SOURCE_TYPES.join(', ')}.`);
  if (d.demonstration === false && (/^demo[-_]/i.test(d.id) || /^DEMONSTRATION\b/.test(d.title) || /(?:^|\n)\s*(?:#{1,4}\s*)?DEMONSTRATION\b|\bDEMO-[A-Z0-9]/.test(d.content))) fail(400, 'demonstration_required', 'Demonstration material must be marked as demonstration.');
  if (typeof d.demonstration !== 'boolean') fail(400, 'missing_demonstration', 'Say whether this is a demonstration document.');
  const a = d.authorization;
  // Authorization is stated by the importer and never assumed (for example from a subscription).
  if (!a || !text(a.basis, 2000)) fail(400, 'authorization_required', 'State who authorized storing and using this document, and on what basis.');
  if (a.storeAndIndex !== true) fail(403, 'not_authorized_to_store', 'This document is not authorized for storage and indexing, so it was not imported.');
  if (a.useWithAi !== true) fail(403, 'not_authorized_for_ai', 'This document is not authorized for use with AI features, so it was not imported.');
  if (!['full', 'excerpt', 'reference_only'].includes(a.display)) fail(400, 'invalid_display', 'Display must be full, excerpt or reference_only.');
  if (a.display === 'excerpt' && !(Number.isInteger(a.maxQuoteChars) && a.maxQuoteChars! > 0)) fail(400, 'invalid_quote_limit', 'An excerpt display needs a positive maxQuoteChars.');
  if (d.url !== undefined && !/^https?:\/\//.test(d.url)) fail(400, 'invalid_url', 'The source link must be an http(s) URL.');
  if (typeof d.content !== 'string' || !d.content.trim() || d.content.length > 5_000_000) fail(400, 'invalid_content', 'The document text is empty or too large.');
  if (!d.scope || typeof d.scope !== 'object' || Array.isArray(d.scope)) fail(400, 'invalid_scope', 'Document scope must be an object.');
  const s = d.scope;
  for (const field of ['standard', 'jurisdiction', 'amendsEdition', 'projectId'] as const)
    if (s[field] !== undefined && !text(s[field], 120)) fail(400, 'invalid_scope', 'Invalid document scope.');
  if ((d.type === 'published_code' || d.type === 'local_amendment') && !text(s.standard, 60)) fail(400, 'missing_standard', 'Codes and amendments need scope.standard (for example nfpa13).');
  if (d.type === 'local_amendment' && (!text(s.jurisdiction, 60) || !text(s.amendsEdition, 60))) fail(400, 'missing_jurisdiction', 'Local amendments need scope.jurisdiction and scope.amendsEdition.');
  if (d.type === 'project_document' && !text(s.projectId, 120)) fail(400, 'missing_project', 'Project documents need scope.projectId.');
  if (d.type === 'manufacturer' && !(Array.isArray(s.productIds) && s.productIds.length && s.productIds.every(p => text(p, 120)))) fail(400, 'missing_products', 'Manufacturer documents need scope.productIds.');
}

const validCondition = (c: unknown): boolean => {
  const x = c as ExplanationNote['conditions'] extends (infer T)[] | undefined ? Partial<T> : never;
  return !!x && typeof x === 'object' && text(x.id, 120) && text(x.question, 400) && !!x.input && text(x.input.name, 60) && (x.input.unit === 'mm' || x.input.unit === 'count')
    && !!x.appliesWhen && ['<=', '<', '>=', '>'].includes(x.appliesWhen.op) && typeof x.appliesWhen.value === 'number' && Number.isFinite(x.appliesWhen.value);
};

function resolveNotes(sections: SourceSection[], file: ExplanationFile): ExplanationNote[] {
  if (!text(file.author, 200) || !Array.isArray(file.notes)) fail(400, 'invalid_notes', 'Explanation notes need an author and a notes list.');
  return file.notes.map(n => {
    const target = sections.find(s => s.sectionId === n.sectionId);
    if (!target) fail(400, 'note_section_missing', `Explanation note refers to section ${n.sectionId}, which is not in the document.`);
    if (!text(n.text, 4000)) fail(400, 'invalid_note', `The note for ${n.sectionId} needs text (up to 4000 characters).`);
    if ((n.topic !== undefined && !text(n.topic, 120)) || (n.position !== undefined && !text(n.position, 400))) fail(400, 'invalid_note', `The note for ${n.sectionId} has an invalid topic or position.`);
    if (n.conditions !== undefined && !(Array.isArray(n.conditions) && n.conditions.every(validCondition))) fail(400, 'invalid_note', `The note for ${n.sectionId} has an invalid condition. Each needs an id, a question, an input name with unit mm or count, and a comparison with a number.`);
    return { sectionKey: target!.key, text: n.text, author: file.author, topic: n.topic, position: n.position, conditions: n.conditions };
  });
}

type DocumentRow = { id: string; data: string; sha256: string };
type SectionRow = { key: string; doc_id: string; ord: number; data: string };
const unavailable = (): never => fail(503, 'source_unavailable', 'Stored source data is incomplete or inconsistent. Ask the library operator to check the source.');
function readDocument(row: DocumentRow): SourceDocument {
  try {
    const doc = JSON.parse(row.data) as SourceDocument;
    validate({ ...doc, content: 'Stored content is validated on import.' });
    if (doc.id !== row.id || doc.sha256 !== row.sha256 || !/^[a-f0-9]{64}$/.test(doc.sha256) || !Number.isInteger(doc.sectionCount) || doc.sectionCount < 1 || !Array.isArray(doc.flags)) return unavailable();
    return doc;
  } catch { return unavailable(); }
}
function readSection(row: SectionRow): SourceSection {
  try {
    const s = JSON.parse(row.data) as SourceSection;
    const page = (n: unknown) => n === null || typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
    if (s.key !== row.key || s.docId !== row.doc_id || s.order !== row.ord || s.key !== `${s.docId}#${s.order}` || !text(s.sectionId, 500) || typeof s.heading !== 'string' || typeof s.text !== 'string'
      || !Array.isArray(s.flags) || !Array.isArray(s.references) || !s.references.every(r => typeof r === 'string')
      || !(s.parentKey === null || typeof s.parentKey === 'string') || !page(s.pageStart) || !page(s.pageEnd) || (s.pageStart !== null && s.pageEnd !== null && s.pageStart > s.pageEnd)
      || !(s.table === null || Array.isArray(s.table) && s.table.every(r => Array.isArray(r) && r.every(c => typeof c === 'string')))) return unavailable();
    return s;
  } catch { return unavailable(); }
}
