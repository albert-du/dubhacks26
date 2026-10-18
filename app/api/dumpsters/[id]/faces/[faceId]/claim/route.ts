import { NextResponse } from "next/server";
import { getLiveDumpster } from "@/lib/dumpsters";
import { claimFaces } from "@/lib/enroll";
import { requireGuest } from "@/lib/guestAuth";
import { HttpError, notFound, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string; faceId: string }> };

/** "That's me": claim a face nobody has claimed yet. It takes your name and its new shots become yours. */
export const POST = route<Ctx>(async (_req, { params }) => {
  const { id, faceId } = await params;
  const d = await getLiveDumpster(id);
  if (!d) throw notFound();
  const guest = await requireGuest(d._id);
  if (!(await claimFaces(d, guest, [faceId]))) throw new HttpError(409, "Someone already said that face is them.");
  return NextResponse.json({ id: faceId, name: guest.name });
});
