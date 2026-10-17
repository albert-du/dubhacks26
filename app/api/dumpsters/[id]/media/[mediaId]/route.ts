import { NextResponse } from "next/server";
import { publish } from "@/lib/backboard";
import { getLiveDumpster, isHost } from "@/lib/dumpsters";
import { HttpError, notFound, route } from "@/lib/http";
import { cols } from "@/lib/mongo";
import { storage } from "@/lib/storage";
import { viewerId } from "@/lib/viewer";

type Ctx = { params: Promise<{ id: string; mediaId: string }> };

/** Uploader or host can pull a photo out of the pool. Blobs go immediately. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const { id, mediaId } = await params;
  const d = await getLiveDumpster(id);
  if (!d) throw notFound();
  const { media, votes, stickers } = await cols();
  const m = await media.findOne({ _id: mediaId, dumpsterId: id });
  if (!m || m.status === "deleted") throw new HttpError(404, "Already gone");
  if (m.uploaderId !== (await viewerId()) && !isHost(d, req.headers.get("x-host-token"))) {
    throw new HttpError(403, "Only the uploader or host can delete this");
  }
  const stickerDocs = await stickers.find({ mediaId }).toArray();
  await Promise.all([
    storage.delete(m.originalKey),
    m.publicKey ? storage.delete(m.publicKey) : null,
    ...stickerDocs.map((s) => (s.publicKey ? storage.delete(s.publicKey) : null)),
  ]);
  await media.updateOne(
    { _id: mediaId },
    { $set: { status: "deleted", faces: [], text: [], transcript: undefined, updatedAt: new Date() }, $unset: { publicKey: "" } },
  );
  await votes.deleteMany({ mediaId });
  await stickers.deleteMany({ mediaId });
  await publish(id, { type: "media", mediaId });
  return NextResponse.json({ ok: true });
});
