import { NextResponse } from "next/server";
import { z } from "zod";
import { askDumpster } from "@/lib/ask";
import { backboard } from "@/lib/backboard";
import { getLiveDumpster } from "@/lib/dumpsters";
import { HttpError, notFound, route } from "@/lib/http";

const Body = z.object({
  q: z.string().trim().min(1, "Ask something").max(300),
});

type Ctx = { params: Promise<{ id: string }> };

/** Natural-language search over one dumpster. Word search in the dump still works without this. */
export const POST = route<Ctx>(async (req, { params }) => {
  if (!backboard.enabled()) throw new HttpError(503, "Ask isn't configured.");
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  const { q } = Body.parse(await req.json().catch(() => ({})));
  const result = await askDumpster(d, q);
  return NextResponse.json(result);
});
