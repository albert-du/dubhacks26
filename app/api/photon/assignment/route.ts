import { NextResponse } from "next/server";
import { z } from "zod";
import { config } from "@/lib/config";
import { HttpError, route } from "@/lib/http";
import { imessageAvailable } from "@/lib/notifications";
import { normalizePhone, photon } from "@/lib/photon";

const Body = z.object({ phone: z.string().trim().min(1).max(40) });

/** Register a new demo participant or reuse their existing assignment. */
export const POST = route(async (req: Request) => {
  const body = Body.parse(await req.json());
  const phone = normalizePhone(body.phone);
  if (!phone) throw new HttpError(400, "Enter your phone number, including its country code.");
  if (!imessageAvailable()) throw new HttpError(503, "Starting a Dumpster by iMessage isn’t available right now.");
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin && origin !== new URL(config.appUrl).origin) {
    throw new HttpError(403, "Open the homepage to register your number.");
  }
  const agentNumber = await photon.ensureImessageAssignment(phone);
  return NextResponse.json({ agentNumber }, { headers: { "Cache-Control": "private, no-store" } });
});
