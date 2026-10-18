import sharp from "sharp";
import { fitIMessageSticker, IMESSAGE_STICKER_MAX_BYTES, IMESSAGE_STICKER_MAX_EDGE } from "./imaging";
import { STICKER_FILE_NAME } from "./sticker";

function fileName(key: string) {
  return key.split("/").pop()!;
}

function isSticker(key: string) {
  return fileName(key).startsWith("sticker-");
}

/** Export public renders in formats phones can keep. Stickers use one plain png name. */
export function downloadFilename(key: string) {
  if (isSticker(key)) return STICKER_FILE_NAME;
  return fileName(key).replace(/\.webp$/i, ".jpg");
}

export async function downloadBody(key: string, body: Buffer) {
  if (isSticker(key)) {
    if (/\.webp$/i.test(key)) return fitIMessageSticker(await sharp(body).png().toBuffer());
    // The stored PNG is already a sticker. Re-encoding every one on the way to the pack
    // was a sharp pass per sticker before the picture could even show.
    if (body.length < IMESSAGE_STICKER_MAX_BYTES) {
      const meta = await sharp(body, { failOn: "none" }).metadata();
      if (
        meta.format === "png" &&
        (meta.width ?? 0) > 0 &&
        (meta.width ?? 0) <= IMESSAGE_STICKER_MAX_EDGE &&
        (meta.height ?? 0) <= IMESSAGE_STICKER_MAX_EDGE
      ) {
        return body;
      }
    }
    return fitIMessageSticker(body);
  }
  if (!/\.webp$/i.test(key)) return body;
  return sharp(body).flatten({ background: "white" }).jpeg({ quality: 92 }).toBuffer();
}
