import { NextResponse } from "next/server";
import { z } from "zod";
import { TTL_OPTIONS } from "@/lib/config";
import { createDumpster, roomUrl } from "@/lib/dumpsters";
import { route } from "@/lib/http";

const Body = z.object({
  name: z.string().trim().min(1, "Name your Dumpster").max(60),
  ttlHours: z.coerce.number().refine((n): n is (typeof TTL_OPTIONS)[number] => (TTL_OPTIONS as readonly number[]).includes(n), {
    message: "Pick 24, 48, or 72 hours",
  }),
  settings: z.object({ allowVideo: z.boolean().optional() }).optional(),
});

/** Creates a room. Nothing about the creator is recorded — there is no owner. */
export const POST = route(async (req) => {
  const body = Body.parse(await req.json());
  const dumpster = await createDumpster({
    name: body.name,
    ttlHours: body.ttlHours as (typeof TTL_OPTIONS)[number],
    settings: body.settings,
  });
  return NextResponse.json({ id: dumpster._id, url: roomUrl(dumpster._id) }, { status: 201 });
});
