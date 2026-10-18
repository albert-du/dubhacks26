import sharp from "sharp";

/** Export public WebP renders in formats supported by photo apps. */
export function downloadFilename(key: string) {
  const name = key.split("/").pop()!;
  return name.replace(/\.webp$/i, name.startsWith("sticker-") ? ".png" : ".jpg");
}

export async function downloadBody(key: string, body: Buffer) {
  if (!/\.webp$/i.test(key)) return body;
  const image = sharp(body);
  return key.split("/").pop()!.startsWith("sticker-")
    ? image.png().toBuffer()
    : image.flatten({ background: "white" }).jpeg({ quality: 92 }).toBuffer();
}
