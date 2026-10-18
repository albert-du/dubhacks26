import { getLiveDumpster } from "@/lib/dumpsters";
import { renderThumb } from "@/lib/imaging";
import { isPreviewKey, previewEdge, previewKey, type PreviewEdge } from "@/lib/preview";
import { isPublicKey, storage } from "@/lib/storage";
import { downloadBody, downloadFilename } from "@/lib/download";

type Ctx = { params: Promise<{ key: string[] }> };

const TYPES: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

const RASTER = /\.(webp|png|jpe?g)$/i;

/** A screen of photos should not mean a screen of dumpster lookups. Re-check within 10s, or at burn time. */
const liveUntil = new Map<string, number>();
const liveInflight = new Map<string, Promise<boolean>>();

async function dumpsterIsLive(id: string) {
  const now = Date.now();
  const until = liveUntil.get(id);
  if (until !== undefined && until > now) return true;
  const pending = liveInflight.get(id);
  if (pending) return pending;
  const next = (async () => {
    const d = await getLiveDumpster(id);
    if (!d) {
      liveUntil.delete(id);
      return false;
    }
    liveUntil.set(id, Math.min(d.expiresAt.getTime(), Date.now() + 10_000));
    return true;
  })().finally(() => liveInflight.delete(id));
  liveInflight.set(id, next);
  return next;
}

let previewActive = 0;
const previewWaiters: (() => void)[] = [];

/** A grid must not start dozens of sharp resizes at once. */
function withPreviewSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (previewActive >= 3) {
    return new Promise<T>((resolve, reject) => {
      previewWaiters.push(() => {
        withPreviewSlot(fn).then(resolve, reject);
      });
    });
  }
  previewActive += 1;
  return fn().finally(() => {
    previewActive -= 1;
    previewWaiters.shift()?.();
  });
}

async function previewBytes(key: string, edge: PreviewEdge): Promise<Buffer | null> {
  const stored = previewKey(key, edge);
  const hit = await storage.readIfExists(stored);
  if (hit) return hit;
  return withPreviewSlot(async () => {
    const again = await storage.readIfExists(stored);
    if (again) return again;
    const full = await storage.readIfExists(key);
    if (!full) return null;
    const thumb = await renderThumb(full, edge);
    await storage.put(stored, thumb, "image/webp");
    return thumb;
  });
}

function imageResponse(body: Buffer, cache: string) {
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "image/webp",
      "content-length": String(body.length),
      "cache-control": cache,
    },
  });
}

/**
 * Serves ONLY public renders (`{dumpsterId}/public/*`) of LIVE Dumpsters.
 * Originals are unreachable by construction; expired dumpsters 404 even before the purge runs.
 *
 * `?s=320` or `?s=960` is a small WebP of that render, cached on the stable URL so
 * switching screens does not download the full photo again.
 */
export async function GET(req: Request, { params }: Ctx) {
  const key = (await params).key.join("/");
  if (!isPublicKey(key)) return new Response("not found", { status: 404 });
  if (!(await dumpsterIsLive(key.split("/")[0]))) return new Response("gone", { status: 410 });

  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "1";
  const edge = !download && !isPreviewKey(key) ? previewEdge(url.searchParams.get("s")) : null;
  const filename = `dump-${key.split("/").pop()}`;

  // ?download=1 saves the file instead of opening it (works for the S3 redirect too).
  if (download && (/\.webp$/i.test(key) || key.includes("/public/sticker-"))) {
    try {
      const body = await downloadBody(key, await storage.get(key));
      const exportName = `${key.includes("/public/sticker-") ? "" : "dump-"}${downloadFilename(key)}`.replace(/[^\w.-]+/g, "");
      const ext = exportName.split(".").pop() ?? "png";
      const sticker = key.includes("/public/sticker-");
      return new Response(new Uint8Array(body), {
        headers: {
          "content-type": TYPES[ext] ?? "application/octet-stream",
          "content-length": String(body.length),
          "content-disposition": `attachment; filename="${exportName}"`,
          // Stickers are fetched again for the share sheet. The version query busts a recut.
          "cache-control": sticker ? "private, max-age=3600" : "private, no-store",
        },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  }

  if (edge && RASTER.test(key)) {
    try {
      const body = await previewBytes(key, edge);
      if (!body) return new Response("not found", { status: 404 });
      // The `v` query changes when the file is replaced, so this can sit in the private cache.
      return imageResponse(body, "private, max-age=86400");
    } catch {
      return new Response("not found", { status: 404 });
    }
  }

  const signed = await storage.signedUrl(key, download ? filename : undefined);
  if (signed) {
    return new Response(null, {
      status: 302,
      headers: {
        location: signed,
        // Shorter than the signature lifetime, so a cached redirect never points at a dead URL.
        "cache-control": download ? "private, no-store" : "private, max-age=120",
      },
    });
  }

  try {
    const r = await storage.localStream(key, req.headers.get("range"));
    const type = TYPES[key.split(".").pop() ?? ""] ?? "application/octet-stream";
    return new Response(r.body, {
      status: r.partial ? 206 : 200,
      headers: {
        "content-type": type,
        "content-length": String(r.end - r.start + 1),
        "accept-ranges": "bytes",
        "cache-control": download || r.partial ? "private, no-store" : "private, max-age=3600",
        ...(download ? { "content-disposition": `attachment; filename="${filename}"` } : {}),
        ...(r.partial ? { "content-range": `bytes ${r.start}-${r.end}/${r.size}` } : {}),
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
