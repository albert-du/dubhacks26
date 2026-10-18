import { NextResponse } from "next/server";
import { z } from "zod";
import { perceptron } from "@/lib/ai-perceptron";
import { config } from "@/lib/config";
import { HttpError, route } from "@/lib/http";
import { normalizeImage } from "@/lib/imaging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BODY_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8192;
const input = z.object({
  prompt: z.string().trim().min(1).max(2000).default("Describe what you see in this image."),
  image: z.string().min(1).max(MAX_BODY_BYTES),
});

/** Stateless vision inference. Images are decoded in memory and never stored. */
export const POST = route(async (req: Request) => {
  if (!perceptron.enabled()) throw new HttpError(503, "Vision analysis is not configured.");
  if (!req.headers.get("content-type")?.includes("application/json")) {
    throw new HttpError(415, "Send JSON with prompt and a base64 image.");
  }
  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) throw new HttpError(413, "Image is too large (5 MiB maximum).");
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Send JSON with prompt and a base64 image.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "Image is too large (5 MiB maximum).");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "Invalid JSON."); }
  const { image, prompt } = input.parse(body);
  // Accept raw base64 or a data URI, never fetch caller-supplied remote URLs.
  const encoded = image.replace(/^data:image\/[\w.+-]+;base64,/i, "").replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new HttpError(400, "Image must be base64 or an image data URI.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, "Image is too large (5 MiB maximum).");
  let jpeg: Buffer;
  try { ({ jpeg } = await normalizeImage(bytes)); }
  catch { throw new HttpError(415, "Could not decode the image."); }
  let analysis: string;
  try { analysis = await perceptron.describe(jpeg, prompt); }
  catch { throw new HttpError(502, "Vision model request failed. Try again later."); }
  return NextResponse.json({ analysis, model: config.perceptron.model }, { headers: { "cache-control": "no-store" } });
});
