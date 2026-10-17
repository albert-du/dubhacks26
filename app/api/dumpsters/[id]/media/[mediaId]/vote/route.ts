import { NextResponse } from "next/server";
import { getLiveDumpster } from "@/lib/dumpsters";
import { HttpError, notFound, route } from "@/lib/http";
import { cols } from "@/lib/mongo";
import { tiger } from "@/lib/tiger";
import { viewerId } from "@/lib/viewer";

type Ctx = { params: Promise<{ id: string; mediaId: string }> };

/** Toggles this browser's 🔥 on a photo. */
export const POST = route<Ctx>(async (_req, { params }) => {
  const { id, mediaId } = await params;
  const d = await getLiveDumpster(id);
  if (!d) throw notFound();
  const viewer = await viewerId();
  const { media, votes } = await cols();
  if (!(await media.findOne({ _id: mediaId, dumpsterId: id, status: "ready" }, { projection: { _id: 1 } }))) {
    throw new HttpError(404, "No such photo");
  }

  const _id = `${mediaId}:${viewer}`;
  let voted = false;
  let delta = 0;
  const removed = await votes.deleteOne({ _id });
  if (removed.deletedCount) {
    delta = -1;
  } else {
    voted = true;
    try {
      await votes.insertOne({ _id, dumpsterId: id, mediaId, viewerId: viewer, expiresAt: d.expiresAt });
      delta = 1;
    } catch {
      // double-tap race: the other request already inserted and counted it
    }
  }
  const updated = await media.findOneAndUpdate(
    { _id: mediaId },
    { $inc: { votes: delta }, $set: { updatedAt: new Date() } },
    { returnDocument: "after", projection: { votes: 1 } },
  );
  if (voted) await tiger.engagement(id, "vote");
  return NextResponse.json({ voted, votes: updated?.votes ?? 0 });
});
