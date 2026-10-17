import { NextResponse } from "next/server";
import { z } from "zod";
import { getLiveDumpster } from "@/lib/dumpsters";
import { HttpError, notFound, route } from "@/lib/http";
import { cols } from "@/lib/mongo";
import { publicSticker } from "@/lib/serialize";
import { tiger } from "@/lib/tiger";
import type { Box, Sticker } from "@/lib/types";

type Ctx = { params: Promise<{ id: string; mediaId: string }> };

const Body = z.object({ subject: z.number().int().min(-1).max(2).default(-1) });

/** Queues a sticker cut from a Perceptron subject box (or the center of the frame). */
export const POST = route<Ctx>(async (req, { params }) => {
  const { id, mediaId } = await params;
  const d = await getLiveDumpster(id);
  if (!d) throw notFound();
  const { subject } = Body.parse(await req.json().catch(() => ({})));
  const { media, stickers } = await cols();
  const m = await media.findOne({ _id: mediaId, dumpsterId: id, status: "ready", kind: "image" });
  if (!m) throw new HttpError(404, "Stickers come from photos that are ready");

  const s = subject >= 0 ? m.subjects[subject] : undefined;
  const box: Box = s?.box ?? [0.12, 0.12, 0.88, 0.88];
  const _id = `${mediaId}-${subject}`;
  const existing = await stickers.findOne({ _id });
  if (existing && existing.status !== "failed") return NextResponse.json(publicSticker(existing));

  const now = new Date();
  const doc: Sticker = {
    _id,
    dumpsterId: id,
    mediaId,
    label: s?.label ?? m.tags[0] ?? "moment",
    box,
    status: "pending",
    claimedAt: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: d.expiresAt,
  };
  await stickers.replaceOne({ _id }, doc, { upsert: true });
  await tiger.engagement(id, "sticker");
  return NextResponse.json(publicSticker(doc), { status: 202 });
});
