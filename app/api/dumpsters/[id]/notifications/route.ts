import { NextResponse } from "next/server";
import { z } from "zod";
import { getLiveDumpster } from "@/lib/dumpsters";
import { notFound, route } from "@/lib/http";
import { disconnectNotifications, getNotificationStatus, requestNotificationConnection } from "@/lib/notifications";
import { viewerId } from "@/lib/viewer";

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ phone: z.string().trim().min(1).max(40) });
const privateHeaders = { "Cache-Control": "private, no-store" };

export const GET = route<Ctx>(async (_req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  return NextResponse.json(await getNotificationStatus(d, await viewerId()), { headers: privateHeaders });
});

export const POST = route<Ctx>(async (req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  const body = Body.parse(await req.json());
  return NextResponse.json(await requestNotificationConnection(d, await viewerId(), body.phone), { headers: privateHeaders });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  return NextResponse.json(await disconnectNotifications(d, await viewerId()), { headers: privateHeaders });
});
