import { NextResponse } from "next/server";
import { getLiveDumpster } from "@/lib/dumpsters";
import { enrollGuest } from "@/lib/enroll";
import { HttpError, notFound, route } from "@/lib/http";
import { cols } from "@/lib/mongo";
import { normalizePhone } from "@/lib/photon";
import { viewerId } from "@/lib/viewer";

type Ctx = { params: Promise<{ id: string }> };

/** Text sign-up: phone + selfie, so we know whose face to watch for. Requires explicit opt-in. */
export const POST = route<Ctx>(async (req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  const form = await req.formData();

  if (form.get("consent") !== "yes") throw new HttpError(400, "Turn on texts first");

  const phone = normalizePhone(String(form.get("phone") ?? "").trim());
  if (!phone) throw new HttpError(400, "That phone number doesn't look right");

  const selfieFile = form.get("selfie");
  if (!(selfieFile instanceof File) || !selfieFile.size) throw new HttpError(400, "Snap a selfie so we know it’s you");
  if (selfieFile.size > 10 * 1024 * 1024) throw new HttpError(413, "Selfie too large");

  const result = await enrollGuest(d, await viewerId(), { phone, selfie: Buffer.from(await selfieFile.arrayBuffer()) });
  return NextResponse.json(result);
});

/** Stop texts: forget this browser's number and selfie vector, and release its faces. */
export const DELETE = route<Ctx>(async (_req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  const { guests, clusters } = await cols();
  const g = await guests.findOne({ dumpsterId: d._id, viewerId: await viewerId() }, { projection: { _id: 1 } });
  if (g) {
    await clusters.updateMany({ guestId: g._id }, { $unset: { guestId: "" }, $set: { updatedAt: new Date() } });
    await guests.deleteOne({ _id: g._id });
  }
  return NextResponse.json({ ok: true });
});
