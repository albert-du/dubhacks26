import { getLiveDumpster } from "@/lib/dumpsters";
import { isPublicKey, storage } from "@/lib/storage";

type Ctx = { params: Promise<{ key: string[] }> };

const TYPES: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

/**
 * Serves ONLY public renders (`{dumpsterId}/public/*`) of LIVE Dumpsters.
 * Originals are unreachable by construction; expired dumpsters 404 even before the purge runs.
 */
export async function GET(req: Request, { params }: Ctx) {
  const key = (await params).key.join("/");
  if (!isPublicKey(key)) return new Response("not found", { status: 404 });
  const d = await getLiveDumpster(key.split("/")[0]);
  if (!d) return new Response("gone", { status: 410 });

  // ?download=1 saves the file instead of opening it (works for the S3 redirect too).
  const download = new URL(req.url).searchParams.get("download") === "1";
  const filename = `dump-${key.split("/").pop()}`;
  // Stickers are proxied so the phone can read the bytes. A redirect to object storage
  // is cross-origin, and the share sheet cannot turn that into a file.
  if (download && key.includes("/public/sticker-")) {
    try {
      const body = await storage.get(key);
      const stickerName = (key.split("/").pop() ?? "sticker.png").replace(/[^\w.-]+/g, "") || "sticker.png";
      const ext = stickerName.split(".").pop() ?? "png";
      return new Response(new Uint8Array(body), {
        headers: {
          "content-type": TYPES[ext] ?? "application/octet-stream",
          "content-length": String(body.length),
          "content-disposition": `attachment; filename="${stickerName}"`,
          "cache-control": "private, no-store",
        },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  }

  const signed = await storage.signedUrl(key, download ? filename : undefined);
  if (signed) return Response.redirect(signed, 302);

  try {
    const r = await storage.localStream(key, req.headers.get("range"));
    const type = TYPES[key.split(".").pop() ?? ""] ?? "application/octet-stream";
    return new Response(r.body, {
      status: r.partial ? 206 : 200,
      headers: {
        "content-type": type,
        "content-length": String(r.end - r.start + 1),
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=3600",
        ...(download ? { "content-disposition": `attachment; filename="${filename}"` } : {}),
        ...(r.partial ? { "content-range": `bytes ${r.start}-${r.end}/${r.size}` } : {}),
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
