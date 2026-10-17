import { getLiveDumpster } from "@/lib/dumpsters";
import { isPublicKey, storage } from "@/lib/storage";

type Ctx = { params: Promise<{ key: string[] }> };

const TYPES: Record<string, string> = {
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

/**
 * Serves ONLY public renders (`{dumpsterId}/public/*`) of LIVE Dumpsters.
 * Originals are unreachable by construction; expired rooms 404 even before the purge runs.
 */
export async function GET(req: Request, { params }: Ctx) {
  const key = (await params).key.join("/");
  if (!isPublicKey(key)) return new Response("not found", { status: 404 });
  const d = await getLiveDumpster(key.split("/")[0]);
  if (!d) return new Response("gone", { status: 410 });

  const signed = await storage.signedUrl(key);
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
        ...(r.partial ? { "content-range": `bytes ${r.start}-${r.end}/${r.size}` } : {}),
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
