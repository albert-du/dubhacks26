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

function pixelRect(box: Box, W: number, H: number, pad: number) {
  const bw = box[2] - box[0];
  const bh = box[3] - box[1];
  const left = Math.max(0, Math.floor((box[0] - bw * pad) * W));
  const top = Math.max(0, Math.floor((box[1] - bh * pad) * H));
  const right = Math.min(W, Math.ceil((box[2] + bw * pad) * W));
  const bottom = Math.min(H, Math.ceil((box[3] + bh * pad) * H));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/** Public variant: oriented, size-capped WebP with all metadata (GPS, device) stripped. */
export async function renderPublic(jpeg: Buffer) {
  return sharp(jpeg).webp({ quality: 82 }).toBuffer();
}

/** Sticker: crop a object from the public image, die-cut style. */
export async function renderSticker(publicImage: Buffer, box: Box) {
  const img = sharp(publicImage);
  const { width = 1, height = 1 } = await img.metadata();
  const r = pixelRect(box, width, height, 0.08);
  const size = 512;
  const crop = await sharp(publicImage)
    .extract(r)
    .resize(size, size, { fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });
  const border = 18;
  const w = crop.info.width + border * 2;
  const h = crop.info.height + border * 2;
  const mask = Buffer.from(
    `<svg width="${crop.info.width}" height="${crop.info.height}"><rect width="100%" height="100%" rx="28" ry="28"/></svg>`,
  );
  const rounded = await sharp(crop.data).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: Buffer.from(`<svg width="${w}" height="${h}"><rect width="100%" height="100%" rx="40" ry="40" fill="#fff"/></svg>`) },
      { input: rounded, left: border, top: border },
    ])
    .webp({ quality: 90 })
    .toBuffer();
}
