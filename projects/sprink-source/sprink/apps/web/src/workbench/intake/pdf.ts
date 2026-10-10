import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * Renders drawing pages in the browser for tracing. Only drawings for a work package pass through here;
 * reference documents for Ask Sprink are parsed separately on the server.
 */
let loader: Promise<typeof import("pdfjs-dist")> | null = null;
async function pdfjs() {
  loader ??= (async () => {
    const lib = await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })();
  return loader;
}

export async function openPdf(blob: Blob): Promise<PDFDocumentProxy> {
  const lib = await pdfjs();
  return lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
}

export interface SheetRaster { url: string; x: number; y: number; width: number; height: number; pageWidth: number; pageHeight: number; pixelsPerUnit: number }
export interface Region { x: number; y: number; width: number; height: number }

/**
 * Draws one page (or one region of it) to an image. Sheet units are PDF points at 1x with Y down, after
 * the page's own rotation. The region is drawn at up to `maxPixels` on its long side, so a small work
 * area on a large sheet stays sharp enough to pick points on.
 */
export async function renderPage(doc: PDFDocumentProxy, pageNumber: number, region: Region | null, maxPixels = 4096): Promise<SheetRaster> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const r = region ?? { x: 0, y: 0, width: base.width, height: base.height };
  const scale = Math.min(maxPixels / Math.max(r.width, r.height), 12);
  const viewport = page.getViewport({ scale, offsetX: -r.x * scale, offsetY: -r.y * scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(r.width * scale));
  canvas.height = Math.max(1, Math.ceil(r.height * scale));
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("Could not draw the page")), "image/png"));
  page.cleanup();
  return { url: URL.createObjectURL(blob), x: r.x, y: r.y, width: r.width, height: r.height, pageWidth: base.width, pageHeight: base.height, pixelsPerUnit: scale };
}

export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}
