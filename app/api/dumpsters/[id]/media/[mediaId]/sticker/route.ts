import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getLiveDumpster } from "@/lib/dumpsters";
import { requireGuest } from "@/lib/guestAuth";
import { HttpError, notFound, route } from "@/lib/http";
import { cols } from "@/lib/mongo";
import { publicSticker } from "@/lib/serialize";
import { faceOverlapping, personBox, stickerId } from "@/lib/sticker";
import { tiger } from "@/lib/tiger";
import type { Box, Media, Sticker, StickerTarget } from "@/lib/types";

type Ctx = { params: Promise<{ id: string; mediaId: string }> };

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("frame") }),
  z.object({ kind: z.literal("object"), index: z.number().int().min(0).max(49) }),
  z.object({ kind: z.literal("face"), index: z.number().int().min(0).max(49) }),
]);

/** Queues a background-removed sticker of a person, an object, or everyone in the frame. */
export const POST = route<Ctx>(async (req, { params }) => {
  const { id, mediaId } = await params;
  const d = await getLiveDumpster(id);
  if (!d) throw notFound();
  await requireGuest(d._id);
  const target = Body.parse(await req.json().catch(() => ({})));
  const { media, stickers } = await cols();
  const m = await media.findOne({ _id: mediaId, dumpsterId: id, status: "ready", kind: "image" });
  if (!m) throw new HttpError(404, "Stickers come from photos that are ready");

  const _id = stickerId(mediaId, target);
  const existing = await stickers.findOne({ _id });
  if (existing && existing.status !== "failed") return NextResponse.json(publicSticker(existing));

  const { box, label } = await describeTarget(id, m, target);
  const now = new Date();
  const doc: Sticker = {
    _id,
    dumpsterId: id,
    mediaId,
    label,
    box,
    target,
    status: "pending",
    claimedAt: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    expiresAt: d.expiresAt,
  };
  await stickers.replaceOne({ _id }, doc, { upsert: true });
  await tiger.engagement(id, "sticker");
  after(async () => {
    try {
      const { processNextSticker } = await import("@/lib/pipeline");
      await processNextSticker();
    } catch (e) {
      console.error("[sticker]", (e as Error).message);
    }
  });
  return NextResponse.json(publicSticker(doc), { status: 202 });
});

async function describeTarget(dumpsterId: string, m: Media, target: StickerTarget): Promise<{ box: Box; label: string }> {
  if (target.kind === "frame") return { box: [0, 0, 1, 1], label: "everyone" };
  if (target.kind === "face") {
    const face = m.faces[target.index];
    if (!face) throw new HttpError(400, "That person is not in this photo");
    return { box: personBox(face.box), label: await clusterName(dumpsterId, face.clusterId) };
  }
  const object = m.objects[target.index];
  if (!object) throw new HttpError(400, "That object is not in this photo");
  if (object.label.toLowerCase() === "person") {
    const face = faceOverlapping(m.faces, object.box);
    return { box: object.box, label: await clusterName(dumpsterId, face?.clusterId) };
  }
  return { box: object.box, label: object.label };
}

async function clusterName(dumpsterId: string, clusterId: string | undefined): Promise<string> {
  if (!clusterId) return "person";
  const { clusters } = await cols();
  // Names live on the face. The projection leaves the centroid and exemplars out.
  const cluster = await clusters.findOne({ _id: clusterId, dumpsterId }, { projection: { name: 1 } });
  return cluster?.name?.trim() || "person";
}
