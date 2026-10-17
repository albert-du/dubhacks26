import { NextResponse } from "next/server";
import { getLiveDumpster } from "@/lib/dumpsters";
import { notFound, route } from "@/lib/http";
import { roomState } from "@/lib/serialize";
import { viewerId } from "@/lib/viewer";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export const GET = route<Ctx>(async (_req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  return NextResponse.json(await roomState(d, await viewerId()));
});
