import { NextResponse } from "next/server";
import { z } from "zod";
import { getLiveDumpster } from "@/lib/dumpsters";
import { hideFace, unhideFace } from "@/lib/faceIdentity";
import { requireGuest } from "@/lib/guestAuth";
import { notFound, route } from "@/lib/http";
import { nameFace } from "@/lib/names";

type Ctx = { params: Promise<{ id: string; faceId: string }> };

const Body = z.object({ name: z.string().trim().max(40), group: z.boolean().optional() });

/**
 * Name (or rename, or un-name with "") a face in the gallery. Open like the rest of the
 * dumpster: anyone in it can do this. If someone here already goes by the name, the
 * browser gets a 409 asking "same person?", and `group: true` folds the face into theirs.
 * `{ hidden: false }` instead unhides a face that was hidden.
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const { id, faceId } = await params;
  const d = await getLiveDumpster(id);
  if (!d) throw notFound();
  await requireGuest(d._id);
  const body = await req.json();
  // Unhide a face someone hid by mistake.
  if (body?.hidden === false) {
    await unhideFace(d._id, faceId);
    return NextResponse.json({ ok: true });
  }
  const { name, group } = Body.parse(body);
  return NextResponse.json(await nameFace(d, faceId, name, !!group));
});

/** Hide a face nobody has claimed (a stranger in the background): off the gallery and the shots, for everyone. */
export const DELETE = route<Ctx>(async (_req, { params }) => {
  const { id, faceId } = await params;
  const d = await getLiveDumpster(id);
  if (!d) throw notFound();
  await requireGuest(d._id);
  await hideFace(d._id, faceId);
  return NextResponse.json({ ok: true });
});
