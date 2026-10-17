import { NextResponse } from "next/server";
import { purgeDumpster } from "@/lib/cleanup";
import { getLiveDumpster, isHost } from "@/lib/dumpsters";
import { HttpError, notFound, route } from "@/lib/http";
import { roomState } from "@/lib/serialize";
import { viewerId } from "@/lib/viewer";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export const GET = route<Ctx>(async (_req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  return NextResponse.json(await roomState(d, await viewerId()));
});

/** Host "burn it now" — immediate hard delete. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  if (!isHost(d, req.headers.get("x-host-token"))) throw new HttpError(403, "Only the host can burn this Dumpster");
  return NextResponse.json(await purgeDumpster(d._id, "host"));
});
