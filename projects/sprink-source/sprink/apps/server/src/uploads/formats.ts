/**
 * Upload formats and limits. The kind is decided from the file's bytes, never from its name or
 * the browser's content type, so a JPEG renamed .heic is handled as the JPEG it is.
 */

export type UploadKind = 'pdf' | 'jpeg' | 'png' | 'heic' | 'avif' | 'webp' | 'tiff' | 'bmp' | 'gif';

export const KIND_LABEL: Record<UploadKind, string> = {
  pdf: 'PDF', jpeg: 'JPEG', png: 'PNG', heic: 'HEIC/HEIF', avif: 'AVIF', webp: 'WebP', tiff: 'TIFF', bmp: 'BMP', gif: 'GIF',
};
export const KIND_MIME: Record<UploadKind, string> = {
  pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', avif: 'image/avif', webp: 'image/webp', tiff: 'image/tiff', bmp: 'image/bmp', gif: 'image/gif',
};

export const LIMITS = {
  /** Largest upload accepted, in bytes. A phone photo is 2-8 MB; a long scanned PDF can be larger. */
  maxBytes: 40 * 1024 * 1024,
  /** Pages read from one PDF or TIFF. */
  maxPages: 60,
  /** Decoded pixels per image or page (about a 12,000 x 8,300 scan). Larger images are refused, not silently shrunk. */
  maxPixels: 100_000_000,
  /** Longest side of a single image. */
  maxSide: 12_000,
  /** Longest side of the stored page image used for viewing and OCR. Keeps small drawing labels readable. */
  pageImageSide: 3200,
  /** Longest side of the small preview. */
  previewSide: 640,
  /** PDF pages are rendered at this scale (1 = 72 dpi). 3 is 216 dpi, enough for 8 pt text. */
  pdfScale: 3,
} as const;

export class UploadError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));

/** HEIF brands that carry HEVC-coded images (iPhone photos use heic). */
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);

export function sniff(b: Uint8Array): UploadKind | null {
  if (b.length < 12) return null;
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
  // Some PDF writers put junk before the header; the spec allows it within the first 1024 bytes.
  if (b.length > 16 && ascii(b, 0, Math.min(1024, b.length)).includes('%PDF-')) return 'pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) return 'tiff';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return 'gif';
  if (ascii(b, 4, 8) === 'ftyp') {
    const size = (b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3]) >>> 0;
    const brands = [ascii(b, 8, 12)];
    for (let i = 16; i + 4 <= Math.min(size, b.length, 64); i += 4) brands.push(ascii(b, i, i + 4));
    if (brands.some(x => HEIC_BRANDS.has(x))) return 'heic';
    if (brands.includes('avif') || brands.includes('avis')) return 'avif';
    if (brands.includes('mif1') || brands.includes('msf1')) return 'heic';
  }
  return null;
}

export const SUPPORTED_TEXT = 'PDF, JPEG, PNG, HEIC/HEIF, WebP, TIFF, BMP, AVIF or a still GIF';
