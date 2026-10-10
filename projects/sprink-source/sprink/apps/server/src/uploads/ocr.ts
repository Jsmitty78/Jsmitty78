import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { createWorker, type Worker } from 'tesseract.js';

/**
 * OCR with Tesseract (tesseract.js 7, WebAssembly, runs in a Node worker thread).
 * The English LSTM model is loaded from the @tesseract.js-data/eng package on disk, so OCR needs
 * no network access at runtime. One worker handles jobs one at a time; pages are queued.
 */

export interface OcrWord { text: string; confidence: number; bbox: Box }
export interface OcrLine { text: string; confidence: number; bbox: Box; words: OcrWord[] }
export interface Box { x: number; y: number; w: number; h: number }

const require = createRequire(import.meta.url);
const LANG_DIR = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');

export class OcrEngine {
  private worker: Promise<Worker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly cacheDir: string) {}

  private start() {
    return this.worker ??= (async () => {
      mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 });
      const w = await createWorker('eng', 1, { langPath: LANG_DIR, cachePath: this.cacheDir, gzip: true });
      // Keep runs of spaces (table columns) and tell Tesseract the page images are high resolution.
      await w.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
      return w;
    })().catch(e => { this.worker = null; throw e; });
  }

  /** Recognizes one page image. Coordinates are returned in the input image's pixels. */
  recognize(image: Buffer): Promise<{ lines: OcrLine[]; confidence: number; ms: number }> {
    const job = this.queue.then(async () => {
      const t0 = performance.now();
      const worker = await this.start();
      const meta = await sharp(image).metadata();
      // Small images get upscaled so small print has enough pixels per character.
      const scale = Math.max(meta.width ?? 0, meta.height ?? 0) < 1600 ? 2 : 1;
      const prepared = await sharp(image).resize(scale > 1 ? { width: (meta.width ?? 0) * scale } : undefined).grayscale().png().toBuffer();
      const { data } = await worker.recognize(prepared, {}, { blocks: true, text: true });
      const box = (b: { x0: number; y0: number; x1: number; y1: number }): Box => ({ x: b.x0 / scale, y: b.y0 / scale, w: (b.x1 - b.x0) / scale, h: (b.y1 - b.y0) / scale });
      const lines: OcrLine[] = [];
      for (const block of data.blocks ?? []) for (const p of block.paragraphs) for (const l of p.lines) {
        const words = l.words.filter(w => w.text.trim()).map(w => ({ text: w.text, confidence: w.confidence, bbox: box(w.bbox) }));
        if (!words.length) continue;
        lines.push({ text: l.text.replace(/\s+$/, ''), confidence: l.confidence, bbox: box(l.bbox), words });
      }
      return { lines, confidence: data.confidence, ms: performance.now() - t0 };
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  async close() { const w = this.worker; this.worker = null; if (w) await (await w).terminate(); }
}
