import { NextResponse } from "next/server";
import { getLiveDumpster } from "@/lib/dumpsters";
import { requireGuest } from "@/lib/guestAuth";
import { HttpError, notFound, route } from "@/lib/http";
import { cols } from "@/lib/mongo";
import { storage } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string; stickerId: string }> };

/**
 * Take a sticker out of the pack, for everyone (anyone signed in can, like deleting a shot).
 * The cutout file is deleted now. The record stays, marked deleted, so other phones drop it
 * from their pack; it burns with the dumpster.
 */
export const DELETE = route<Ctx>(async (_req, { params }) => {
  const { id, stickerId } = await params;
  const d = await getLiveDumpster(id);
  if (!d) throw notFound();
  await requireGuest(d._id);
  const { stickers } = await cols();
  const s = await stickers.findOne({ _id: stickerId, dumpsterId: id });
  if (!s || s.status === "deleted") throw new HttpError(404, "That sticker is already gone");
  if (s.publicKey) await storage.delete(s.publicKey);
  await stickers.updateOne({ _id: s._id }, { $set: { status: "deleted", updatedAt: new Date() }, $unset: { publicKey: "", claimedAt: "" } });
  return NextResponse.json({ ok: true });
});
