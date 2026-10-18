import { NextResponse } from "next/server";
import { z } from "zod";
import { getLiveDumpster } from "@/lib/dumpsters";
import { HttpError, notFound, route } from "@/lib/http";
import { cols } from "@/lib/mongo";
import { emptyReactions, isReactionKey } from "@/lib/reactions";
import { tiger } from "@/lib/tiger";
import { viewerId } from "@/lib/viewer";

type Ctx = { params: Promise<{ id: string; mediaId: string }> };

const Body = z.object({ key: z.string().refine(isReactionKey, "Unknown reaction") });

/** Toggles one reaction from this browser on a photo/video. */
export const POST = route<Ctx>(async (req, { params }) => {
  const { id, mediaId } = await params;
  const d = await getLiveDumpster(id);
  if (!d) throw notFound();
  const { key } = Body.parse(await req.json());
  if (!isReactionKey(key)) throw new HttpError(400, "Unknown reaction");
  const viewer = await viewerId();
  const { media, reactions } = await cols();
  if (!(await media.findOne({ _id: mediaId, dumpsterId: id, status: "ready" }, { projection: { _id: 1 } }))) {
    throw new HttpError(404, "No such photo");
  }

  const _id = `${mediaId}:${viewer}:${key}`;
  let on = false;
  let delta = 0;
  if ((await reactions.deleteOne({ _id })).deletedCount) {
    delta = -1;
  } else {
    on = true;
    try {
      await reactions.insertOne({ _id, dumpsterId: id, mediaId, viewerId: viewer, key, expiresAt: d.expiresAt });
      delta = 1;
    } catch {
      // double-tap race: the other request already inserted and counted it
    }
  }
  const updated = await media.findOneAndUpdate(
    { _id: mediaId },
    { $inc: { [`reactions.${key}`]: delta }, $set: { updatedAt: new Date() } },
    { returnDocument: "after", projection: { reactions: 1 } },
  );
  if (on) await tiger.engagement(id, "react");
  return NextResponse.json({ key, on, reactions: { ...emptyReactions(), ...updated?.reactions } });
});
