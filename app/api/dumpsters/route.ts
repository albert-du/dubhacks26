import { NextResponse } from "next/server";
import { z } from "zod";
import { TTL_OPTIONS } from "@/lib/config";
import { createDumpster, roomUrl } from "@/lib/dumpsters";
import { HttpError, route } from "@/lib/http";
import { normalizePhone } from "@/lib/photon";

const Body = z.object({
  name: z.string().trim().min(1, "Name your Dumpster").max(60),
  ttlHours: z.coerce.number().refine((n): n is (typeof TTL_OPTIONS)[number] => (TTL_OPTIONS as readonly number[]).includes(n), {
    message: "Pick 24, 48, or 72 hours",
  }),
  hostPhone: z.string().trim().optional(),
  settings: z
    .object({
      blurNonConsented: z.boolean().optional(),
      redactSensitiveText: z.boolean().optional(),
      allowVideo: z.boolean().optional(),
    })
    .optional(),
});

export const POST = route(async (req) => {
  const body = Body.parse(await req.json());
  let hostPhone: string | undefined;
  if (body.hostPhone) {
    hostPhone = normalizePhone(body.hostPhone) ?? undefined;
    if (!hostPhone) throw new HttpError(400, "That phone number doesn't look right");
  }
  const { dumpster, hostToken } = await createDumpster({
    name: body.name,
    ttlHours: body.ttlHours as (typeof TTL_OPTIONS)[number],
    hostPhone,
    settings: body.settings,
  });
  return NextResponse.json({ id: dumpster._id, url: roomUrl(dumpster._id), hostToken }, { status: 201 });
});
