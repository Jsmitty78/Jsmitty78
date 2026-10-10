/**
 * Browser test of the Ask Sprink upload-to-answer flow against a running server (`pnpm start`).
 *
 *   SPRINK_TOKEN=... pnpm start            # in one terminal, with a fresh SPRINK_DATA_DIR
 *   E2E_TOKEN=... node scripts/e2e-ask-uploads.mjs
 *
 * Needs Playwright with Chromium. Set PLAYWRIGHT_MODULE to its index.js when it is installed
 * globally (for example /usr/lib/node_modules/playwright/index.js). Screenshots and a JSON report
 * go to E2E_OUT (default ./e2e-out). Every document used is an invented fixture from fixtures/uploads.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const { chromium } = pw.default ?? pw;
const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:4310';
const TOKEN = process.env.E2E_TOKEN;
if (!TOKEN) throw new Error('Set E2E_TOKEN to the server token.');
const OUT = process.env.E2E_OUT ?? 'e2e-out';
const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/uploads');
mkdirSync(OUT, { recursive: true });

const report = { checks: [], timings: [], errors: [] };
const check = (name, ok, detail = '') => { report.checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) report.errors.push(m.text()); });
page.on('pageerror', e => report.errors.push(String(e)));

// ---------------------------------------------------------------- open a package and Ask Sprink
await page.goto(`${BASE}/`);
await page.fill('input[type="password"], input', TOKEN);
await page.keyboard.press('Enter');
await page.waitForSelector('text=Work packages');
await page.fill('input[aria-label="Adapt to site conditions name"]', 'Branch L-2 duct');
await page.locator('form.fa-entry-card').nth(1).locator('button[type=submit]').click();
await page.waitForSelector('text=Load sample input');
await page.click('text=Load sample input');
await page.waitForTimeout(2500);
await page.click('button:has-text("Ask Sprink")');
await page.waitForSelector('.fa-ask');
await shot(page, '60-ask-with-attach');

// ---------------------------------------------------------------- library: upload, review, index
await page.click('.fa-seg button:has-text("Library")');
await page.click('text=Load demonstration sources');
await page.waitForSelector('.fa-docs li');

async function uploadReference(file, meta, { expectBlocked = false } = {}) {
  const t0 = Date.now();
  await page.locator('.fa-ask-col [data-testid=file-input]').first().setInputFiles(join(FIX, file));
  await page.waitForSelector('.fa-review');
  await page.waitForSelector('.fa-review textarea', { timeout: 120_000 });
  const extractMs = Date.now() - t0;
  await page.waitForTimeout(500);
  await shot(page, `61-review-${file.replace(/\W+/g, '-')}`);
  const indexButton = page.locator('.fa-review-actions button:has-text("Index")');
  const boxes = page.locator('.fa-review-items input[type=checkbox]');
  if (expectBlocked) {
    check(`${file}: unclear OCR must be checked before indexing`, await boxes.count() > 0 && await indexButton.isDisabled());
    return { extractMs };
  }
  for (let i = 0; i < await boxes.count(); i++) await boxes.nth(i).check();
  await page.getByLabel('Title').fill(meta.title);
  await page.getByLabel('Publisher').fill('Sprink test fixtures');
  await page.getByLabel('Type').selectOption(meta.type);
  await page.getByLabel('Edition or revision').fill(meta.edition);
  if (meta.productIds) await page.getByLabel('Catalog product ids').fill(meta.productIds);
  await page.getByLabel('Who authorized this, and on what basis').fill('Invented fixture written by the Sprink team for testing.');
  await page.getByLabel('We may store and index this document').check();
  await page.getByLabel('We may use it with AI features').check();
  await page.getByLabel('Display in answers').selectOption('full');
  await page.getByLabel('This is a demonstration document, not a real source').check();
  const t1 = Date.now();
  await indexButton.click();
  await page.waitForSelector('.fa-review >> text=Searchable', { timeout: 60_000 });
  const indexMs = Date.now() - t1;
  await shot(page, `62-indexed-${file.replace(/\W+/g, '-')}`);
  await page.click('.fa-review-head button:has-text("Library")');
  report.timings.push({ file, extractUiMs: extractMs, indexUiMs: indexMs });
  return { extractMs, indexMs };
}
await uploadReference('native-text-manual.pdf', { title: 'DEMONSTRATION Pipe Support Manual', type: 'manufacturer', edition: 'Rev B', productIds: 'spears/CP-010' });
check('native-text PDF indexed from the browser', await page.locator('.fa-docs li:has-text("DEMONSTRATION Pipe Support Manual")').count() > 0);
await uploadReference('scanned-spec.pdf', { title: 'DEMONSTRATION Project Specification 21 13 13', type: 'project_document', edition: 'IFC' });
check('scanned PDF indexed from the browser', await page.locator('.fa-docs li:has-text("DEMONSTRATION Project Specification 21 13 13")').count() > 0);
await uploadReference('unclear-scan.png', {}, { expectBlocked: true });
await page.click('.fa-review-head button:has-text("Library")');
await shot(page, '63-library-uploads');

// ---------------------------------------------------------------- ask from an uploaded source, open the exact page
await page.click('.fa-seg button:has-text("Ask")');
async function askQuestion(q) {
  await page.fill('#ask-q', q);
  const t0 = Date.now();
  await page.click('.fa-ask-form button');
  await page.waitForFunction(q => document.querySelector('.fa-answer-q')?.textContent === q && !document.querySelector('.fa-answer[aria-busy=true]'), q, { timeout: 30_000 });
  const ms = Date.now() - t0;
  report.timings.push({ question: q, browserQuestionToAnswerMs: ms, serverTotalMs: Number((await page.locator('.fa-answer-status small').innerText()).match(/(\d+(?:\.\d+)?) ms/)?.[1]) });
  return ms;
}
await askQuestion('How long must solvent cement cure before hydrostatic testing?');
check('uploaded manual answers a new question with its own wording', await page.locator('.fa-claims li.is-quote:has-text("24 hours before hydrostatic testing")').count() > 0);
await page.locator('.fa-cite:has-text("S-5.2")').first().click();
await page.waitForSelector('.fa-page img');
await page.waitForSelector('.fa-page-box');
await page.waitForTimeout(400);
check('Open source shows page 2 of the PDF with the passage highlighted', (await page.locator('.fa-viewer-mode button.is-on').innerText()) === 'Page 2');
await shot(page, '64-answer-from-upload-page-highlight');
await page.click('.fa-viewer-mode button:has-text("Text")');
await page.waitForSelector('.fa-passage.is-target');
check('Text view opens the same passage', (await page.locator('.fa-passage.is-target').innerText()).includes('24 hours'));

await askQuestion('Can CPVC piping be painted?');
check('scanned spec answers through OCR text', await page.locator('.fa-claims li.is-quote:has-text("shall not be painted")').count() > 0);
await shot(page, '65-answer-from-scanned-pdf');

// ---------------------------------------------------------------- site photos: every format, picker, paste, drop
const formats = ['site-label-iphone.heic', 'site-duct-rotated.jpg', 'label.png', 'label.webp', 'two-page.tiff', 'label.bmp', 'label.gif'];
await page.locator('.fa-ask-attach [data-testid=file-input]').setInputFiles(formats.slice(0, 5).map(f => join(FIX, f)));
await page.click('.fa-purpose button:has-text("Attach to this question")');
// Drag and drop the BMP onto the panel.
const drop = async (name, type) => {
  const b64 = readFileSync(join(FIX, name)).toString('base64');
  await page.evaluate(({ b64, name, type }) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], name, { type }));
    const el = document.querySelector('.fa-ask-col .fa-droparea');
    for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { b64, name, type });
};
await drop('label.bmp', 'image/bmp');
await page.click('.fa-purpose button:has-text("Attach to this question")');
// Paste the GIF into the question box, as a clipboard image would arrive.
const gif = readFileSync(join(FIX, 'label.gif')).toString('base64');
await page.evaluate(b64 => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const dt = new DataTransfer(); dt.items.add(new File([bytes], 'image.png', { type: 'image/gif' }));
  document.querySelector('#ask-q').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
}, gif);
await page.click('.fa-purpose button:has-text("Attach to this question")');
await page.waitForFunction(n => document.querySelectorAll('.fa-att').length === n && [...document.querySelectorAll('.fa-att')].every(c => /Ready as context/.test(c.textContent)), formats.length, { timeout: 120_000 })
  .catch(async e => { console.log(await page.$$eval('.fa-att', cs => cs.map(c => c.textContent))); await shot(page, 'fail-chips'); throw e; });
await page.waitForFunction(() => [...document.querySelectorAll('.fa-att-thumb img')].length >= 7 && [...document.querySelectorAll('.fa-att-thumb img')].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 30_000 });
const thumbs = await page.$$eval('.fa-att', cs => cs.map(c => ({ name: c.querySelector('b').textContent, w: c.querySelector('img')?.naturalWidth, h: c.querySelector('img')?.naturalHeight })));
for (const f of formats) check(`${f} decodes and previews in the browser`, thumbs.some(t => (t.name === f || (f === 'label.gif' && /^pasted-/.test(t.name))) && t.w > 0));
const heic = thumbs.find(t => t.name === 'site-label-iphone.heic');
check('rotated iPhone HEIC displays upright (portrait)', heic && heic.h > heic.w, heic ? `${heic.w}x${heic.h}` : '');
const jpg = thumbs.find(t => t.name === 'site-duct-rotated.jpg');
check('EXIF-rotated JPEG displays upright (portrait)', jpg && jpg.h > jpg.w, jpg ? `${jpg.w}x${jpg.h}` : '');
await shot(page, '66-attachments-all-formats');
// Keep only the HEIC and the duct photo for the question.
for (const name of formats.slice(2)) await page.locator(`.fa-att:has(b:text-is("${name}")) button[aria-label^="Remove"]`).click().catch(() => undefined);
for (const c of await page.locator('.fa-att:has(b:text-matches("^pasted-"))').all()) await c.locator('button[aria-label^="Remove"]').click();
await askQuestion('What hanger spacing applies to this pipe?');
const photoBlock = page.locator('.fa-ask-block:has(h3:text("Site photos"))');
check('site photo shown as context with its readable marking', (await photoBlock.innerText()).includes('SPEARS FlameGuard CPVC'));
check('photo dimension text is labelled as not a measurement', (await photoBlock.innerText()).includes('not measurements'));
check('no source reference comes from a site photo', !(await page.locator('.fa-refs').innerText()).includes('site-label-iphone'));
await photoBlock.scrollIntoViewIfNeeded();
await shot(page, '67-answer-with-site-photos');

// ---------------------------------------------------------------- failures keep the question and can be retried
await page.route('**/api/ask', route => route.abort('failed'), { times: 1 });
await page.fill('#ask-q', 'What hanger spacing applies to this pipe?');
await page.click('.fa-ask-form button');
await page.waitForSelector('text=Could not answer');
check('failed question keeps the typed text and attachments', (await page.inputValue('#ask-q')).length > 0 && await page.locator('.fa-att').count() === 2);
await shot(page, '68-ask-failed-retry');
await page.click('.fa-callout-box button:has-text("Retry")');
await page.waitForSelector('text=Could not answer', { state: 'detached' });
check('retry after a failed question answers', await page.locator('.fa-answer-summary').count() > 0);
await page.route('**/api/uploads', route => route.request().method() === 'POST' ? route.abort('failed') : route.continue(), { times: 1 });
await page.locator('.fa-ask-attach [data-testid=file-input]').setInputFiles(join(FIX, 'label.webp'));
await page.click('.fa-purpose button:has-text("Attach to this question")');
await page.waitForSelector('.fa-att.is-failed');
check('interrupted upload shows a retry', await page.locator('.fa-att.is-failed button:has-text("Retry")').count() === 1);
await page.click('.fa-att.is-failed button:has-text("Retry")');
await page.waitForFunction(() => !document.querySelector('.fa-att.is-failed') && [...document.querySelectorAll('.fa-att')].every(c => /Ready as context/.test(c.textContent)), null, { timeout: 60_000 });
check('upload retry succeeds', true);
await page.locator('.fa-att:has(b:text-is("label.webp")) button[aria-label^="Remove"]').click();

// A reload keeps the question and attachments.
await page.reload();
await page.waitForSelector('button:has-text("Ask Sprink")');
await page.click('button:has-text("Ask Sprink")');
await page.waitForSelector('.fa-att');
check('question and attachments survive a reload', (await page.inputValue('#ask-q')).includes('hanger spacing') && await page.locator('.fa-att').count() === 2);

// ---------------------------------------------------------------- existing checks through the UI
await askQuestion('What is the maximum spacing between sidewall sprinklers in a light hazard occupancy?');
check('unsupported question gets the no-source answer', (await page.locator('.fa-answer-summary').innerText()).startsWith("I couldn't find a supporting source in the project library."));

// ---------------------------------------------------------------- phone
await page.setViewportSize({ width: 390, height: 844 });
await askQuestion('How long must solvent cement cure before hydrostatic testing?');
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
check('phone layout has no horizontal overflow', !overflow);
await shot(page, '69-phone-answer');
await page.locator('.fa-cite:has-text("S-5.2")').first().click();
await page.waitForSelector('.fa-page img');
await page.waitForTimeout(400);
await shot(page, '70-phone-source-page');
await page.click('.fa-seg button:has-text("Library")');
await page.waitForTimeout(300);
await shot(page, '71-phone-library');

check('no console errors', report.errors.length === 0, report.errors.slice(0, 3).join(' | '));
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
const failed = report.checks.filter(c => !c.ok);
console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
