import sharp from 'sharp';
import { decode as decodeBmpData } from 'bmp-ts';
import { LIMITS, UploadError, type UploadKind } from './formats.js';

/**
 * Image decoding.
 *
 * - JPEG, PNG, WebP, TIFF, GIF and AVIF use sharp (libvips), which the server already depends on.
 *   `.rotate()` applies the EXIF orientation, so a sideways phone JPEG is stored upright.
 * - HEIC/HEIF uses libheif-js (libheif + libde265 compiled to WebAssembly). sharp's prebuilt
 *   binaries only decode AVIF, not HEVC-coded HEIC, because of HEVC patent licensing.
 *   libheif applies the file's own rotation and mirror transforms (irot/imir), which is how
 *   iPhone photos carry orientation, so the EXIF orientation is not applied a second time.
 * - BMP uses bmp-ts (pure TypeScript); libvips has no BMP loader in sharp's prebuilt binaries.
 *
 * Each image becomes one or more upright page images, capped at LIMITS.pageImageSide on the
 * long side (enough for small labels), plus a small preview.
 */

export interface PageImage { n: number; width: number; height: number; image: Buffer; sourceWidth: number; sourceHeight: number }

const tooLarge = (w: number, h: number) => w * h > LIMITS.maxPixels || Math.max(w, h) > LIMITS.maxSide;
const sizeError = (w: number, h: number) => new UploadError(413, 'image_too_large',
  `The image is ${w} x ${h} pixels. The limit is ${LIMITS.maxSide} pixels on the long side and ${Math.round(LIMITS.maxPixels / 1e6)} megapixels. Export it smaller and upload again.`);

/** Normalizes decoded pixels (or an encoded image sharp can read) into a stored page image. */
async function toPage(n: number, input: sharp.Sharp, sourceWidth: number, sourceHeight: number): Promise<PageImage> {
  const { data, info } = await input
    .resize({ width: LIMITS.pageImageSide, height: LIMITS.pageImageSide, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 6 })
    .toBuffer({ resolveWithObject: true });
  return { n, width: info.width, height: info.height, image: data, sourceWidth, sourceHeight };
}

export async function decodeImage(bytes: Buffer, kind: Exclude<UploadKind, 'pdf'>): Promise<{ pages: PageImage[]; notes: string[] }> {
  const notes: string[] = [];
  if (kind === 'heic') return { pages: [await decodeHeic(bytes)], notes };
  if (kind === 'bmp') return { pages: [await decodeBmp(bytes)], notes };

  let meta: sharp.Metadata;
  try { meta = await sharp(bytes, { limitInputPixels: false }).metadata(); }
  catch { throw new UploadError(422, 'corrupt_image', 'The image could not be read. It may be damaged or only partly uploaded.'); }
  const w = meta.width ?? 0, h = meta.pageHeight ?? meta.height ?? 0;
  if (!w || !h) throw new UploadError(422, 'corrupt_image', 'The image has no readable size. It may be damaged.');
  if (tooLarge(w, h)) throw sizeError(w, h);
  const pageCount = meta.pages ?? 1;
  if (kind === 'gif' && pageCount > 1)
    throw new UploadError(415, 'animated_gif', 'Animated GIFs are not supported. Upload a still image (JPEG or PNG) of the frame you need.');
  if (kind === 'tiff' && pageCount > LIMITS.maxPages)
    throw new UploadError(413, 'too_many_pages', `The TIFF has ${pageCount} pages. The limit is ${LIMITS.maxPages}; split it and upload the pages you need.`);

  const pages: PageImage[] = [];
  const count = kind === 'tiff' ? pageCount : 1;
  for (let i = 0; i < count; i++) {
    try {
      const img = sharp(bytes, { page: i, pages: 1, limitInputPixels: LIMITS.maxPixels }).rotate();
      const m = await sharp(bytes, { page: i, pages: 1, limitInputPixels: false }).metadata();
      if (tooLarge(m.width ?? 0, m.height ?? 0)) throw sizeError(m.width ?? 0, m.height ?? 0);
      const swap = (m.orientation ?? 1) >= 5;
      pages.push(await toPage(i + 1, img, swap ? m.height! : m.width!, swap ? m.width! : m.height!));
    } catch (e) {
      if (e instanceof UploadError) throw e;
      throw new UploadError(422, 'corrupt_image', `${kind === 'tiff' ? `Page ${i + 1} of the TIFF` : 'The image'} could not be decoded. It may be damaged or use an unsupported compression.`);
    }
  }
  if (meta.orientation && meta.orientation !== 1) notes.push(`The camera recorded this image rotated (EXIF orientation ${meta.orientation}); it was turned upright.`);
  return { pages, notes };
}

type Heif = { HeifDecoder: new () => { decode(b: Uint8Array): HeifImage[] } };
interface HeifImage { get_width(): number; get_height(): number; display(target: { data: Uint8ClampedArray; width: number; height: number }, cb: (d: { data: Uint8ClampedArray } | null) => void): void; free?(): void }
let heif: Promise<Heif> | null = null;
const loadHeif = () => heif ??= import('libheif-js/wasm-bundle.js').then(m => (m.default ?? m) as Heif);

async function decodeHeic(bytes: Buffer): Promise<PageImage> {
  const lib = await loadHeif();
  let images: HeifImage[];
  try { images = new lib.HeifDecoder().decode(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)); }
  catch { throw new UploadError(422, 'corrupt_image', 'The HEIC file could not be read. It may be damaged.'); }
  if (!images?.length) throw new UploadError(422, 'corrupt_image', 'The HEIC file contains no readable image. It may be damaged or use an unsupported codec.');
  // The first top-level image is the primary photo; depth maps and thumbnails are not top-level.
  const img = images[0], w = img.get_width(), h = img.get_height();
  if (tooLarge(w, h)) throw sizeError(w, h);
  const rgba = await new Promise<Uint8ClampedArray>((resolve, reject) =>
    img.display({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }, d => d ? resolve(d.data) : reject(new UploadError(422, 'corrupt_image', 'The HEIC image data could not be decoded.'))));
  for (const i of images) i.free?.();
  return toPage(1, sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: w, height: h, channels: 4 } }), w, h);
}

async function decodeBmp(bytes: Buffer): Promise<PageImage> {
  if (bytes.length < 26) throw new UploadError(422, 'corrupt_image', 'The BMP file is too short to be an image.');
  const w = bytes.readInt32LE(18), h = Math.abs(bytes.readInt32LE(22));
  if (w <= 0 || h <= 0) throw new UploadError(422, 'corrupt_image', 'The BMP file has no readable size. It may be damaged.');
  if (tooLarge(w, h)) throw sizeError(w, h);
  let decoded: { width: number; height: number; data: Buffer | Uint8Array };
  try { decoded = decodeBmpData(bytes, { toRGBA: true }); }
  catch { throw new UploadError(422, 'corrupt_image', 'The BMP file could not be decoded. It may be damaged or use an unsupported variant.'); }
  const px = decoded.width * decoded.height, rgba = decoded.data;
  if (rgba.length < px * 4) throw new UploadError(422, 'corrupt_image', 'The BMP pixel data is incomplete.');
  // Most BMPs have no alpha channel and the decoder's alpha byte is not meaningful, so only RGB is kept.
  const rgb = Buffer.alloc(px * 3);
  for (let i = 0; i < px; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }
  return toPage(1, sharp(rgb, { raw: { width: decoded.width, height: decoded.height, channels: 3 } }), w, h);
}

export async function preview(image: Buffer): Promise<Buffer> {
  return sharp(image).resize({ width: LIMITS.previewSide, height: LIMITS.previewSide, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
}
