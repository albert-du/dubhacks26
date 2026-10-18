import { NextResponse } from "next/server";
import { getLiveDumpster } from "@/lib/dumpsters";
import { z } from "zod";
import { enrollGuest, renameGuest } from "@/lib/enroll";
import { HttpError, notFound, route } from "@/lib/http";
import { cols } from "@/lib/mongo";
import { viewerId } from "@/lib/viewer";

type Ctx = { params: Promise<{ id: string }> };

const Name = z.string().trim().min(1, "What should we call you?").max(40);

/** Sign in to this dumpster: a name and a selfie (taken or uploaded). */
export const POST = route<Ctx>(async (req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  const form = await req.formData();

  const name = Name.parse(String(form.get("name") ?? ""));
  const selfieFile = form.get("selfie");
  if (!(selfieFile instanceof File) || !selfieFile.size) throw new HttpError(400, "Add a selfie so people can find your photos");
  if (selfieFile.size > 15 * 1024 * 1024) throw new HttpError(413, "That selfie is too large");

  const result = await enrollGuest(d, await viewerId(), { name, selfie: Buffer.from(await selfieFile.arrayBuffer()) });
  return NextResponse.json(result);
});

/** Change the name you signed in with (and on your face). */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  const { name } = z.object({ name: Name }).parse(await req.json());
  await renameGuest(d, await viewerId(), name);
  return NextResponse.json({ ok: true, name });
});

/** Sign out: forget this browser's name, number and selfie vector, and release its faces. */
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
