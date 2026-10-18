import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";

/**
 * BiRefNet general-lite (MIT). Salient-object mask used to cut a person out of a photo.
 * Weights stay on disk; the photo is never uploaded to get a sticker.
 * md5 matches the rembg release asset.
 */
export const STICKER_MODEL_URL =
  "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx";
export const STICKER_MODEL_MD5 = "4fab47adc4ff364be1713e97b7e66334";

const DEFAULT_PATH = () => path.join(process.cwd(), ".data", "models", "birefnet-general-lite.onnx");

let ready: Promise<string> | null = null;

/** Local path to the cutout weights. Downloads once into `.data/models` when missing. */
export function stickerModelPath(): Promise<string> {
  const dest = process.env.STICKER_MODEL_PATH || DEFAULT_PATH();
  return (ready ??= ensureStickerModel(dest).catch((err) => {
    ready = null;
    throw err;
  }));
}

export async function ensureStickerModel(dest: string): Promise<string> {
  if (await checksumMatches(dest)) return dest;
  await mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const res = await fetch(STICKER_MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`sticker model download failed (${res.status})`);
  const hash = createHash("md5");
  const hasher = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk as Buffer);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body as NodeWebStream), hasher, createWriteStream(part));
    if (hash.digest("hex") !== STICKER_MODEL_MD5) throw new Error("sticker model checksum did not match");
    await rename(part, dest);
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }
  return dest;
}

async function checksumMatches(dest: string): Promise<boolean> {
  try {
    const hash = createHash("md5");
    for await (const chunk of createReadStream(dest)) hash.update(chunk as Buffer);
    return hash.digest("hex") === STICKER_MODEL_MD5;
  } catch {
    return false;
  }
}
