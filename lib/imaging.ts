import sharp from "sharp";
import type { Box } from "./types";

/* ---------------- Image normalization ---------------- */

const MAX_EDGE = 2048;

/** Applies EXIF orientation, caps size, strips ALL metadata (GPS, device, etc). */
export async function normalizeImage(input: Buffer) {
  const { data, info } = await sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer({ resolveWithObject: true });
  return { jpeg: data, width: info.width, height: info.height };
}

/** Pixel crop for a normalized box, padded so hair and hands are not clipped, clamped to the frame. */
export function stickerCropRect(box: Box, width: number, height: number, pad = 0.12) {
  const bw = Math.max(0, box[2] - box[0]);
  const bh = Math.max(0, box[3] - box[1]);
  let left = Math.floor((box[0] - bw * pad) * width);
  let top = Math.floor((box[1] - bh * pad) * height);
  let right = Math.ceil((box[2] + bw * pad) * width);
  let bottom = Math.ceil((box[3] + bh * pad) * height);
  left = Math.max(0, Math.min(width - 1, left));
  top = Math.max(0, Math.min(height - 1, top));
  right = Math.max(left + 1, Math.min(width, right));
  bottom = Math.max(top + 1, Math.min(height, bottom));
  let rectW = right - left;
  let rectH = bottom - top;
  const min = 32;
  if (width >= min && rectW < min) {
    const grow = min - rectW;
    left = Math.max(0, left - Math.floor(grow / 2));
    rectW = Math.min(width - left, rectW + grow);
  }
  if (height >= min && rectH < min) {
    const grow = min - rectH;
    top = Math.max(0, top - Math.floor(grow / 2));
    rectH = Math.min(height - top, rectH + grow);
  }
  return { left, top, width: rectW, height: rectH };
}

/** Public variant: oriented, size-capped WebP with all metadata (GPS, device) stripped. */
export async function renderPublic(jpeg: Buffer) {
  return sharp(jpeg).webp({ quality: 82 }).toBuffer();
}

const STICKER_SIZE = 512;

/** Messages refuses a sticker at or above 500KB and sends the file name instead. */
export const IMESSAGE_STICKER_MAX_BYTES = 500 * 1024;

/** Largest sticker Messages lays out: 206 points at 3x. */
const IMESSAGE_STICKER_MAX_EDGE = 618;

/** Crop the selected window out of a public render. The matte is applied to this crop. */
export async function cropSticker(image: Buffer, box: Box) {
  const meta = await sharp(image).metadata();
  const rect = stickerCropRect(box, meta.width ?? 1, meta.height ?? 1);
  return sharp(image).extract(rect).ensureAlpha().png().toBuffer();
}

/**
 * Turn a crop plus a foreground matte into a square transparent PNG sticker:
 * the subject is kept, the background is dropped, and a white die-cut edge
 * is drawn around the silhouette. 512px is the size phone sticker trays expect.
 */
export async function composeSticker(crop: Buffer, mask: Buffer) {
  const base = sharp(crop).ensureAlpha();
  const meta = await base.metadata();
  const width = meta.width ?? 1;
  const height = meta.height ?? 1;
  const maskRaw = await sharp(mask).resize(width, height, { fit: "fill" }).greyscale().raw().toBuffer();
  if (maskRaw.length < width * height) throw new Error("cutout mask is the wrong size");

  const { data } = await base.raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.from(data);
  let foreground = 0;
  const pixels = width * height;
  for (let i = 0; i < pixels; i++) {
    const a = maskRaw[i] < 8 ? 0 : maskRaw[i];
    rgba[i * 4 + 3] = a;
    if (a > 24) foreground++;
  }
  if (foreground < pixels * 0.005) throw new Error("nothing to cut out");

  let trimmed: Buffer;
  try {
    trimmed = await sharp(rgba, { raw: { width, height, channels: 4 } }).trim({ threshold: 2 }).png().toBuffer();
  } catch {
    throw new Error("nothing to cut out");
  }
  const trimmedMeta = await sharp(trimmed).metadata();
  if (!trimmedMeta.width || !trimmedMeta.height || trimmedMeta.width < 4 || trimmedMeta.height < 4) {
    throw new Error("nothing to cut out");
  }

  const fitted = await sharp(trimmed)
    .resize({ width: 460, height: 460, fit: "inside" })
    .png()
    .toBuffer();
  const outlined = await dieCut(fitted);
  const sized = await sharp(outlined).resize(STICKER_SIZE, STICKER_SIZE, { fit: "inside" }).png().toBuffer();
  const square = await sharp({
    create: { width: STICKER_SIZE, height: STICKER_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: sized, gravity: "centre" }])
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
  return fitIMessageSticker(square);
}

/**
 * PNG with transparency, at most 618px on a side, under 500KB.
 * That is the file Messages will send as a sticker. Anything larger goes out as a named file.
 */
export async function fitIMessageSticker(input: Buffer): Promise<Buffer> {
  let edge = IMESSAGE_STICKER_MAX_EDGE;
  let last = input;
  for (let step = 0; step < 8; step++) {
    const colours = step === 0 ? undefined : step < 3 ? 128 : 32;
    last = await sharp(input, { failOn: "none" })
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      .png(
        colours
          ? { compressionLevel: 9, palette: true, colours, quality: 50, dither: 0.3 }
          : { compressionLevel: 9, palette: false },
      )
      .toBuffer();
    if (last.length < IMESSAGE_STICKER_MAX_BYTES) return last;
    if (step > 0) edge = Math.max(300, Math.round(edge * 0.75));
  }
  return last;
}

/** White border that follows the silhouette, sitting behind the subject so hair stays soft. */
async function dieCut(png: Buffer) {
  const meta = await sharp(png).metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  const stroke = Math.max(12, Math.min(22, Math.round(Math.min(w, h) * 0.045)));
  const canvasW = w + stroke * 2;
  const canvasH = h + stroke * 2;
  const placed = await sharp({
    create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: png, left: stroke, top: stroke }])
    .raw()
    .toBuffer();

  const core = new Uint8Array(canvasW * canvasH);
  for (let i = 0; i < core.length; i++) core[i] = placed[i * 4 + 3] > 40 ? 255 : 0;
  const grown = dilate(core, canvasW, canvasH, stroke);
  const out = Buffer.alloc(canvasW * canvasH * 4);
  for (let i = 0; i < core.length; i++) {
    const a = placed[i * 4 + 3];
    if (a > 0) {
      out[i * 4] = placed[i * 4];
      out[i * 4 + 1] = placed[i * 4 + 1];
      out[i * 4 + 2] = placed[i * 4 + 2];
      out[i * 4 + 3] = a;
    } else if (grown[i]) {
      out[i * 4] = 255;
      out[i * 4 + 1] = 255;
      out[i * 4 + 2] = 255;
      out[i * 4 + 3] = 255;
    }
  }
  return sharp(out, { raw: { width: canvasW, height: canvasH, channels: 4 } }).png().toBuffer();
}

/** Circular expansion of a binary mask, via a chamfer distance. */
function dilate(src: Uint8Array, w: number, h: number, radius: number) {
  const inf = 1e9;
  const dist = new Float32Array(w * h);
  for (let i = 0; i < dist.length; i++) dist[i] = src[i] ? 0 : inf;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) d = Math.min(d, dist[i - w] + 1);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - w - 1] + 1.414);
      if (x + 1 < w && y > 0) d = Math.min(d, dist[i - w + 1] + 1.414);
      dist[i] = d;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let d = dist[i];
      if (x + 1 < w) d = Math.min(d, dist[i + 1] + 1);
      if (y + 1 < h) d = Math.min(d, dist[i + w] + 1);
      if (x + 1 < w && y + 1 < h) d = Math.min(d, dist[i + w + 1] + 1.414);
      if (x > 0 && y + 1 < h) d = Math.min(d, dist[i + w - 1] + 1.414);
      dist[i] = d;
    }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) if (dist[i] <= radius) out[i] = 255;
  return out;
}
