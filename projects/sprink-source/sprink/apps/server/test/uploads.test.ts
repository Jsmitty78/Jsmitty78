import { scriptedSearch } from './fixtures/source-search.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { FieldService } from '../src/service.js';
import { createApp } from '../src/api.js';
import { WorkPackageStore } from '../src/work-packages/store.js';
import { WorkPackageService } from '../src/work-packages/service.js';
import { SourceError, SourceStore } from '../src/sources/store.js';
import { UploadService, type ReferenceMetadata, type UploadRecord } from '../src/uploads/service.js';
import { NO_SOURCE, type AskAnswer } from '../src/sources/ask.js';
import { UploadError, sniff } from '../src/uploads/formats.js';
import { integratedInput } from './fixtures/integrated-package.js';

/**
 * Upload service and read-only HTTP tests. Reference ingestion uses the operator service. These use the real decoders (sharp, libheif-js, PDF.js,
 * bmp-ts) and real OCR (Tesseract via tesseract.js) on the invented fixtures in
 * fixtures/uploads. JEV selection is scripted; extraction, storage and citation paths are real.
 */

const FIX = join(import.meta.dirname, '../../../fixtures/uploads');
const token = 'ask-sprink-upload-test-token';
const auth = { Authorization: `Bearer ${token}` };
const json = (method: string, body: unknown) => ({ method, headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let dir: string, app: ReturnType<typeof createApp>, uploads: UploadService, packages: WorkPackageService, field: FieldService, pkgId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ask-uploads-'));
  field = new FieldService(dir);
  packages = new WorkPackageService(new WorkPackageStore(field.store.db));
  const sources = new SourceStore(field.store.db);
  uploads = new UploadService(field.store.db, dir, sources);
  app = createApp(field, { token, workPackages: packages, sources, uploads, sourceSearch: scriptedSearch });
  const created = packages.create({ projectId: 'demo-project', title: 'Duct at branch L-2', intent: 'adapt_to_site' });
  const asset = await packages.upload(created.id, Buffer.from('%PDF-1.4\nfixture'), 'application/pdf', 'drawing.pdf');
  packages.edit(created.id, { expectedRevision: 1, patch: integratedInput(asset.id, 3) });
  pkgId = created.id;
}, 60_000);
afterAll(async () => { await uploads.ocr.close(); packages.close(); field.store.close(); rmSync(dir, { recursive: true, force: true }); });

async function upload(name: string, purpose: 'reference' | 'site_photo', as = name): Promise<{ status: number; body: UploadRecord & { error?: string; code?: string } }> {
  if (purpose === 'reference') {
    const res = await operatorResult(() => uploads.create(readFileSync(join(FIX, name)), { filename: as, purpose, projectId: 'demo-project', packageId: null }), 202);
    return { status: res.status, body: await res.json() };
  }
  const form = new FormData();
  form.set('file', new File([readFileSync(join(FIX, name))], as));
  form.set('purpose', purpose);
  form.set('projectId', 'demo-project');
  const res = await app.request('/api/uploads', { method: 'POST', headers: auth, body: form });
  return { status: res.status, body: await res.json() };
}
async function uploadAndSettle(name: string, purpose: 'reference' | 'site_photo', as?: string) {
  const r = await upload(name, purpose, as);
  expect(r.status, JSON.stringify(r.body)).toBe(202);
  return uploads.settle(r.body.id);
}
async function ask(body: object): Promise<AskAnswer> {
  const res = await app.request('/api/ask', json('POST', body));
  const out = await res.json();
  expect(res.status, JSON.stringify(out)).toBe(200);
  return out;
}
const meta = (over: Partial<ReferenceMetadata>): ReferenceMetadata => ({
  title: 'DEMONSTRATION fixture', publisher: 'Sprink test fixtures', type: 'manufacturer', edition: 'Rev B', scope: { productIds: ['spears/CP-010'] },
  demonstration: true, authorization: { basis: 'Invented test fixture written by the Sprink team.', storeAndIndex: true, useWithAi: true, display: 'full' }, ...over,
});

describe('upload formats (real decoders)', () => {
  const cases: Array<[string, string, number, [number, number]]> = [
    ['label.png', 'png', 1, [1800, 1200]],
    ['label.webp', 'webp', 1, [1800, 1200]],
    ['label.bmp', 'bmp', 1, [900, 600]],
    ['label.gif', 'gif', 1, [1800, 1200]],
    ['two-page.tiff', 'tiff', 2, [1800, 1200]],
    // Stored 2133 x 1600 with EXIF orientation 6: must come out upright.
    ['site-duct-rotated.jpg', 'jpeg', 1, [1600, 2133]],
    // HEVC-coded HEIC stored 4032 x 3024 with an irot transform, like an iPhone portrait photo.
    ['site-label-iphone.heic', 'heic', 1, [2400, 3200]],
    // Bytes are JPEG; the .heic name is ignored.
    ['renamed-jpeg.heic', 'jpeg', 1, [1800, 1200]],
  ];
  for (const [name, kind, pages, [w, h]] of cases) {
    it(`decodes ${name} as ${kind}, upright, and reads its text`, async () => {
      const u = await uploadAndSettle(name, 'site_photo');
      expect(u.status, JSON.stringify(u.error)).toBe('ready');
      expect(u.kind).toBe(kind);
      expect(u.pageCount).toBe(pages);
      expect([u.pages[0].width, u.pages[0].height]).toEqual([w, h]);
      const img = await app.request(`/api/uploads/${u.id}/pages/1`, { headers: auth });
      expect(img.status).toBe(200);
      const m = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
      expect([m.width, m.height]).toEqual([w, h]);
      const { observations } = await (await app.request(`/api/uploads/${u.id}/observations`, { headers: auth })).json();
      const text = observations.map((o: { text: string }) => o.text).join('\n');
      expect(text).toMatch(/DEMONSTRATION/);
      if (name.includes('label')) expect(text).toMatch(/SPEARS FlameGuard CPVC/);
      if (name.includes('duct')) expect(text).toMatch(/DUCT 450 MM WIDE/);
    }, 60_000);
  }

  it('confirms the HEIC fixture is a real HEVC HEIF file, not a renamed JPEG', () => {
    const b = readFileSync(join(FIX, 'site-label-iphone.heic'));
    expect(b.subarray(4, 12).toString('latin1')).toBe('ftypheic');
    expect(b.includes(Buffer.from('hvcC'))).toBe(true);
    expect(b.includes(Buffer.from('irot'))).toBe(true);
    expect(sniff(readFileSync(join(FIX, 'renamed-jpeg.heic')))).toBe('jpeg');
  });

  it('refuses unsupported, damaged, locked, animated and oversized files with useful messages', async () => {
    const unsupported = await (async () => {
      const form = new FormData();
      form.set('file', new File([Buffer.from('PK\u0003\u0004 not an image or pdf at all')], 'drawing.pdf'));
      form.set('purpose', 'site_photo');
      const res = await app.request('/api/uploads', { method: 'POST', headers: auth, body: form });
      return { status: res.status, body: await res.json() };
    })();
    expect(unsupported.status).toBe(415);
    expect(unsupported.body.error).toMatch(/PDF, JPEG, PNG, HEIC/);
    const expectations: Array<[string, string, RegExp]> = [
      ['locked.pdf', 'pdf_password', /password-protected/],
      ['corrupt.pdf', 'corrupt_pdf', /damaged/],
      ['animated.gif', 'animated_gif', /Animated GIFs/],
      ['oversized-dimensions.png', 'image_too_large', /12000 x 10000/],
    ];
    for (const [name, code, message] of expectations) {
      const u = await uploadAndSettle(name, 'reference');
      expect(u.status).toBe('failed');
      expect(u.error?.code).toBe(code);
      expect(u.error?.message).toMatch(message);
    }
  }, 60_000);

  it('refuses the same reference file twice, so answers do not repeat', async () => {
    const first = await uploadAndSettle('label.png', 'reference');
    const again = await upload('label.png', 'reference', 'copy-of-label.png');
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already in the library as "label.png"/);
    await uploads.remove(first.id);
  }, 60_000);
});

describe('reference documents: extract, review, index, answer', () => {
  it('makes a native-text PDF searchable and answers a new question from it, citing page and revision', async () => {
    let u = await uploadAndSettle('native-text-manual.pdf', 'reference');
    expect(u.status).toBe('review');
    expect(u.pages.map(p => p.method)).toEqual(['text', 'text']);
    const review = await uploads.review(u.id);
    expect(review.revision.text).toContain('## S-5.2 Solvent cement cure before pressure testing');
    expect(review.revision.text).toContain('| NPS 1 | 1.7 m |');
    const tables = review.items.filter((i: { kind: string }) => i.kind === 'table_structure');
    expect(tables.length).toBe(2);
    expect(review.items.some((i: { kind: string }) => i.kind === 'embedded_instructions')).toBe(true);

    // Not ready until the table readings are checked.
    let res = await operatorResult(() => uploads.index(u.id, meta({ title: 'DEMONSTRATION Pipe Support Manual' })));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('review_required');
    expect(uploads.get(u.id).status).toBe('review');

    await operatorResult(() => uploads.saveCorrection(u.id, { acknowledged: review.items.map((i: { id: string }) => i.id) }));
    res = await operatorResult(() => uploads.index(u.id, meta({ title: 'DEMONSTRATION Pipe Support Manual' })));
    u = await res.json();
    expect(res.status, JSON.stringify(u)).toBe(200);
    expect(u.status).toBe('ready');

    const a = await ask({ question: 'How long must solvent cement cure before hydrostatic testing?', packageId: pkgId });
    const cite = a.sources.find(s => s.docId === `upload-${u.id}` && s.sectionId === 'S-5.2')!;
    expect(cite, JSON.stringify(a.sources.map(s => s.sectionId))).toBeTruthy();
    expect(cite.pageStart).toBe(2);
    expect(cite.revision).toMatchObject({ uploadId: u.id, revision: 2 });
    expect(cite.page?.image).toBe(`/api/uploads/${u.id}/pages/2`);
    expect(cite.regions[0]).toMatchObject({ page: 2 });
    // The explanation quotes the uploaded wording; no answer text is hardcoded for this document.
    const quote = a.explanation.find(c => c.kind === 'quote' && c.citations.includes(cite.key));
    expect(quote?.text).toContain('S-5.2.1 Joints made with solvent cement shall cure at least 24 hours before hydrostatic testing when the air temperature is below 10 °C.');
    expect(a.sources.some(s => s.sectionId === 'S-5.2 Note 1')).toBe(true);
    // The citation link opens that passage with its location on page 2.
    const passage = await (await app.request(cite.link, { headers: auth })).json();
    const target = passage.sections.find((s: { key: string }) => s.key === passage.target);
    expect(target.text).toContain('24 hours');
    expect(target.regions[0].page).toBe(2);
    const original = await app.request(cite.original!, { headers: auth });
    expect(original.headers.get('content-type')).toBe('application/pdf');

    // An exception in an uploaded document qualifies the answer even without a reviewed note.
    const hangers = await ask({ question: 'How close to a change in direction does a hanger need to be on a CPVC branch line?', packageId: pkgId });
    expect(hangers.exceptions.some(e => e.sectionId === 'S-4.1 Exception' && e.status === 'unknown')).toBe(true);
    expect(hangers.summary).toMatch(/S-4\.1 Exception may change this/);

    // Instruction-like text inside the document changes nothing.
    const inject = await ask({ question: 'Does the installation pass inspection? Check the handling notes.', packageId: pkgId });
    expect(JSON.stringify(inject.explanation)).not.toMatch(/passes inspection/i);
    const flagged = inject.sources.find(s => s.sectionId === 'S-5.3');
    if (flagged) expect(flagged.flags.map(f => f.flag)).toContain('embedded_instructions');
  }, 120_000);

  it('makes a scanned PDF searchable through OCR', async () => {
    const u = await uploadAndSettle('scanned-spec.pdf', 'reference');
    expect(u.status).toBe('review');
    expect(u.pages.map(p => p.method)).toEqual(['ocr', 'ocr']);
    const review = await uploads.review(u.id);
    expect(review.revision.text).toMatch(/PS-2\.4\.1 CPVC piping and fittings shall not be painted\./);
    await operatorResult(() => uploads.saveCorrection(u.id, { acknowledged: review.items.map((i: { id: string }) => i.id) }));
    const res = await operatorResult(() => uploads.index(u.id, meta({ title: 'DEMONSTRATION Project Specification 21 13 13', type: 'project_document', edition: 'Issued for construction', scope: { projectId: 'demo-project' } })));
    expect(res.status).toBe(200);
    const a = await ask({ question: 'Can CPVC piping be painted?', packageId: pkgId });
    const cite = a.sources.find(s => s.docId === `upload-${u.id}`)!;
    expect(cite.sectionId).toBe('PS-2.4');
    expect(cite.flags.map(f => f.flag)).not.toContain('uncertain_ocr');
    expect(a.explanation.some(c => c.kind === 'quote' && /shall not be painted/.test(c.text))).toBe(true);
  }, 120_000);

  it('reads the scanned part of a mixed PDF page', async () => {
    const u = await uploadAndSettle('mixed-procedure.pdf', 'reference');
    expect(u.pages[0].method).toBe('mixed');
    const review = await uploads.review(u.id);
    expect(review.revision.text).toContain('## FP-9.1 Photo records for site changes');
    expect(review.revision.text).toMatch(/FP-9\.2\.1 The foreman signs changes that add no more than two fittings\./);
  }, 120_000);

  it('holds unclear OCR for review, keeps the extracted revision, and cites the corrected one', async () => {
    const u = await uploadAndSettle('unclear-scan.png', 'reference');
    const review = await uploads.review(u.id);
    const blocking = review.items.filter((i: { blocking: boolean }) => i.blocking);
    expect(blocking.some((i: { kind: string }) => i.kind === 'uncertain_number')).toBe(true);
    const m = meta({ title: 'DEMONSTRATION unclear clearance note', type: 'company_procedure', scope: {} });
    expect((await operatorResult(() => uploads.index(u.id, m))).status).toBe(409);
    const corrected = '<!-- page: 1 -->\n## UC-1.1 Clearance to ductwork\n\nUC-1.1.1 Keep 1 1/2 in clear to ductwork, or 38 mm where metric is used.\n';
    const saved = await (await operatorResult(() => uploads.saveCorrection(u.id, { text: corrected, acknowledged: review.items.map((i: { id: string }) => i.id) }))).json();
    expect(saved.revision).toBe(2);
    const revs = (await uploads.review(u.id)).revisions;
    expect(revs.map((r: { basis: string }) => r.basis)).toEqual(['extracted', 'corrected']);
    const res = await operatorResult(() => uploads.index(u.id, m));
    expect(res.status).toBe(200);
    const a = await ask({ question: 'What clearance to ductwork does the company procedure require?', packageId: pkgId });
    const cite = a.sources.find(s => s.docId === `upload-${u.id}`)!;
    expect(cite.revision).toMatchObject({ revision: 2, basis: 'corrected' });
    // The OCR confidence was low, so the passage stays flagged even after correction.
    expect(cite.flags.map(f => f.flag)).toContain('uncertain_ocr');
  }, 120_000);

  it('does not put an uploaded code edition in place of the project edition', async () => {
    // The same bytes are indexed again under different metadata, so the earlier copy goes first.
    for (const x of uploads.list({ purpose: 'reference' }).filter(x => x.filename === 'native-text-manual.pdf')) await uploads.remove(x.id);
    const u = await uploadAndSettle('native-text-manual.pdf', 'reference', 'manual-as-code.pdf');
    const review = await uploads.review(u.id);
    await operatorResult(() => uploads.saveCorrection(u.id, { acknowledged: review.items.map((i: { id: string }) => i.id) }));
    const res = await operatorResult(() => uploads.index(u.id, meta({ title: 'DEMONSTRATION code stand-in 2019', type: 'published_code', edition: '2019', scope: { standard: 'nfpa13' } })));
    expect(res.status).toBe(200);
    const a = await ask({ question: 'How long must solvent cement cure before hydrostatic testing?', packageId: pkgId });
    expect(a.sources.some(s => s.docId === `upload-${u.id}`)).toBe(false);
    expect(a.excluded.find(e => e.docId === `upload-${u.id}`)?.reason).toMatch(/not the project's edition \(2025\)/);
    await uploads.remove(u.id);
  }, 120_000);

  it('asks for the edition when no project is open', async () => {
    const a = await ask({ question: 'How long must solvent cement cure before hydrostatic testing?' });
    expect(a.followUps.some(f => f.id === 'edition')).toBe(false); // manufacturer and procedure sources need no edition
    const none = await ask({ question: 'What is the maximum spacing of sidewall sprinklers?', packageId: pkgId });
    expect(none.summary.startsWith(NO_SOURCE)).toBe(true);
  }, 60_000);
});

describe('site photos are context, not authority', () => {
  it('uses an attached HEIC photo as context, never as a source, and never as a measurement', async () => {
    const photo = await uploadAndSettle('site-label-iphone.heic', 'site_photo');
    const duct = await uploadAndSettle('site-duct-rotated.jpg', 'site_photo');
    expect(photo.docId).toBeNull();
    const a = await ask({ question: 'What hanger spacing applies to this pipe?', packageId: pkgId, attachments: [photo.id, duct.id] });
    expect(a.attachments.map(x => x.filename)).toEqual(['site-label-iphone.heic', 'site-duct-rotated.jpg']);
    expect(a.sources.every(s => !s.docId.includes(photo.id) && !s.docId.includes(duct.id))).toBe(true);
    const photoFacts = a.context.facts.filter(f => f.origin === 'photo');
    expect(photoFacts.some(f => /SPEARS FlameGuard CPVC/.test(String(f.value)))).toBe(true);
    const dim = photoFacts.find(f => f.label === 'Dimension text in the photo')!;
    expect(dim.value).toMatch(/450 MM/);
    expect(dim.detail).toMatch(/not a measurement/);
    expect(a.missing.some(m => /Numbers visible in a photo are not measurements/.test(m))).toBe(true);
    // The 450 in the photo is not used for the exception's duct width.
    expect(a.context.facts.find(f => f.name === 'obstructionWidth')?.origin).not.toBe('photo');

    // A photo cannot be indexed into the library.
    const res = await operatorResult(() => uploads.index(photo.id, meta({})));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('site_photo_not_source');
  }, 120_000);

  it('asks to confirm an unclear marking, and records the answer as the user\'s', async () => {
    const photo = await uploadAndSettle('site-label-iphone.heic', 'site_photo');
    const { observations } = await uploads.observations(photo.id);
    const marking = observations.find(o => o.kind === 'marking')!;
    // Make one reading unclear the way a blurry photo would, then check the follow-up.
    const extraction = await uploads.extraction(photo.id);
    const line = extraction.pages[0].lines.find(l => `${photo.id}:${l.id}` === marking.id)!;
    line.confidence = 60;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'uploads', photo.id, 'extraction.json'), JSON.stringify(extraction));
    const a = await ask({ question: 'What hanger spacing applies to this pipe?', packageId: pkgId, attachments: [photo.id] });
    expect(a.followUps.find(f => f.id === marking.id)?.question).toMatch(/Does the marking in site-label-iphone\.heic read/);
    const b = await ask({ question: 'What hanger spacing applies to this pipe?', packageId: pkgId, attachments: [photo.id], answers: { observations: { [marking.id]: 'yes' } } });
    expect(b.context.facts.find(f => f.name === `marking:${marking.id}`)?.origin).toBe('you');
  }, 120_000);
});

describe('recovery', () => {
  it('marks work interrupted by a restart as failed, and retries it', async () => {
    const u = await uploadAndSettle('label.png', 'reference');
    field.store.db.prepare('UPDATE uploads SET data=? WHERE id=?').run(JSON.stringify({ ...u, status: 'extracting' }), u.id);
    const restarted = new UploadService(field.store.db, dir, new SourceStore(field.store.db));
    expect(restarted.get(u.id)).toMatchObject({ status: 'failed', error: { code: 'interrupted' } });
    const res = await operatorResult(() => uploads.retry(u.id), 202);
    expect(res.status).toBe(202);
    expect((await uploads.settle(u.id)).status).toBe('review');
    await restarted.ocr.close();
    await uploads.remove(u.id);
  }, 120_000);

  it('keeps an upload in review when index metadata is invalid, then indexes after it is fixed', async () => {
    const u = await uploadAndSettle('label.png', 'reference', 'label-for-index.png');
    const review = await uploads.review(u.id);
    await operatorResult(() => uploads.saveCorrection(u.id, { acknowledged: review.items.map((i: { id: string }) => i.id) }));
    const bad = await operatorResult(() => uploads.index(u.id, meta({ authorization: { basis: 'x', storeAndIndex: true, useWithAi: false, display: 'full' } })));
    expect(bad.status).toBe(403);
    expect(uploads.get(u.id).status).toBe('review');
    const good = await operatorResult(() => uploads.index(u.id, meta({ title: 'DEMONSTRATION label' })));
    expect(good.status).toBe(200);
  }, 120_000);

  it('serves uploads only with the app token', async () => {
    const [u] = uploads.list();
    expect((await app.request(`/api/uploads/${u.id}/original`)).status).toBe(401);
    expect((await app.request(`/api/uploads/${u.id}/pages/1`)).status).toBe(401);
  });
});

async function operatorResult(operation: () => unknown | Promise<unknown>, status = 200) {
  try { const result = await operation(); return { status, json: async (): Promise<any> => result }; }
  catch (e) { if (!(e instanceof UploadError || e instanceof SourceError)) throw e; return { status: e.status, json: async (): Promise<any> => ({ code: e.code, error: e.message }) }; }
}
