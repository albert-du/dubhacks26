import { NextResponse } from "next/server";
import { getLiveDumpster } from "@/lib/dumpsters";
import { matchSelfie } from "@/lib/enroll";
import { HttpError, notFound, route } from "@/lib/http";
import { viewerId } from "@/lib/viewer";

type Ctx = { params: Promise<{ id: string }> };

/**
 * First sign-in, before anything is saved: does this selfie look like someone already
 * signed in here, and which unclaimed faces in the pile look like you? The selfie is
 * analyzed in memory and not kept.
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  const selfieFile = (await req.formData()).get("selfie");
  if (!(selfieFile instanceof File) || !selfieFile.size) throw new HttpError(400, "Add a selfie so people can find your photos");
  if (selfieFile.size > 15 * 1024 * 1024) throw new HttpError(413, "That selfie is too large");
  const result = await matchSelfie(d, await viewerId(), Buffer.from(await selfieFile.arrayBuffer()));
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
