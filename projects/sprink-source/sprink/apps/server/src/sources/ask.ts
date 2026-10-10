import { excerptSections, type PdfExcerpt } from './pdf-excerpts.js';
import { JevSourceSearch, type SourceSearch } from './semantic.js';
import { randomUUID } from 'node:crypto';
import { resolveSfNfpa13Edition, type Evidence, type Fact, type SfProjectFacts, type WorkPackageSnapshot } from '@sprink/core';
import { conflicts as findConflicts, expand, type Conflict, type Retrieved, type Role } from './retrieve.js';
import { SourceError, type SourceStore } from './store.js';
type Origin = 'project' | 'sample' | 'you' | 'derived';
interface Point { x: number; y: number; z: number }
interface Box { min: Point; max: Point }
const toMm = (value: number, unit: string): number | null => {
  const factor = ({ mm: 1, m: 1000, in: 25.4, ft: 304.8 } as Record<string, number>)[unit];
  return factor && Number.isFinite(value) ? value * factor : null;
};
import { QUALITY_LABEL, SOURCE_TYPE_LABEL, type ExplanationCondition, type SourceDocument } from './types.js';

export const NO_SOURCE = "I couldn't find a supporting source in the project library.";

export interface AskRequest {
  question: string;
  packageId?: string;
  /** Piece selected on the drawing workspace. Defaults to the site condition's affected piece. */
  selectedElementId?: string;
  /** Values the user typed in the Ask panel, e.g. {name: "obstructionWidth", value: 450, unit: "mm"}. */
  measurements?: Array<{ name: string; value: number; unit: string }>;
  /** Answers to focused follow-up questions. Kept for this question only, not saved to the package. */
  answers?: { nfpa13Edition?: string; jurisdiction?: string; observations?: Record<string, 'yes' | 'no'> };
  /** Site photos or drawings attached to this question (upload ids). Context only, never a source. */
  attachments?: string[];
}

/** A site photo attached to the question, with what could be read from it. Resolved by the router. */
export interface AttachmentInput {
  upload: { id: string; filename: string; kindLabel: string; purpose: string; projectId: string | null };
  observations: Array<{ id: string; kind: 'text' | 'marking' | 'dimension_text'; text: string; confidence: number; page: number; clear: boolean }>;
}
export interface AttachmentView {
  id: string; filename: string; kindLabel: string; preview: string; note: string;
  observations: Array<{ id: string; kind: 'text' | 'marking' | 'dimension_text'; text: string; confidence: number; page: number; status: 'read' | 'unclear' | 'confirmed' | 'rejected' }>;
}

export interface ContextFact { name: string; label: string; value: string | number | null; unit: string | null; origin: Origin | 'document' | 'photo'; detail: string }
export interface FollowUp { id: string; question: string; kind: 'choice' | 'measurement'; field: string; options?: Array<{ value: string; label: string }>; unit?: string }
export interface Citation {
  key: string; docId: string; docTitle: string; publisher: string; type: SourceDocument['type']; typeLabel: string; edition: string;
  scope: SourceDocument['scope'];
  sectionId: string; heading: string; kind: string; label: string; role: Role; via?: string;
  pageStart: number | null; pageEnd: number | null; demonstration: boolean;
  flags: Array<{ flag: string; label: string }>;
  quote: string | null; quoteNote: string | null; table: string[][] | null;
  notes: Array<{ text: string; author: string }>;
  link: string; original: string | null;
  /** For uploaded documents: the reviewed revision that was indexed, and where the passage sits on the page image. */
  revision: { uploadId: string; revision: number; basis: 'extracted' | 'corrected'; label: string } | null;
  excerpt?: PdfExcerpt;
  page: { image: string; number: number; width: number | null; height: number | null } | null;
  regions: Array<{ page: number; x: number; y: number; w: number; h: number }>;
}
/** note: a reviewed plain-language note. quote: the source's own wording. pointer: go read the passage. */
export interface Claim { demonstration: boolean; id: string; text: string; citations: string[]; kind: 'note' | 'pointer' | 'quote'; status: 'supported' | 'unresolved'; reason?: string }
export interface ConditionCheck { question: string; name: string; value: number | null; unit: string; origin: ContextFact['origin'] | null; detail: string | null; op: string; limit: number; result: 'met' | 'not_met' | 'unknown' }
export interface ExceptionStatus { key: string; sectionId: string; parentSectionId: string; status: 'applies' | 'does_not_apply' | 'unknown'; checks: ConditionCheck[]; note: string }
export interface AskAnswer {
  id: string; question: string; askedAt: string;
  context: {
    projectId: string | null; packageTitle: string | null; standard: string | null;
    edition: { value: string | null; status: 'resolved' | 'answered' | 'unknown'; reason: string; script?: string };
    jurisdiction: string | null; selectedElementId: string | null;
    siteCondition: { id: string; description: string } | null;
    facts: ContextFact[];
  };
  status: 'answered' | 'needs_input' | 'no_source';
  code: 'supported_sources' | 'context_required' | 'empty_library' | 'no_supporting_source';
  demonstration: boolean;
  summary: string;
  explanation: Claim[];
  unresolved: Claim[];
  exceptions: ExceptionStatus[];
  missing: string[];
  followUps: FollowUp[];
  sources: Citation[];
  conflicts: Array<Conflict & { items: Array<{ key: string; position: string; label: string }> }>;
  excluded: Array<{ docId: string; title: string; edition: string; reason: string; demonstration: boolean }>;
  attachments: AttachmentView[];
  /** JEV selects evidence; answers quote stored source wording. */
  timings: { retrievalMs: number; compositionMs: number; modelMs: number; totalMs: number };
}

/** Quotes are retrieved verbatim; no keyword-based sentence selection. */
const sourceClaims = (items: Retrieved[]): Claim[] => items
  .map((r, i): Claim => {
    const base = { id: `c${i + 1}`, status: 'supported' as const, demonstration: r.doc.demonstration };
    const a = r.doc.authorization;
    if (a.display === 'reference_only' || r.section.table || r.section.flags.includes('embedded_instructions'))
      return { ...base, text: `${r.section.sectionId}: ${r.section.heading}. Read the source wording.`, citations: [r.section.key], kind: 'pointer' };
    const limit = a.display === 'excerpt' ? a.maxQuoteChars! : Infinity;
    return { ...base, text: r.section.text.length > limit ? `${r.section.text.slice(0, limit)}…` : r.section.text, citations: [r.section.key], kind: 'quote' };
  });

// ------------------------------------------------------------------ context

const LENGTH_UNITS = new Set(['mm', 'm', 'in', 'ft']);
const MEASUREMENTS: Record<string, { label: string; kind: 'length' | 'count' }> = {
  obstructionWidth: { label: 'Duct width along the original pipe', kind: 'length' },
  addedFittings: { label: 'Fittings the new route adds', kind: 'count' },
};

export class AskInputError extends Error {}

interface Context {
  snapshot: WorkPackageSnapshot | null;
  facts: ContextFact[];
  values: Map<string, ContextFact>;
  standard: string | null;
  edition: AskAnswer['context']['edition'];
  jurisdiction: string | null;
  productIds: string[];
  selected: { id: string; productId: string | null; start: Point | null; end: Point | null; origin: Origin; detail: string } | null;
  duct: { box: Box; origin: Origin; detail: string } | null;
}

function packageFact(s: WorkPackageSnapshot, field: string) {
  const all = [...s.detailing, ...s.siteFacts].filter(f => f.field === field && f.subjectIds.length === 0);
  return all.length === 1 ? all[0] : undefined;
}
const isSample = (f: { source: { description: string } }) => f.source.description.startsWith('SAMPLE');
const originOf = (f: { source: { description: string } }): Origin => isSample(f) ? 'sample' : 'project';

function buildContext(req: AskRequest, snapshot: WorkPackageSnapshot | null): Context {
  const facts: ContextFact[] = [];
  const values = new Map<string, ContextFact>();
  const put = (f: ContextFact, key = f.name) => { facts.push(f); if (!values.has(key) || f.origin === 'you') values.set(key, f); };
  let standard: string | null = null, jurisdiction: string | null = null;
  let edition: Context['edition'] = { value: null, status: 'unknown', reason: 'No project is open, so the code edition is not known.' };
  let selected: Context['selected'] = null, duct: Context['duct'] = null;
  const productIds: string[] = [];

  if (snapshot) {
    const confirmed = (field: string) => { const f = packageFact(snapshot, field); return f && f.confirmation === 'confirmed' && f.value !== null ? f : undefined; };
    for (const [field, label] of [['jurisdiction', 'Jurisdiction'], ['standard', 'Standard'], ['permitKind', 'Permit kind'], ['originalNfpa13Edition', 'NFPA 13 edition of the original permit'], ['originalFirePermitNumber', 'Original fire permit number']] as const) {
      const f = packageFact(snapshot, field);
      if (!f) continue;
      put({ name: field, label, value: f.value as string, unit: null, origin: originOf(f), detail: f.confirmation === 'confirmed' ? `Confirmed in the work package: ${f.source.description}` : `Proposed, not confirmed: ${f.source.description}` });
    }
    standard = (confirmed('standard')?.value as string) ?? null;
    jurisdiction = (confirmed('jurisdiction')?.value as string) ?? null;
    edition = resolveEdition(snapshot);
    for (const e of snapshot.baselinePlan?.entities ?? []) if (e.productId && !productIds.includes(e.productId)) productIds.push(e.productId);
    const sampleRun = snapshot.sourceDrawing?.drawingId.startsWith('SAMPLE') === true;
    const findPipe = (id: string | null | undefined) => snapshot.baselinePlan?.entities.find(e => e.id === id && e.kind === 'pipe');
    let piece = findPipe(req.selectedElementId ?? snapshot.changeRequest?.affectedEntityIds[0]);
    if (req.selectedElementId && !piece) {
      // A piece of a generated route is not part of the confirmed run; fall back to the affected piece and say so.
      piece = findPipe(snapshot.changeRequest?.affectedEntityIds[0]);
      put({ name: 'selectionNote', label: 'Selection', value: `${req.selectedElementId} is not a piece of the confirmed run`, unit: null, origin: 'project',
        detail: piece ? `Used the site condition's affected piece ${piece.id} instead.` : 'No piece was used.' });
    }
    if (piece) {
      const [a, b] = piece.ports;
      selected = { id: piece.id, productId: piece.productId ?? null, start: a?.position ?? null, end: b?.position ?? null, origin: sampleRun ? 'sample' : 'project',
        detail: `From the ${snapshot.baselinePlan!.confirmation} run on drawing ${snapshot.sourceDrawing?.drawingId ?? '(none)'}` };
      put({ name: 'selectedElement', label: 'Selected piece', value: piece.id, unit: null, origin: selected.origin, detail: selected.detail });
    }
    const boxFacts = ['min.x', 'min.y', 'min.z', 'max.x', 'max.y', 'max.z'].map(k => packageFact(snapshot, `duct.${k}`));
    if (boxFacts.every(f => f && f.confirmation === 'confirmed' && typeof f.value === 'number' && f.unit === 'mm')) {
      const v = boxFacts.map(f => f!.value as number);
      const origin = boxFacts.some(f => isSample(f!)) ? 'sample' : 'project';
      duct = { box: { min: { x: v[0], y: v[1], z: v[2] }, max: { x: v[3], y: v[4], z: v[5] } }, origin, detail: 'Measured duct box confirmed in the work package' };
      put({ name: 'ductBox', label: 'Measured duct box', value: `x ${v[0]}–${v[3]}, y ${v[1]}–${v[4]}, z ${v[2]}–${v[5]}`, unit: 'mm', origin, detail: duct.detail });
      // Derived: how wide the duct is along the selected piece, for exceptions that depend on it.
      if (selected?.start && selected.end) {
        const axes = (['x', 'y', 'z'] as const).filter(k => selected!.start![k] !== selected!.end![k]);
        if (axes.length === 1) {
          const k = axes[0];
          put({ name: 'obstructionWidth', label: MEASUREMENTS.obstructionWidth.label, value: v[3 + 'xyz'.indexOf(k)] - v['xyz'.indexOf(k)], unit: 'mm', origin: 'derived',
            detail: `Duct box extent along piece ${selected.id} (${k} axis), from the measured duct box` });
        }
      }
    }
    if (snapshot.changeRequest) put({ name: 'siteCondition', label: 'Site condition', value: snapshot.changeRequest.description, unit: null, origin: originOf({ source: { description: snapshot.changeRequest.description } }), detail: 'Reported in the work package' });
  }

  // Answers to follow-ups apply to this question only.
  if (req.answers?.jurisdiction && !jurisdiction) {
    jurisdiction = req.answers.jurisdiction;
    put({ name: 'jurisdiction', label: 'Jurisdiction', value: jurisdiction, unit: null, origin: 'you', detail: 'Answered in Ask Sprink (not saved to the package)' });
  }
  const answered = req.answers?.nfpa13Edition;
  if (answered && answered !== 'unsure') {
    if (edition.status === 'resolved' && edition.value !== answered)
      edition = { ...edition, reason: `${edition.reason} Your answer (${answered}) differs from the project records, so it was not used. Fix the project inputs if the records are wrong.` };
    else if (edition.status !== 'resolved') {
      edition = { value: answered, status: 'answered', reason: `You said NFPA 13 ${answered} applies. This answer is not saved to the package.` };
      standard = standard ?? 'nfpa13';
    }
  }
  for (const m of req.measurements ?? []) {
    const spec = Object.hasOwn(MEASUREMENTS, m.name) ? MEASUREMENTS[m.name] : undefined;
    if (!spec) throw new AskInputError(`Unknown measurement "${m.name}".`);
    if (typeof m.value !== 'number' || !Number.isFinite(m.value)) throw new AskInputError(`${spec.label} must be a number.`);
    if (spec.kind === 'length' && !LENGTH_UNITS.has(m.unit)) throw new AskInputError(`${spec.label} needs a length unit (mm, m, in or ft).`);
    if (spec.kind === 'count' && (m.unit !== 'count' || !Number.isSafeInteger(m.value) || m.value < 0)) throw new AskInputError(`${spec.label} must be a whole number.`);
    if (spec.kind === 'length' && (m.value <= 0 || !Number.isFinite(toMm(m.value, m.unit)))) throw new AskInputError(`${spec.label} must be greater than 0.`);
    put({ name: m.name, label: spec.label, value: m.value, unit: m.unit, origin: 'you', detail: 'Entered by you in Ask Sprink' });
  }
  return { snapshot, facts, values, standard, edition, jurisdiction, productIds, selected, duct };
}

/** Uses the existing San Francisco edition resolver. The newest edition is never assumed. */
function resolveEdition(s: WorkPackageSnapshot): AskAnswer['context']['edition'] {
  const f = (field: string): Fact<never> | undefined => {
    const x = packageFact(s, field);
    return x ? { value: x.value as never, confirmed: x.confirmation === 'confirmed', evidenceIds: [x.id], source: 'manual' } : undefined;
  };
  const j = packageFact(s, 'jurisdiction');
  if (!j || j.confirmation !== 'confirmed') return { value: null, status: 'unknown', reason: 'The jurisdiction is not confirmed in the project inputs, so the adopted edition is not known.' };
  if (j.value !== 'san_francisco') return { value: null, status: 'unknown', reason: `No edition resolver exists for jurisdiction "${j.value}". Confirm the adopted edition.` };
  const facts = { jurisdiction: f('jurisdiction')!, standard: f('standard')!, permitKind: f('permitKind')!,
    ...Object.fromEntries(['sitePermitCodeCycle', 'architecturalPermitCodeCycle', 'editionElection', 'ownerRequestedEdition', 'originalFirePermitNumber', 'originalNfpa13Edition']
      .map(k => [k, f(k)]).filter(([, v]) => v)) } as SfProjectFacts;
  const observations: Evidence[] = [...s.detailing, ...s.siteFacts].map(x => ({ id: x.id, targetId: s.projectId }));
  const r = resolveSfNfpa13Edition(facts, { targetId: s.projectId, taskRevision: s.inputRevision, observations });
  const script = 'resolveSfNfpa13Edition (@sprink/core, SFFD AB 2.04 Note 1)';
  if (r.status === 'resolved') return { value: r.nfpa13Edition, status: 'resolved', reason: `${r.reason} Resolved from the package's confirmed permit facts; no permit record is attached.`, script };
  return { value: null, status: 'unknown', reason: `${r.reason}${r.missingInputs.length ? ` Missing: ${r.missingInputs.join(', ')}.` : ''}`, script };
}

// ------------------------------------------------------------------ applicability of documents

function applicability(doc: SourceDocument, ctx: Context): { ok: boolean; reason: string; blockedBy?: 'edition' | 'jurisdiction' | 'standard' | 'product' } {
  switch (doc.type) {
    case 'published_code':
      if (!ctx.standard) return { ok: false, reason: 'The project standard is not confirmed.', blockedBy: 'standard' };
      if (doc.scope.standard !== ctx.standard) return { ok: false, reason: `This document covers ${doc.scope.standard}, not the project standard ${ctx.standard}.` };
      if (!ctx.edition.value) return { ok: false, reason: 'The applicable edition is not confirmed, so no edition was chosen.', blockedBy: 'edition' };
      if (doc.edition !== ctx.edition.value) return { ok: false, reason: `Edition ${doc.edition} is not the project's edition (${ctx.edition.value}). It was not substituted.` };
      return { ok: true, reason: '' };
    case 'local_amendment':
      if (ctx.standard && doc.scope.standard !== ctx.standard) return { ok: false, reason: 'This amendment covers a different standard.' };
      if (!ctx.jurisdiction) return { ok: false, reason: 'The jurisdiction is not confirmed.', blockedBy: 'jurisdiction' };
      if (doc.scope.jurisdiction !== ctx.jurisdiction) return { ok: false, reason: `This amendment is for ${doc.scope.jurisdiction}, not ${ctx.jurisdiction}.` };
      if (!ctx.edition.value) return { ok: false, reason: 'The applicable edition is not confirmed.', blockedBy: 'edition' };
      if (doc.scope.amendsEdition !== ctx.edition.value) return { ok: false, reason: `This amends the ${doc.scope.amendsEdition} edition, not ${ctx.edition.value}.` };
      return { ok: true, reason: '' };
    case 'manufacturer':
      if (!ctx.productIds.length) return { ok: false, reason: 'No product in the run is known, so these instructions were not matched to one.', blockedBy: 'product' };
      if (!doc.scope.productIds!.some(p => ctx.productIds.includes(p))) return { ok: false, reason: 'None of the products it covers are in this run.' };
      return { ok: true, reason: '' };
    case 'project_document':
      if (!ctx.snapshot) return { ok: false, reason: 'No project is open.' };
      if (doc.scope.projectId !== ctx.snapshot.projectId) return { ok: false, reason: 'It belongs to a different project.' };
      return { ok: true, reason: '' };
    case 'company_procedure':
      return { ok: true, reason: '' };
  }
}

// ------------------------------------------------------------------ citations

const ROLE_ORDER: Role[] = ['main', 'amendment', 'exception', 'referenced', 'footnote', 'related', 'definition', 'commentary'];
function citation(r: Retrieved): Citation {
  const a = r.doc.authorization, up = r.doc.upload;
  const pageNo = r.section.regions?.[0]?.page ?? r.section.pageStart;
  let quote: string | null = r.section.text, quoteNote: string | null = null, table = r.section.table;
  if (a.display === 'reference_only') { quote = null; table = null; quoteNote = 'The source permits reference only. Open the original to read the wording.'; }
  else if (a.display === 'excerpt' && quote.length > a.maxQuoteChars!) { quote = `${quote.slice(0, a.maxQuoteChars!)}…`; table = null; quoteNote = `Shortened to the ${a.maxQuoteChars} characters the source permits. Open the original for the full text.`; }
  const label = r.section.kind === 'commentary' ? 'Explanatory, not a requirement'
    : r.section.kind === 'definition' ? 'Definition'
    : r.section.kind === 'exception' ? 'Exception'
    : r.section.kind === 'table' ? 'Table'
    : r.section.kind === 'footnote' ? 'Note to the passage above'
    : r.doc.type === 'company_procedure' ? 'Company procedure'
    : r.doc.type === 'manufacturer' ? 'Manufacturer instruction'
    : r.doc.type === 'project_document' ? 'Project requirement'
    : r.doc.type === 'local_amendment' ? 'Local amendment'
    : r.section.kind === 'requirement' ? 'Requirement text' : 'Source text';
  return {
    key: r.section.key, docId: r.doc.id, docTitle: r.doc.title, publisher: r.doc.publisher, type: r.doc.type, typeLabel: SOURCE_TYPE_LABEL[r.doc.type], edition: r.doc.edition,
    scope: r.doc.scope,
    sectionId: r.section.sectionId, heading: r.section.heading, kind: r.section.kind, label, role: r.role, via: r.via,
    pageStart: r.section.pageStart, pageEnd: r.section.pageEnd, demonstration: r.doc.demonstration,
    flags: r.section.flags.map(f => ({ flag: f, label: QUALITY_LABEL[f] })),
    quote, quoteNote, table, notes: a.display === 'full' ? r.notes.map(n => ({ text: n.text, author: n.author })) : [],
    excerpt: a.display === 'full' ? r.section.pdfExcerpt : undefined,
    link: `/api/sources/${encodeURIComponent(r.doc.id)}/sections/${encodeURIComponent(r.section.pdfExcerpt?.sectionKey ?? r.section.key)}`,
    original: r.doc.url ?? (a.display === 'full' ? (up ? `/api/uploads/${up.uploadId}/original` : `/api/sources/${encodeURIComponent(r.doc.id)}/file`) : null),
    revision: up ? { uploadId: up.uploadId, revision: up.revision, basis: up.basis, label: `Revision ${up.revision} (${up.basis === 'corrected' ? 'text corrected in review' : 'as extracted, reviewed'})` } : null,
    // The page image shows the whole page, so it is offered only where the source allows full display.
    page: r.doc.pdf && a.display === 'full' && pageNo && pageNo <= r.doc.pdf.pageCount ? { image: `/api/sources/${encodeURIComponent(r.doc.id)}/pages/${pageNo}`, number: pageNo, width: null, height: null } : up && a.display === 'full' && pageNo ? { image: `/api/uploads/${up.uploadId}/pages/${pageNo}`, number: pageNo, width: null, height: null } : null,
    regions: up && a.display === 'full' ? (r.section.regions ?? []) : [],
  };
}

function attachmentContext(inputs: AttachmentInput[], req: AskRequest, ctx: Context, followUps: FollowUp[], missing: string[]): AttachmentView[] {
  const confirmations = req.answers?.observations ?? {};
  return inputs.map(({ upload, observations }) => {
    if (upload.purpose !== 'site_photo') throw new AskInputError(`${upload.filename} is a reference document. Add it to the library instead of attaching it to a question.`);
    if (ctx.snapshot && upload.projectId && upload.projectId !== ctx.snapshot.projectId) throw new AskInputError(`${upload.filename} was attached in a different project.`);
    const view: AttachmentView = {
      id: upload.id, filename: upload.filename, kindLabel: upload.kindLabel, preview: `/api/uploads/${upload.id}/preview`,
      note: 'Site photo: used as context for this question. It is not a code source and is never cited as one.', observations: [],
    };
    ctx.facts.push({ name: `photo:${upload.id}`, label: 'Site photo attached', value: upload.filename, unit: null, origin: 'photo', detail: view.note });
    const readable: string[] = [];
    let dimensions = 0;
    for (const o of observations) {
      const answer = confirmations[o.id];
      const status: AttachmentView['observations'][number]['status'] = answer === 'yes' ? 'confirmed' : answer === 'no' ? 'rejected' : o.clear ? 'read' : 'unclear';
      view.observations.push({ id: o.id, kind: o.kind, text: o.text, confidence: o.confidence, page: o.page, status });
      if (status === 'rejected') continue;
      if (o.kind === 'marking') {
        if (status === 'unclear') {
          followUps.push({ id: o.id, field: `observation:${o.id}`, kind: 'choice', question: `Does the marking in ${upload.filename} read “${o.text}”?`,
            options: [{ value: 'yes', label: 'Yes, that is what it says' }, { value: 'no', label: 'No, it is misread' }] });
          missing.push(`Confirmation of the product marking “${o.text}” (read from the photo with low confidence).`);
        } else ctx.facts.push({ name: `marking:${o.id}`, label: 'Product marking in the photo', value: o.text, unit: null, origin: status === 'confirmed' ? 'you' : 'photo',
          detail: status === 'confirmed' ? `Confirmed by you from ${upload.filename}` : `Read from ${upload.filename} by OCR (confidence ${o.confidence}). Not confirmed.` });
      } else if (o.kind === 'dimension_text') {
        dimensions += 1;
        // Printed or written numbers in a photo are never used as measurements.
        ctx.facts.push({ name: `photoText:${o.id}`, label: 'Dimension text in the photo', value: o.text, unit: null, origin: 'photo',
          detail: `Text read from ${upload.filename}. A photo has no scale, so this is not a measurement and is not used in calculations.` });
      } else if (status !== 'unclear') readable.push(o.text);
    }
    if (readable.length) ctx.facts.push({ name: `photoTextAll:${upload.id}`, label: 'Other readable text in the photo', value: readable.join(' · ').slice(0, 300), unit: null, origin: 'photo', detail: `Read from ${upload.filename} by OCR. Not confirmed.` });
    if (dimensions) missing.push('Site measurements. Numbers visible in a photo are not measurements; measure on site and enter the values.');
    return view;
  });
}

// ------------------------------------------------------------------ main flow

export async function ask(store: SourceStore, req: AskRequest, snapshot: WorkPackageSnapshot | null, attachmentInputs: AttachmentInput[] = [], search: SourceSearch = new JevSourceSearch()): Promise<AskAnswer> {
  const t0 = performance.now();
  validateAskRequest(req);
  const question = req.question.trim();
  const ctx = buildContext(req, snapshot);
  let modelMs = 0;
  const followUps: FollowUp[] = [], missing: string[] = [];
  const excluded: AskAnswer['excluded'] = [];
  const attachments = attachmentContext(attachmentInputs, req, ctx, followUps, missing);

  // ---------------- retrieval
  const r0 = performance.now();
  let items: Retrieved[] = [];
  let libraryEmpty = true;
  const mainKeys = new Set<string>();
  {
    const docs = store.documents();
    const docById = new Map(docs.map(d => [d.id, d]));
    const verdicts = new Map(docs.map(d => [d.id, applicability(d, ctx)]));
    const blocked = new Set<string>();
    const eligible = docs.filter(d => d.authorization.useWithAi && (!d.scope.projectId || d.scope.projectId === snapshot?.projectId));
    libraryEmpty = eligible.length === 0;
    const passages = eligible.flatMap(doc => store.sections(doc.id).map(section => ({ doc, section })));
    const started = performance.now();
    // Keep other editions from contributing to an applicable batch's existence verdict.
    const groups = [true, false].flatMap(ok => [true, false].map(demo => passages.filter(p => verdicts.get(p.doc.id)!.ok === ok && p.doc.demonstration === demo))).filter(p => p.length);
    const keys = new Set((await Promise.all(groups.map(rows => search.select(question, rows)))).flat());
    assertUnchanged(store, eligible);
    modelMs += performance.now() - started;
    const mains: Retrieved[] = [];
    for (const { doc, section } of passages.filter(p => keys.has(p.section.key))) {
      const verdict = verdicts.get(doc.id)!;
      if (!verdict.ok) {
        if (verdict.blockedBy) blocked.add(verdict.blockedBy);
        if (!excluded.some(e => e.docId === doc.id)) excluded.push({ docId: doc.id, title: doc.title, edition: doc.edition, reason: verdict.reason, demonstration: doc.demonstration });
        continue;
      }
      mains.push({ section, doc, role: section.kind === 'definition' || section.kind === 'commentary' ? section.kind : 'main', score: 0, notes: store.notes(section.key) });
    }
    for (const m of mains) mainKeys.add(m.section.key);
    items = expand(store, mains, eligible.filter(d => verdicts.get(d.id)!.ok));
    if (blocked.has('edition') || blocked.has('standard')) {
      const editions = [...new Set(docs.filter(d => d.type === 'published_code').map(d => d.edition))].sort().reverse();
      followUps.push({ id: 'edition', field: 'nfpa13Edition', kind: 'choice', question: 'Which NFPA 13 edition applies to this permit?',
        options: [...editions.map(e => ({ value: e, label: e })), { value: 'unsure', label: 'Not sure' }] });
      missing.push(`Applicable code edition. ${ctx.edition.reason}`);
    }
    // The project's edition is known but the library does not hold it: say so, never substitute.
    const codeMatches = excluded.filter(e => docById.get(e.docId)?.type === 'published_code' && docById.get(e.docId)?.scope.standard === ctx.standard);
    if (ctx.edition.value && codeMatches.length && !items.some(i => i.doc.type === 'published_code'))
      missing.push(`No ${ctx.standard?.toUpperCase().replace('NFPA', 'NFPA ')} ${ctx.edition.value} text is in the project library. It holds ${[...new Set(codeMatches.map(e => e.edition))].join(' and ')}, which were not substituted.`);
    if (blocked.has('product'))
      missing.push('The installed product. Manufacturer instructions are used only for products known to be in the run; open the work package with its confirmed run.');
    if (blocked.has('jurisdiction')) {
      followUps.push({ id: 'jurisdiction', field: 'jurisdiction', kind: 'choice', question: 'Which jurisdiction is this project in?',
        options: [...new Set(docs.filter(d => d.type === 'local_amendment').map(d => d.scope.jurisdiction!))].map(j => ({ value: j, label: j.replace(/_/g, ' ') })) });
      missing.push('Jurisdiction, needed to choose local amendments.');
    }
  }
  const retrievalMs = performance.now() - r0;

  // ---------------- exceptions: evaluate the stated conditions with known facts, ask for the rest
  const exceptions: ExceptionStatus[] = [];
  for (const r of items.filter(i => i.role === 'exception')) {
    const conds: ExplanationCondition[] = (r.doc.authorization.display === 'full' ? r.notes : []).flatMap(n => n.conditions ?? []);
    if (!conds.length) {
      exceptions.push({ key: r.section.key, sectionId: r.section.sectionId, parentSectionId: r.via ?? '', status: 'unknown', checks: [], note: 'Read the exception wording to decide whether it applies.' });
      continue;
    }
    const checks: ConditionCheck[] = conds.map(cond => {
      const f = ctx.values.get(cond.input.name);
      let value: number | null = null;
      if (f && typeof f.value === 'number') value = cond.input.unit === 'mm' ? toMm(f.value, f.unit ?? 'mm') : f.value;
      const cmp = (a: number) => cond.appliesWhen.op === '<=' ? a <= cond.appliesWhen.value : cond.appliesWhen.op === '<' ? a < cond.appliesWhen.value : cond.appliesWhen.op === '>=' ? a >= cond.appliesWhen.value : a > cond.appliesWhen.value;
      return { question: cond.question, name: cond.input.name, value, unit: cond.input.unit, origin: f?.origin ?? null, detail: f?.detail ?? null, op: cond.appliesWhen.op, limit: cond.appliesWhen.value, result: value === null ? 'unknown' : cmp(value) ? 'met' : 'not_met' };
    });
    const status = checks.some(c => c.result === 'not_met') ? 'does_not_apply' : checks.every(c => c.result === 'met') ? 'applies' : 'unknown';
    exceptions.push({ key: r.section.key, sectionId: r.section.sectionId, parentSectionId: r.via ?? '', status, checks,
      note: status === 'applies' ? 'Based on the values shown, this exception appears to apply. Read its wording to confirm.'
        : status === 'does_not_apply' ? 'Based on the values shown, this exception does not appear to apply.'
        : 'Whether this exception applies depends on the missing values.' });
    if (status === 'unknown') for (const c of checks.filter(x => x.result === 'unknown')) {
      if (!followUps.some(f => f.field === c.name)) followUps.push({ id: c.name, field: c.name, kind: 'measurement', question: c.question, unit: c.unit });
      if (!missing.some(m => m.startsWith(MEASUREMENTS[c.name]?.label ?? c.name))) missing.push(`${MEASUREMENTS[c.name]?.label ?? c.name}, to decide whether ${r.section.sectionId} applies.`);
    }
  }

  // ---------------- explanation, validated against the stored passages
  const k0 = performance.now();
  const supported = sourceClaims(items);
  const unresolved: Claim[] = [];
  const compositionMs = performance.now() - k0;
  const sources = items.map(citation).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  const label = (key: string) => { const s = sources.find(x => x.key === key)!; return `${s.sectionId} (${s.edition})`; };
  const conflicts = findConflicts(items).map(c => ({ ...c, items: c.items.map(i => ({ ...i, label: label(i.key) })) }));

  // A direct match counts even when expansion relabels it (a matched amendment becomes role "amendment").
  const hasSources = items.some(i => i.role === 'main' || mainKeys.has(i.section.key));
  let status: AskAnswer['status'];
  let summary: string;
  if (!hasSources) {
    status = followUps.length ? 'needs_input' : 'no_source';
    summary = NO_SOURCE + (followUps.length ? ' Answer the question below so the right edition or jurisdiction can be searched.' : '')
      + (excluded.length && !followUps.length ? ` Matching passages exist only in documents that do not apply here (${excluded.map(e => `${e.title} ${e.edition}`).join('; ')}).` : '');
  } else {
    status = followUps.length ? 'needs_input' : 'answered';
    const editionGap = missing.find(m => m.startsWith('No ') && m.includes('text is in the project library'));
    const docs = new Set(items.map(i => i.doc.id)).size;
    const applied = exceptions.filter(e => e.status === 'applies');
    const quoted = supported.filter(c => c.kind === 'quote').length;
    const open = exceptions.filter(e => e.status === 'unknown');
    summary = `${supported.length} point${supported.length === 1 ? '' : 's'} from ${docs} document${docs === 1 ? '' : 's'} in the project library${ctx.edition.value ? `, project edition ${ctx.edition.value}` : ''}.`
      + (quoted ? ` ${quoted === supported.length ? 'All are' : `${quoted} ${quoted === 1 ? 'is' : 'are'}`} quoted directly from the source.` : '')
      + (applied.length ? ` ${applied.map(e => e.sectionId).join(', ')} appears to apply and changes what is required.` : '')
      + (open.length ? ` ${open.map(e => e.sectionId).join(', ')} may change this; read ${open.length === 1 ? 'its' : 'their'} wording.` : '')
      + (editionGap ? ` ${editionGap}` : '')
      + (conflicts.length ? ` ${conflicts.length} disagreement${conflicts.length === 1 ? '' : 's'} between sources need${conflicts.length === 1 ? 's' : ''} resolving.` : '');
  }

  const demonstration = sources.some(s => s.demonstration) || excluded.some(d => d.demonstration);
  const totalMs = performance.now() - t0;
  return {
    id: randomUUID(), question, askedAt: new Date().toISOString(),
    context: {
      projectId: snapshot?.projectId ?? null, packageTitle: (snapshot as { title?: string } | null)?.title ?? null, standard: ctx.standard,
      edition: ctx.edition, jurisdiction: ctx.jurisdiction, selectedElementId: ctx.selected?.id ?? null,
      siteCondition: snapshot?.changeRequest ? { id: snapshot.changeRequest.id, description: snapshot.changeRequest.description } : null,
      facts: ctx.facts,
    },
    status, code: status === 'answered' ? 'supported_sources' : status === 'needs_input' ? 'context_required' : libraryEmpty ? 'empty_library' : 'no_supporting_source',
    demonstration, summary: demonstration ? `Demonstration content: invented test data, not actual code or manufacturer requirements. ${summary}` : summary, explanation: supported, unresolved, exceptions, missing, followUps, sources, conflicts, excluded, attachments,
    timings: { retrievalMs: round(retrievalMs), compositionMs: round(compositionMs), modelMs: round(modelMs), totalMs: round(totalMs) },
  };
}
const round = (n: number) => Math.round(n * 10) / 10;


/** Only operator-maintained common references enter the public search catalog. */
export const isSharedReference = (doc: SourceDocument): boolean =>
  !doc.demonstration && !doc.scope.projectId && doc.type !== 'project_document' && doc.authorization.useWithAi;

/** Reference lookup does not decide which edition or product governs a project. */
export async function searchRules(store: SourceStore, question: string, search: SourceSearch = new JevSourceSearch()): Promise<AskAnswer> {
  const t0 = performance.now();
  validateQuestion(question);
  question = question.trim();
  const docs = store.documents().filter(isSharedReference);
  const passages = docs.flatMap(doc => {
    const sections = store.sections(doc.id);
    return [...sections, ...excerptSections(doc, sections)].map(section => ({ doc, section }));
  });
  const keys = new Set(passages.length ? await search.select(question, passages) : []);
  assertUnchanged(store, docs);
  const mains: Retrieved[] = passages.filter(p => keys.has(p.section.key)).map(p => ({ ...p, role: 'main', score: 0, notes: store.notes(p.section.key) }));
  // Expand inside each document only: a shared catalog can hold unrelated jurisdictions and editions.
  const items = docs.flatMap(doc => expand(store, mains.filter(m => m.doc.id === doc.id), [doc]));
  const sources = items.map(citation);
  const retrievalMs = performance.now() - t0;
  const documentCount = new Set(sources.map(s => s.docId)).size;
  const conflicts = findConflicts(items).map(c => ({ ...c, items: c.items.map(i => ({ ...i, label: `${sources.find(s => s.key === i.key)!.sectionId} (${sources.find(s => s.key === i.key)!.edition})` })) }));
  return {
    id: randomUUID(), question, askedAt: new Date().toISOString(),
    context: { projectId: null, packageTitle: null, standard: null, edition: { value: null, status: 'unknown', reason: 'Reference search does not determine the edition adopted for a project.' }, jurisdiction: null, selectedElementId: null, siteCondition: null, facts: [] },
    status: sources.length ? 'answered' : 'no_source',
    code: sources.length ? 'supported_sources' : docs.length ? 'no_supporting_source' : 'empty_library', demonstration: false,
    summary: sources.length
      ? `${sources.length} matching passage${sources.length === 1 ? '' : 's'} from ${documentCount} document${documentCount === 1 ? '' : 's'} in the shared library. Check each source’s edition and scope for your situation.${conflicts.length ? ' These sources disagree; confirm which authority governs before applying them.' : ''}`
      : "No supporting passage was found in the shared library. The requested rule or edition may not be included.",
    explanation: sourceClaims(items), sources,
    unresolved: [], exceptions: items.filter(r => r.role === 'exception').map(r => ({ key: r.section.key, sectionId: r.section.sectionId, parentSectionId: r.via ?? '', status: 'unknown', checks: [], note: 'Read the exception wording; reference search does not determine project applicability.' })),
    missing: sources.length ? ['Project jurisdiction, adopted edition, and product applicability are not determined by reference search.'] : [], followUps: [], conflicts, excluded: [], attachments: [],
    timings: { retrievalMs: round(retrievalMs), compositionMs: 0, modelMs: round(retrievalMs), totalMs: round(performance.now() - t0) },
  };
}

// Validate before package/upload lookups as well as at the direct function boundary.
export function validateQuestion(question: unknown): asserts question is string {
  if (typeof question !== 'string' || !question.trim()) throw new AskInputError('Type a question.');
  if (question.length > 1000) throw new AskInputError('Keep the question under 1000 characters.');
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function validateAskRequest(value: unknown): asserts value is AskRequest {
  if (!record(value)) throw new AskInputError('Send a question.');
  validateQuestion(value.question);
  for (const field of ['packageId', 'selectedElementId'] as const)
    if (value[field] !== undefined && (typeof value[field] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(value[field]))) throw new AskInputError('Invalid context identifier.');
  if (value.attachments !== undefined && (!Array.isArray(value.attachments) || value.attachments.length > 6 || value.attachments.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(id)))) throw new AskInputError('Attach at most 6 valid upload ids.');
  if (value.measurements !== undefined && (!Array.isArray(value.measurements) || value.measurements.length > 10 || value.measurements.some(m => !record(m) || typeof m.name !== 'string' || typeof m.value !== 'number' || !Number.isFinite(m.value) || typeof m.unit !== 'string'))) throw new AskInputError('Invalid measurements.');
  if (value.answers !== undefined) {
    if (!record(value.answers)) throw new AskInputError('Invalid follow-up answers.');
    for (const field of ['nfpa13Edition', 'jurisdiction']) {
      const answer = value.answers[field];
      if (answer !== undefined && (typeof answer !== 'string' || !answer.trim() || answer.length > 60)) throw new AskInputError('Invalid follow-up answers.');
    }
    const observations = value.answers.observations;
    if (observations !== undefined && (!record(observations) || Object.keys(observations).length > 100 || Object.entries(observations).some(([key, v]) => key.length > 120 || !['yes', 'no'].includes(v as string)))) throw new AskInputError('Invalid observation answers.');
  }
}
function assertUnchanged(store: SourceStore, docs: SourceDocument[]) {
  if (docs.some(doc => JSON.stringify(store.document(doc.id)) !== JSON.stringify(doc)))
    throw new SourceError(503, 'source_unavailable', 'The source library changed during search. Please try again.');
}
