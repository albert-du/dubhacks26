import { NextResponse } from "next/server";
import { z } from "zod";
import { getLiveDumpster } from "@/lib/dumpsters";
import { nameKey } from "@/lib/enroll";
import { requireGuest } from "@/lib/guestAuth";
import { HttpError, notFound, route } from "@/lib/http";
import { cols } from "@/lib/mongo";
import { findMentions } from "@/lib/transcribe";

type Ctx = { params: Promise<{ id: string; faceId: string }> };

const Body = z.object({ name: z.string().trim().max(40) });

/**
 * Name (or rename, or un-name with "") a face in the gallery. Open like the rest of the
 * dumpster: anyone in it can do this. Video mentions are re-checked so the new name
 * finds clips where it was said.
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const { id, faceId } = await params;
  const d = await getLiveDumpster(id);
  if (!d) throw notFound();
  await requireGuest(d._id);
  const { name } = Body.parse(await req.json());
  const { clusters, media, guests } = await cols();

  const face = await clusters.findOne({ _id: faceId, dumpsterId: id }, { projection: { name: 1, guestId: 1 } });
  if (!face) throw new HttpError(404, "That face isn’t here anymore");
  // No two people share a name: a signed-in guest's name only goes on their own faces.
  const holder = name ? await guests.findOne({ dumpsterId: id, nameKey: nameKey(name) }, { projection: { _id: 1 } }) : null;
  if (holder && holder._id !== face.guestId) {
    throw new HttpError(409, `${name} is signed in here. If this is them, they can tap the face and choose That’s me.`);
  }
  const now = new Date();
  await clusters.updateOne(
    { _id: faceId },
    name ? { $set: { name, updatedAt: now } } : { $unset: { name: "" }, $set: { updatedAt: now } },
  );

  // Keep video mentions in step with face names.
  const videos = await media
    .find({ dumpsterId: id, kind: "video", status: "ready", transcript: { $exists: true } }, { projection: { transcript: 1, mentions: 1 } })
    .toArray();
  for (const v of videos) {
    const next = new Set((v.mentions ?? []).filter((n) => n !== face.name));
    if (name && findMentions(v.transcript ?? "", [name]).length) next.add(name);
    const changed = next.size !== (v.mentions ?? []).length || [...next].some((n) => !(v.mentions ?? []).includes(n));
    if (changed) await media.updateOne({ _id: v._id }, { $set: { mentions: [...next], updatedAt: now } });
  }

  return NextResponse.json({ id: faceId, name: name || undefined });
});
