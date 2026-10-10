import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SourceStore } from '../sources/store.js';
import { SourceError } from '../sources/store.js';
import { SOURCE_TYPES, type SourceAuthorization, type SourceScope, type SourceSection, type SourceType } from '../sources/types.js';
import { draftText, extract, union, type Extraction, type ExtractedLine, type ReviewItem } from './extract.js';
import { KIND_LABEL, KIND_MIME, LIMITS, SUPPORTED_TEXT, UploadError, sniff, type UploadKind } from './formats.js';
import { OcrEngine } from './ocr.js';
import type { Box } from './ocr.js';

/**
 * Uploads: originals, extraction, review, correction and indexing.
 *
 * Purpose decides what an upload can become:
 * - reference: a document for the source library. It goes through review, where the extracted
 *   text and metadata can be corrected, and only becomes searchable when indexed.
 * - site_photo: context attached to a question (a photo or drawing from the job). It is never
 *   added to the library and never cited as an authority.
 *
 * Originals and page images live under the data directory with owner-only permissions and are
 * served only through the authenticated API. Document text is not written to logs.
 */

export type UploadPurpose = 'reference' | 'site_photo';
export type UploadStatus = 'uploaded' | 'extracting' | 'review' | 'indexing' | 'ready' | 'failed';

export interface ReferenceMetadata {
  title: string; publisher: string; type: SourceType; edition: string; scope: SourceScope; url?: string;
  demonstration: boolean; authorization: SourceAuthorization;
}
export interface UploadRecord {
  id: string; purpose: UploadPurpose; filename: string; kind: UploadKind; kindLabel: string; mime: string; size: number; sha256: string;
  status: UploadStatus; failedStage?: 'extracting' | 'indexing'; error?: { code: string; message: string };
  projectId: string | null; packageId: string | null;
  pageCount: number | null; pages: Array<{ n: number; width: number; height: number; method: string; confidence: number | null }>;
  notes: string[];
  review: { items: number; blocking: number };
  revision: number; indexedRevision: number | null; docId: string | null; metadata: ReferenceMetadata | null;
  timings: { uploadMs?: number; decodeMs?: number; textMs?: number; ocrMs?: number; ocrPages?: number; extractMs?: number; indexMs?: number };
  createdAt: string; updatedAt: string;
}
export interface Revision {
  rev: number; basis: 'extracted' | 'corrected'; text: string; acknowledged: string[]; createdAt: string; author: 'extraction' | 'you';
}
export interface Observation { id: string; kind: 'text' | 'marking' | 'dimension_text'; text: string; confidence: number; page: number; bbox: Box; clear: boolean }

const ID = /^[a-f0-9-]{36}$/;
const MARKING = /\b(spears|flameguard|blazemaster|cpvc|astm|ul|fm|sdr|nps|psi|listed|viking|tyco|reliable|victaulic|sch(edule)?\s*\d+)\b/i;
const DIMENSION = /\b\d+(?:[.,]\d+)?(?:\s*-?\s*\d+\/\d+)?\s*(mm|cm|m|in|inch(?:es)?|ft|feet|"|')(?![a-z])/i;
/** Readings at or above this OCR confidence count as clear; anything lower is asked about. */
const CLEAR = 90;

export class UploadService {
  private readonly dir: string;
  readonly ocr: OcrEngine;
  private running = new Map<string, Promise<void>>();

  constructor(private readonly db: Database.Database, dataDir: string, private readonly sources: SourceStore) {
    this.dir = join(dataDir, 'uploads');
    this.ocr = new OcrEngine(join(dataDir, 'ocr-cache'));
    db.exec(`
      CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, created TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS upload_revisions (upload_id TEXT NOT NULL, rev INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(upload_id, rev));
    `);
    // Work interrupted by a restart is marked failed so it can be retried, never left spinning.
    for (const u of this.list()) if (u.status === 'extracting' || u.status === 'indexing' || u.status === 'uploaded')
      this.save({ ...u, status: 'failed', failedStage: u.status === 'indexing' ? 'indexing' : 'extracting', error: { code: 'interrupted', message: 'Processing was interrupted by a server restart. Retry to continue.' } });
  }

  // ---------------------------------------------------------------- records
  list(filter: { purpose?: UploadPurpose; projectId?: string } = {}): UploadRecord[] {
    return (this.db.prepare('SELECT data FROM uploads ORDER BY created DESC').all() as { data: string }[]).map(r => JSON.parse(r.data) as UploadRecord)
      .filter(u => (!filter.purpose || u.purpose === filter.purpose) && (!filter.projectId || u.projectId === filter.projectId));
  }
  get(id: string): UploadRecord {
    if (!ID.test(id)) throw new UploadError(404, 'not_found', 'Upload not found.');
    const row = this.db.prepare('SELECT data FROM uploads WHERE id=?').get(id) as { data: string } | undefined;
    if (!row) throw new UploadError(404, 'not_found', 'Upload not found.');
    return JSON.parse(row.data);
  }
  /** Public upload viewers may not bypass the library's display authorization. */
  assertPublicDisplay(id: string): boolean | null {
    const upload = this.get(id);
    if (upload.purpose !== 'reference') return null;
    const doc = upload.docId ? this.sources.document(upload.docId) : undefined;
    if (upload.docId && !doc) throw new SourceError(404, 'source_unavailable', 'The indexed source is not available.');
    const authorization = doc?.authorization ?? upload.metadata?.authorization;
    if (!authorization || authorization.storeAndIndex !== true || authorization.useWithAi !== true || authorization.display !== 'full'
      || upload.metadata?.authorization?.display !== 'full') throw new SourceError(403, 'display_limited', 'This reference does not permit full display. Use the authorized source viewer.');
    return doc?.demonstration ?? upload.metadata?.demonstration === true;
  }
  private save(u: UploadRecord) {
    u.updatedAt = new Date().toISOString();
    this.db.prepare('INSERT INTO uploads(id,created,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(u.id, u.createdAt, JSON.stringify(u));
    return u;
  }
  revision(id: string, rev?: number): Revision {
    const u = this.get(id);
    const row = this.db.prepare('SELECT data FROM upload_revisions WHERE upload_id=? AND rev=?').get(id, rev ?? u.revision) as { data: string } | undefined;
    if (!row) throw new UploadError(404, 'no_revision', 'This upload has no extracted text yet.');
    return JSON.parse(row.data);
  }
  revisions(id: string): Array<Omit<Revision, 'text'>> {
    return (this.db.prepare('SELECT data FROM upload_revisions WHERE upload_id=? ORDER BY rev').all(id) as { data: string }[])
      .map(r => { const { text: _t, ...rest } = JSON.parse(r.data) as Revision; return rest; });
  }
  private addRevision(id: string, r: Revision) {
    this.db.prepare('INSERT INTO upload_revisions(upload_id,rev,data) VALUES(?,?,?)').run(id, r.rev, JSON.stringify(r));
  }
  private path(id: string, name: string) { return join(this.dir, id, name); }
  async original(id: string) { const u = this.get(id); return { record: u, bytes: await readFile(this.path(id, 'original')) }; }
  async pageImage(id: string, n: number) {
    const u = this.get(id);
    if (!Number.isInteger(n) || n < 1 || !u.pageCount || n > u.pageCount) throw new UploadError(404, 'not_found', 'Page not found.');
    return readFile(this.path(id, `page-${n}.png`)).catch(() => { throw new UploadError(404, 'not_found', 'The page image is not available yet.'); });
  }
  async preview(id: string) {
    this.get(id);
    return readFile(this.path(id, 'preview.jpg')).catch(() => { throw new UploadError(404, 'not_found', 'The preview is not available yet.'); });
  }
  async extraction(id: string): Promise<Extraction> {
    this.get(id);
    try { return JSON.parse(await readFile(this.path(id, 'extraction.json'), 'utf8')); }
    catch { throw new UploadError(404, 'not_found', 'This upload has not been extracted yet.'); }
  }

  // ---------------------------------------------------------------- create and extract
  async create(bytes: Buffer, input: { filename: string; purpose: UploadPurpose; projectId?: string | null; packageId?: string | null; uploadMs?: number }): Promise<UploadRecord> {
    if (!bytes.length) throw new UploadError(400, 'empty_file', 'The file is empty.');
    if (bytes.length > LIMITS.maxBytes) throw new UploadError(413, 'file_too_large', `The file is ${(bytes.length / 1048576).toFixed(1)} MB. The limit is ${LIMITS.maxBytes / 1048576} MB.`);
    const kind = sniff(bytes);
    if (!kind) throw new UploadError(415, 'unsupported_format', `This file type is not supported. Upload ${SUPPORTED_TEXT}. (The file's contents were checked, not its name.)`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (input.purpose === 'reference') {
      // The same reference file twice would repeat every quote in answers; point at the copy already there.
      const same = this.list({ purpose: 'reference' }).find(u => u.sha256 === sha256 && u.status !== 'failed' && (u.projectId ?? null) === (input.projectId ?? null));
      if (same) throw new UploadError(409, 'duplicate_upload', `This file is already in the library as "${same.filename}". Open that copy to review or correct it.`);
    }
    const id = randomUUID(), now = new Date().toISOString();
    await mkdir(join(this.dir, id), { recursive: true, mode: 0o700 });
    await writeAtomic(this.path(id, 'original'), bytes);
    const record: UploadRecord = {
      id, purpose: input.purpose, filename: cleanName(input.filename), kind, kindLabel: KIND_LABEL[kind], mime: KIND_MIME[kind], size: bytes.length,
      sha256, status: 'uploaded',
      projectId: input.projectId ?? null, packageId: input.packageId ?? null, pageCount: null, pages: [], notes: [], review: { items: 0, blocking: 0 },
      revision: 0, indexedRevision: null, docId: null, metadata: null, timings: { uploadMs: input.uploadMs }, createdAt: now, updatedAt: now,
    };
    this.save(record);
    this.startExtraction(id);
    return record;
  }

  /** Waits for background work on an upload (used by tests and the import script). */
  async settle(id: string) { await this.running.get(id); return this.get(id); }

  private startExtraction(id: string) {
    const job = this.runExtraction(id).finally(() => this.running.delete(id));
    this.running.set(id, job);
  }

  private async runExtraction(id: string) {
    let u = this.save({ ...this.get(id), status: 'extracting', error: undefined, failedStage: undefined });
    try {
      const bytes = await readFile(this.path(id, 'original'));
      const { extraction, files } = await extract(bytes, u.kind, this.ocr);
      for (const p of files.pages) await writeAtomic(this.path(id, `page-${p.n}.png`), p.image);
      await writeAtomic(this.path(id, 'preview.jpg'), files.preview);
      await writeAtomic(this.path(id, 'extraction.json'), Buffer.from(JSON.stringify(extraction)));
      this.db.prepare('DELETE FROM upload_revisions WHERE upload_id=?').run(id);
      this.addRevision(id, { rev: 1, basis: 'extracted', text: draftText(extraction), acknowledged: [], createdAt: new Date().toISOString(), author: 'extraction' });
      u = this.get(id);
      this.save({
        ...u, status: u.purpose === 'reference' ? 'review' : 'ready', revision: 1, pageCount: extraction.pageCount,
        pages: extraction.pages.map(p => ({ n: p.n, width: p.width, height: p.height, method: p.method, confidence: p.confidence === null ? null : Math.round(p.confidence) })),
        notes: extraction.notes, review: { items: extraction.review.length, blocking: extraction.review.filter(r => r.blocking).length },
        timings: { ...u.timings, decodeMs: extraction.timings.decodeMs, textMs: extraction.timings.textMs, ocrMs: extraction.timings.ocrMs, ocrPages: extraction.timings.ocrPages, extractMs: extraction.timings.totalMs },
      });
    } catch (e) {
      const err = e instanceof UploadError ? { code: e.code, message: e.message } : { code: 'extraction_failed', message: 'Reading this file failed. Retry, or upload it again.' };
      if (!(e instanceof UploadError)) console.error(`upload ${id}: extraction failed: ${(e as Error)?.name ?? 'Error'}`);
      this.save({ ...this.get(id), status: 'failed', failedStage: 'extracting', error: err });
    }
  }

  async retry(id: string) {
    const u = this.get(id);
    if (u.status !== 'failed') throw new UploadError(409, 'not_failed', 'Only a failed upload can be retried.');
    if (u.failedStage === 'indexing' && u.metadata) return this.index(id, u.metadata);
    this.startExtraction(id);
    return this.get(id);
  }

  // ---------------------------------------------------------------- review and correction
  async review(id: string) {
    const u = this.get(id);
    const ex = await this.extraction(id);
    const rev = this.revision(id);
    return { upload: u, revision: rev, revisions: this.revisions(id), items: ex.review, pages: ex.pages.map(p => ({ n: p.n, width: p.width, height: p.height, method: p.method, confidence: p.confidence })) };
  }

  /** Saves corrected text as a new revision. The extracted revision is kept unchanged. */
  saveCorrection(id: string, input: { text?: string; acknowledged?: string[]; metadata?: ReferenceMetadata }) {
    const u = this.get(id);
    if (u.purpose !== 'reference') throw new UploadError(409, 'not_reference', 'Only reference documents are reviewed for the library.');
    if (!['review', 'ready'].includes(u.status)) throw new UploadError(409, 'not_reviewable', `This upload is ${u.status}; it can be corrected once extraction finishes.`);
    const cur = this.revision(id);
    const text = typeof input.text === 'string' ? input.text : cur.text;
    if (text.length > 2_000_000) throw new UploadError(413, 'text_too_large', 'The corrected text is too large.');
    const acknowledged = Array.isArray(input.acknowledged) ? input.acknowledged.filter(x => typeof x === 'string' && /^r\d+$/.test(x)) : cur.acknowledged;
    if (text !== cur.text || acknowledged.join() !== cur.acknowledged.join()) {
      const rev: Revision = { rev: cur.rev + 1, basis: text === this.revision(id, 1).text ? 'extracted' : 'corrected', text, acknowledged, createdAt: new Date().toISOString(), author: 'you' };
      this.addRevision(id, rev);
      u.revision = rev.rev;
    }
    if (input.metadata) u.metadata = input.metadata;
    // A change after indexing needs indexing again; the library keeps the indexed revision until then.
    return this.save({ ...u, status: 'review' });
  }

  // ---------------------------------------------------------------- indexing
  async index(id: string, metadata: ReferenceMetadata): Promise<UploadRecord> {
    let u = this.get(id);
    if (u.purpose !== 'reference') throw new UploadError(409, 'site_photo_not_source', 'Site photos are context for a question, not reference documents. Upload the document again as a reference to add it to the library.');
    if (!['review', 'ready', 'failed'].includes(u.status) || (u.status === 'failed' && u.failedStage !== 'indexing'))
      throw new UploadError(409, 'not_ready_to_index', 'Finish extraction and review before indexing.');
    const ex = await this.extraction(id);
    const rev = this.revision(id);
    const pending = ex.review.filter(r => r.blocking && !rev.acknowledged.includes(r.id));
    if (pending.length) throw new UploadError(409, 'review_required', `${pending.length} item${pending.length === 1 ? '' : 's'} still need checking against the original (for example page ${pending[0].page}: ${pending[0].message}).`);
    const t0 = performance.now();
    u = this.save({ ...u, status: 'indexing', metadata, error: undefined, failedStage: undefined });
    const docId = `upload-${id}`;
    try {
      const pageConfidence = Object.fromEntries(ex.pages.map(p => [String(p.n), p.method === 'text' ? 1 : (p.confidence ?? 0) / 100]));
      const input = {
        id: docId, title: str(metadata.title), publisher: str(metadata.publisher), type: metadata.type, edition: str(metadata.edition),
        scope: metadata.scope ?? {}, ...(metadata.url ? { url: metadata.url } : {}), demonstration: metadata.demonstration === true,
        authorization: metadata.authorization, filename: u.filename, content: rev.text,
        extraction: { method: ex.pages.some(p => p.method !== 'text') ? 'ocr' as const : 'text' as const, pageConfidence },
        upload: { uploadId: id, revision: rev.rev, basis: rev.basis, sha256: u.sha256, kind: u.kind, pageCount: ex.pageCount },
      };
      if (!SOURCE_TYPES.includes(input.type)) throw new SourceError(400, 'invalid_type', `Document type must be one of: ${SOURCE_TYPES.join(', ')}.`);
      // The library keeps one revision of an upload: the previous one is replaced.
      const doc = this.db.transaction(() => {
        const prior = this.sources.document(docId);
        if (prior?.demonstration && !input.demonstration) throw new SourceError(400, 'demonstration_required', 'Demonstration content must remain marked as demonstration.');
        if (prior) this.sources.remove(docId);
        const imported = this.sources.import(input);
        this.sources.setRegions(docId, regionsFor(this.sources.sections(docId), ex));
        if (!this.sources.searchable(docId)) throw new UploadError(500, 'not_searchable', 'The document sections were not fully stored. Retry indexing.');
        return imported;
      })();
      return this.save({ ...this.get(id), status: 'ready', docId: doc.id, indexedRevision: rev.rev, timings: { ...u.timings, indexMs: Math.round(performance.now() - t0) } });
    } catch (e) {
      const status = e instanceof SourceError || e instanceof UploadError ? e.status : 500;
      const err = e instanceof SourceError || e instanceof UploadError ? { code: e.code, message: e.message } : { code: 'indexing_failed', message: 'Indexing failed. Retry.' };
      // Validation problems (missing metadata, authorization) go back to review; other failures can be retried.
      if (status < 500) { this.save({ ...this.get(id), status: 'review', metadata }); throw e; }
      this.save({ ...this.get(id), status: 'failed', failedStage: 'indexing', error: err });
      throw e;
    }
  }

  async remove(id: string) {
    const u = this.get(id);
    if (u.docId) this.sources.remove(u.docId);
    this.db.prepare('DELETE FROM upload_revisions WHERE upload_id=?').run(id);
    this.db.prepare('DELETE FROM uploads WHERE id=?').run(id);
    await rm(join(this.dir, id), { recursive: true, force: true });
  }

  // ---------------------------------------------------------------- site photos as question context
  async observations(id: string): Promise<{ upload: UploadRecord; observations: Observation[] }> {
    const u = this.get(id);
    if (u.status !== 'ready') throw new UploadError(409, 'attachment_not_ready', `${u.filename} is still ${u.status}. Wait for it to finish or retry it.`);
    const ex = await this.extraction(id);
    const obs: Observation[] = [];
    for (const p of ex.pages) for (const l of p.lines) {
      const text = l.text.replace(/\s{2,}/g, ' ').trim();
      if (!text || text.replace(/[^a-z0-9]/gi, '').length < 2) continue;
      const kind: Observation['kind'] = MARKING.test(text) ? 'marking' : DIMENSION.test(text) ? 'dimension_text' : 'text';
      obs.push({ id: `${id}:${l.id}`, kind, text, confidence: Math.round(l.confidence), page: p.n, bbox: l.bbox, clear: l.confidence >= CLEAR });
    }
    return { upload: u, observations: obs };
  }
}

function regionsFor(sections: SourceSection[], ex: Extraction): Record<string, Array<{ page: number } & Box>> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const lines = ex.pages.flatMap(p => p.lines.map(l => ({ ...l, key: norm(l.text) }))).filter(l => l.key.length >= 3);
  const out: Record<string, Array<{ page: number } & Box>> = {};
  for (const s of sections) {
    const body = norm(`${s.sectionId} ${s.heading} ${s.text} ${(s.table ?? []).flat().join(' ')}`);
    const pages = new Set<number>();
    for (let p = s.pageStart ?? 1; p <= (s.pageEnd ?? s.pageStart ?? ex.pageCount); p++) pages.add(p);
    // For a table the cells are matched one by one; for prose the whole line must be in the passage.
    const hits: ExtractedLine[] = lines.filter(l => pages.has(l.page) && (body.includes(l.key) || (l.cells.length > 1 && l.cells.every(c => body.includes(norm(c))))));
    const byPage = new Map<number, Box[]>();
    for (const h of hits) byPage.set(h.page, [...(byPage.get(h.page) ?? []), h.bbox]);
    if (byPage.size) out[s.key] = [...byPage].map(([page, boxes]) => ({ page, ...pad(union(boxes)) }));
  }
  return out;
}
const pad = (b: Box): Box => ({ x: Math.max(0, b.x - 6), y: Math.max(0, b.y - 4), w: b.w + 12, h: b.h + 8 });
const str = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const cleanName = (name: string) => (name || 'upload').replace(/[\\/]/g, '_').replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(-120) || 'upload';
async function writeAtomic(path: string, data: Buffer) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, data, { mode: 0o600 });
  await rename(temp, path);
}
export type { ReviewItem };
