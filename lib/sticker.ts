import type { Box, StickerTarget } from "./types";

export function clampBox(box: Box): Box {
  let x1 = clamp01(Math.min(box[0], box[2]));
  let y1 = clamp01(Math.min(box[1], box[3]));
  let x2 = clamp01(Math.max(box[0], box[2]));
  let y2 = clamp01(Math.max(box[1], box[3]));
  if (x2 - x1 < 0.01) {
    if (x1 <= 0.01) x2 = Math.min(1, x1 + 0.01);
    else x1 = x2 - 0.01;
  }
  if (y2 - y1 < 0.01) {
    if (y1 <= 0.01) y2 = Math.min(1, y1 + 0.01);
    else y1 = y2 - 0.01;
  }
  return [x1, y1, x2, y2];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * A face box is the head. Stretch it into a body window so the cutout keeps
 * hair, shoulders, and most of the person instead of a floating head.
 */
export function personBox(face: Box): Box {
  const [x1, y1, x2, y2] = face;
  const fw = Math.max(0.02, x2 - x1);
  const fh = Math.max(0.02, y2 - y1);
  const cx = (x1 + x2) / 2;
  const top = y1 - fh * 0.7;
  const width = fw * 3.6;
  const height = fh * 7.5;
  return clampBox([cx - width / 2, top, cx + width / 2, top + height]);
}

export function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  return w * h;
}

export function faceOverlapping<T extends { box: Box }>(faces: T[], box: Box): T | undefined {
  let best: T | undefined;
  let score = 0;
  for (const face of faces) {
    const area = overlapArea(face.box, box);
    if (area > score) {
      best = face;
      score = area;
    }
  }
  return best;
}

export function stickerId(mediaId: string, target: StickerTarget): string {
  if (target.kind === "frame") return `${mediaId}-frame`;
  return `${mediaId}-${target.kind}-${target.index}`;
}

/**
 * Name on the share sheet and on download.
 * iMessage prints the file name on the bubble when a share is titled or the
 * image is not a sticker, so this stays a plain png name.
 */
export const STICKER_FILE_NAME = "sticker.png";

export function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}
