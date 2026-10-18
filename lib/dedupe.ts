import { createHash } from "node:crypto";
import sharp from "sharp";

/** Exact byte hash — catches the same file uploaded twice (photos and videos). */
export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/**
 * 64-bit difference hash (dHash) of the image's pixels, as 16 hex chars. Survives
 * re-encoding, resizing and metadata stripping, so a re-shared or re-compressed copy
 * of the same photo lands within a few bits of the original.
 */
export async function pixelHash(img: Buffer): Promise<string> {
  const px = await sharp(img).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export interface DedupeCandidate {
  _id: string;
  sha256?: string;
  phash?: string;
  takenAt?: Date;
}

/** Same capture moment, as far as camera clocks can tell. */
const SAME_MOMENT_MS = 2000;

/**
 * Returns the id of the earliest candidate this item duplicates, if any.
 * - identical bytes → duplicate
 * - near-identical pixels (≤4 bits) → duplicate unless capture times prove they're different shots
 * - very similar pixels (≤8 bits) → duplicate only when captured within the same ~2s (resends, bursts)
 * Candidates must be ordered oldest first.
 */
export function findDuplicate(item: Omit<DedupeCandidate, "_id">, candidates: DedupeCandidate[]): string | undefined {
  for (const c of candidates) {
    if (item.sha256 && c.sha256 === item.sha256) return c._id;
    if (!item.phash || !c.phash) continue;
    const d = hamming(item.phash, c.phash);
    const dt = item.takenAt && c.takenAt ? Math.abs(item.takenAt.getTime() - c.takenAt.getTime()) : null;
    if (d <= 4 && (dt === null || dt <= SAME_MOMENT_MS)) return c._id;
    if (d <= 8 && dt !== null && dt <= SAME_MOMENT_MS) return c._id;
  }
  return undefined;
}
