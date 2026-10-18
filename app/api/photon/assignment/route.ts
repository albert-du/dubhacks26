import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, route } from "@/lib/http";
import { imessageAvailable } from "@/lib/notifications";
import { normalizePhone, photon } from "@/lib/photon";

const Body = z.object({ phone: z.string().trim().min(1).max(40) });

/** Return only the assigned service number for the submitted demo participant. Never allocate a slot. */
export const POST = route(async (req: Request) => {
  const body = Body.parse(await req.json());
  const phone = normalizePhone(body.phone);
  if (!phone) throw new HttpError(400, "Enter your phone number, including its country code.");
  if (!imessageAvailable()) throw new HttpError(503, "Starting a Dumpster by iMessage isn’t available right now.");
  const agentNumber = await photon.imessageAssignment(phone);
  if (!agentNumber) throw new HttpError(422, "This number isn’t registered for the demo yet. Ask the demo team to add it, or join a Dumpster with its link or QR code.");
  return NextResponse.json({ agentNumber }, { headers: { "Cache-Control": "private, no-store" } });
});
