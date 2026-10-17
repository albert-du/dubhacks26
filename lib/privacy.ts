import sharp from "sharp";
import type { Box } from "./types";

/* ---------------- Sensitive text detection (runs on Perceptron OCR output) ---------------- */

const HINTS = new Set(["license_plate", "id_card", "credit_card", "address", "phone", "email"]);

export function classifySensitive(text: string, hint?: string): string | null {
  if (hint && HINTS.has(hint)) return hint;
  const t = text.trim();
  const digits = t.replace(/[\s-]/g, "");
  if (/^\d{13,19}$/.test(digits) && luhn(digits)) return "credit_card";
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(t)) return "ssn";
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(t)) return "email";
  if (/(\+?\d[\d\s().-]{8,}\d)/.test(t) && t.replace(/\D/g, "").length >= 10) return "phone";
  if (/\b(driver'?s? licen[cs]e|passport|date of birth|DOB|ID\s?(no|number|#))\b/i.test(t)) return "id_card";
  // Short mixed letter+digit tokens are typical of license plates (e.g. "7ABC123", "ABC-1234").
  if (/^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{2,4}[\s-]?[A-Z0-9]{2,5}$/.test(t)) return "license_plate";
  return null;
}

function luhn(num: string) {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/* ---------------- Image normalization + irreversible redaction ---------------- */

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

/**
 * Renders the public variant: every box in `redact` is pixelated to ~6 blocks and then
 * blurred, which is not recoverable from the output. Output is WebP with no metadata.
 */
export async function renderPublic(jpeg: Buffer, width: number, height: number, redact: Box[]) {
  const overlays = await Promise.all(
    redact.map(async (box) => {
      const r = pixelRect(box, width, height, 0.25);
      const blocks = Math.max(1, Math.round(Math.max(r.width, r.height) / 6));
      const tile = await sharp(jpeg)
        .extract(r)
        .resize(Math.max(1, Math.round(r.width / blocks)), Math.max(1, Math.round(r.height / blocks)))
        .resize(r.width, r.height, { kernel: "nearest" })
        .blur(Math.max(2, blocks / 3))
        .toBuffer();
      return { input: tile, left: r.left, top: r.top };
    }),
  );
  return sharp(jpeg).composite(overlays).webp({ quality: 82 }).toBuffer();
}

/** Sticker: crop a subject from the already-redacted public image, die-cut style. */
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
