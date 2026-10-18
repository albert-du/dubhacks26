import sharp from "sharp";
import { fitIMessageSticker } from "./imaging";
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
    const png = /\.webp$/i.test(key) ? await sharp(body).png().toBuffer() : body;
    return fitIMessageSticker(png);
  }
  if (!/\.webp$/i.test(key)) return body;
  return sharp(body).flatten({ background: "white" }).jpeg({ quality: 92 }).toBuffer();
}
