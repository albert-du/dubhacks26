import { NextResponse } from "next/server";
import { getLiveDumpster } from "@/lib/dumpsters";
import { HttpError, notFound, route } from "@/lib/http";
import { searchByPhoto } from "@/lib/photoSearch";

type Ctx = { params: Promise<{ id: string }> };

/** Search with a photo (multipart "image"). The photo is analyzed in memory and never stored. */
export const POST = route<Ctx>(async (req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  const file = (await req.formData()).get("image");
  if (!(file instanceof File) || !file.size) throw new HttpError(400, "Take or pick a photo to search with");
  if (file.size > 15 * 1024 * 1024) throw new HttpError(413, "That photo is too large");
  return NextResponse.json(await searchByPhoto(d, Buffer.from(await file.arrayBuffer())));
});
