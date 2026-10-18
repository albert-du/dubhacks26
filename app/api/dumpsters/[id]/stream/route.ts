import { getLiveDumpster } from "@/lib/dumpsters";
import { cols } from "@/lib/mongo";
import { myReactions, publicClusters, publicMedia, publicSticker } from "@/lib/serialize";
import { viewerId } from "@/lib/viewer";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

const POLL_MS = 2000;
/** Overlap window so clock skew between web and worker hosts can't drop an update. Clients merge idempotently. */
const OVERLAP_MS = 5000;

/**
 * Server-Sent Events feed for a dumpster. Works everywhere without extra infra; Backboard
 * (lib/backboard.ts) carries the same events for stage displays when configured.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const d0 = await getLiveDumpster(id);
  if (!d0) return new Response("gone", { status: 404 });
  const viewer = await viewerId();
  const since0 = new URL(req.url).searchParams.get("since");
  const { media, stickers, clusters } = await cols();
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      req.signal.addEventListener("abort", () => (open = false));
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      let since = since0 ? new Date(since0) : new Date();
      let idle = 0;

      while (open) {
        try {
          const d = await getLiveDumpster(id);
          if (!d) {
            send("destroyed", {});
            break;
          }
          const now = new Date();
          const after = new Date(since.getTime() - OVERLAP_MS);
          let sent = false;

          const changed = await media
            .find(
              { dumpsterId: id, updatedAt: { $gt: after }, status: { $in: ["ready", "deleted", "failed"] } },
              { projection: { "faces.embedding": 0 } },
            )
            .sort({ updatedAt: 1 })
            .limit(200)
            .toArray();
          if (changed.length) {
            const mine = await myReactions(
              id,
              viewer,
              changed.map((m) => m._id),
            );
            send(
              "media",
              changed.map((m) => publicMedia(m, mine.get(m._id) ?? [])),
            );
            sent = true;
          }

          const st = await stickers.find({ dumpsterId: id, updatedAt: { $gt: after } }).toArray();
          if (st.length) {
            send("stickers", st.map(publicSticker));
            sent = true;
          }

          if (await clusters.findOne({ dumpsterId: id, updatedAt: { $gt: after } }, { projection: { _id: 1 } })) {
            send("clusters", await publicClusters(d));
            sent = true;
          }

          since = now;
          idle = sent ? 0 : idle + 1;
          if (idle * POLL_MS >= 15_000) {
            controller.enqueue(enc.encode(`: ping\n\n`));
            idle = 0;
          }
        } catch (e) {
          console.warn("[stream]", (e as Error).message);
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      try {
        controller.close();
      } catch {}
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
