import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { LIMITS, UploadError } from './formats.js';
import type { Box } from './ocr.js';

/**
 * PDF reading with PDF.js (pdfjs-dist legacy build for Node). Native text comes from the
 * text layer with positions; pages are rendered with @napi-rs/canvas (PDF.js's Node canvas)
 * for viewing and for OCR of scanned or image-bearing pages.
 */

export interface NativeLine { text: string; bbox: Box; cells: string[]; height: number }

const require = createRequire(import.meta.url);
const PDFJS_DIR = dirname(require.resolve('pdfjs-dist/package.json'));
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjs: Promise<PdfJs> | null = null;
const load = () => pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs');

export interface OpenPdf {
  pageCount: number;
  page(n: number): Promise<{ lines: NativeLine[]; paintsImages: boolean; render(): Promise<{ image: Buffer; width: number; height: number }> }>;
  close(): Promise<void>;
}

export async function openPdf(bytes: Buffer, maxPages: number = LIMITS.maxPages): Promise<OpenPdf> {
  const lib = await load();
  let doc: Awaited<ReturnType<PdfJs['getDocument']>['promise']>;
  const task = lib.getDocument({
      data: new Uint8Array(bytes), // PDF.js takes ownership of the array it is given
      standardFontDataUrl: `${join(PDFJS_DIR, 'standard_fonts')}/`,
      cMapUrl: `${join(PDFJS_DIR, 'cmaps')}/`, cMapPacked: true,
      disableFontFace: true, verbosity: 0,
  });
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy();
    const name = (e as { name?: string }).name;
    if (name === 'PasswordException') throw new UploadError(422, 'pdf_password', 'This PDF is password-protected. Remove the password (print or save an unlocked copy) and upload it again.');
    if (name === 'InvalidPDFException') throw new UploadError(422, 'corrupt_pdf', 'This PDF is damaged or incomplete and could not be opened. Upload the original file again.');
    throw new UploadError(422, 'corrupt_pdf', 'This PDF could not be opened.');
  }
  if (doc.numPages > maxPages) {
    await task.destroy();
    throw new UploadError(413, 'too_many_pages', `The PDF has ${doc.numPages} pages. The limit is ${maxPages}; upload the chapters you need as separate files.`);
  }
  return {
    pageCount: doc.numPages,
    async page(n) {
      let page;
      try { page = await doc.getPage(n); }
      catch { throw new UploadError(422, 'corrupt_pdf', `Page ${n} of the PDF is damaged and could not be read.`); }
      const base = page.getViewport({ scale: 1 });
      if (base.width * base.height * LIMITS.pdfScale ** 2 > LIMITS.maxPixels) throw new UploadError(413, 'page_too_large', `Page ${n} is too large to process (${Math.round(base.width / 72)} x ${Math.round(base.height / 72)} in).`);
      // Render so the long side is at most the stored page size, and at most pdfScale.
      const scale = Math.min(LIMITS.pdfScale, LIMITS.pageImageSide / Math.max(base.width, base.height));
      const vp = page.getViewport({ scale });
      const text = await page.getTextContent();
      const lines = nativeLines(text.items as TextItem[], vp.transform, lib.Util);
      const ops = await page.getOperatorList();
      const imageOps = new Set([lib.OPS.paintImageXObject, lib.OPS.paintInlineImageXObject, lib.OPS.paintImageMaskXObject, lib.OPS.paintImageXObjectRepeat]);
      const paintsImages = ops.fnArray.some(f => imageOps.has(f));
      return {
        lines, paintsImages,
        async render() {
          const w = Math.ceil(vp.width), h = Math.ceil(vp.height);
          const factory = (doc as unknown as { canvasFactory: { create(w: number, h: number): { canvas: { toBuffer(t: string): Buffer }; context: unknown } } }).canvasFactory;
          const cc = factory.create(w, h);
          await page.render({ canvasContext: cc.context as never, canvas: cc.canvas as never, viewport: vp, background: '#ffffff' }).promise;
          const image = await sharp(cc.canvas.toBuffer('image/png')).flatten({ background: '#ffffff' }).png({ compressionLevel: 6 }).toBuffer();
          page.cleanup();
          return { image, width: w, height: h };
        },
      };
    },
    async close() { await task.destroy(); },
  };
}

interface TextItem { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean }

/** Groups positioned text runs into lines; wide gaps inside a line are kept as table cell breaks. */
function nativeLines(items: TextItem[], vt: number[], util: PdfJs['Util']): NativeLine[] {
  const runs = items.filter(i => i.str && i.str.trim()).map(i => {
    const t = util.transform(vt, i.transform);
    const size = Math.hypot(t[2], t[3]);
    const width = i.width * Math.hypot(vt[0], vt[1]);
    return { str: i.str, x: t[4], base: t[5], size, width };
  }).sort((a, b) => a.base - b.base || a.x - b.x);
  const lines: Array<typeof runs> = [];
  for (const r of runs) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].base - r.base) < Math.max(2, 0.35 * r.size)) last.push(r);
    else lines.push([r]);
  }
  return lines.map(parts => {
    parts.sort((a, b) => a.x - b.x);
    const size = Math.max(...parts.map(p => p.size));
    const cells: string[] = [];
    let text = '', cell = '', prevEnd = -Infinity;
    for (const p of parts) {
      const gap = p.x - prevEnd;
      if (prevEnd > -Infinity && gap > 1.6 * size) { cells.push(cell.trim()); cell = ''; text += '   '; }
      else if (prevEnd > -Infinity && gap > 0.12 * size && !/\s$/.test(cell) && !/^\s/.test(p.str)) { cell += ' '; text += ' '; }
      cell += p.str; text += p.str; prevEnd = p.x + p.width;
    }
    cells.push(cell.trim());
    const x = Math.min(...parts.map(p => p.x)), right = Math.max(...parts.map(p => p.x + p.width));
    const top = Math.min(...parts.map(p => p.base - p.size)), bottom = Math.max(...parts.map(p => p.base + 0.25 * p.size));
    return { text: text.replace(/\s+$/, ''), bbox: { x, y: top, w: right - x, h: bottom - top }, cells, height: size };
  });
}
