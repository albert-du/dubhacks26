import os from "node:os";
import sharp from "sharp";
import { stickerModelPath } from "./stickerModel";

const SIZE = 1024;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

type Session = {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | Uint8Array; dims: readonly number[] }>>;
};

let sessionPromise: Promise<Session> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function session(): Promise<Session> {
  sessionPromise ??= loadSession().catch((err) => {
    sessionPromise = null;
    throw err;
  });
  return sessionPromise;
}

async function loadSession(): Promise<Session> {
  const ort = await import("onnxruntime-node");
  const model = await stickerModelPath();
  const threads = Math.max(1, Math.min(4, os.cpus().length));
  return ort.InferenceSession.create(model, {
    executionProviders: ["cpu"],
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
  }) as Promise<Session>;
}

/**
 * Foreground matte for one image, same pixel size as the input.
 * Runs BiRefNet on a 1024 stretch, then scales the matte back.
 * Calls are serialized: one session cannot run two stickers at once.
 */
export function foregroundMask(image: Buffer): Promise<Buffer> {
  const run = queue.then(() => maskOne(image));
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function maskOne(image: Buffer): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  const width = meta.width ?? 1;
  const height = meta.height ?? 1;
  const rgb = await sharp(image).resize(SIZE, SIZE, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const input = normalize(rgb);
  const ort = await import("onnxruntime-node");
  const current = await session();
  const tensor = new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]);
  let result: Record<string, { data: Float32Array | Uint8Array; dims: readonly number[] }>;
  try {
    result = await current.run({ [current.inputNames[0]]: tensor });
  } catch (err) {
    sessionPromise = null;
    throw err;
  }
  const out = result[current.outputNames[0]];
  if (!out) throw new Error("cutout model returned nothing");
  const mask = logitsToMask(out.data, out.dims);
  return sharp(mask, { raw: { width: SIZE, height: SIZE, channels: 1 } })
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
}

/** Match the rembg BiRefNet preprocess: divide by the max channel, then ImageNet mean/std, NCHW. */
function normalize(rgb: Buffer): Float32Array {
  let max = 0;
  for (let i = 0; i < rgb.length; i++) if (rgb[i] > max) max = rgb[i];
  const scale = Math.max(max, 1);
  const plane = SIZE * SIZE;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      const v = rgb[i * 3 + c] / scale;
      out[c * plane + i] = (v - MEAN[c]) / STD[c];
    }
  }
  return out;
}

function logitsToMask(data: Float32Array | Uint8Array, dims: readonly number[]): Buffer {
  const h = dims[dims.length - 2] ?? 0;
  const w = dims[dims.length - 1] ?? 0;
  const plane = h * w;
  if (h !== SIZE || w !== SIZE || data.length < plane) throw new Error(`unexpected mask shape ${dims.join("x")}`);
  let mi = Infinity;
  let ma = -Infinity;
  const sig = new Float32Array(plane);
  for (let i = 0; i < plane; i++) {
    const s = sigmoid(Number(data[i]));
    sig[i] = s;
    if (s < mi) mi = s;
    if (s > ma) ma = s;
  }
  const span = ma - mi || 1;
  const mask = Buffer.alloc(plane);
  for (let i = 0; i < plane; i++) mask[i] = Math.round(((sig[i] - mi) / span) * 255);
  return mask;
}

function sigmoid(x: number) {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}
