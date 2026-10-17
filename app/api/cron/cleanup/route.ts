import { NextResponse } from "next/server";
import { flushFaceAlerts, sendExpiryWarnings } from "@/lib/alerts";
import { purgeExpired } from "@/lib/cleanup";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Alternative to the worker's timers for hosts with a cron (e.g. Vercel Cron). */
export async function GET(req: Request) {
  if (!config.cronSecret || req.headers.get("authorization") !== `Bearer ${config.cronSecret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  await sendExpiryWarnings();
  await flushFaceAlerts();
  const purged = await purgeExpired();
  return NextResponse.json({ purged });
}
