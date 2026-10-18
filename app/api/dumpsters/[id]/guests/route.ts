import { NextResponse } from "next/server";
import { getLiveDumpster } from "@/lib/dumpsters";
import { enrollGuest } from "@/lib/enroll";
import { HttpError, notFound, route } from "@/lib/http";
import { viewerId } from "@/lib/viewer";

type Ctx = { params: Promise<{ id: string }> };

/** Guest opt-in: name and optional selfie. Messaging connects separately after verification. */
export const POST = route<Ctx>(async (req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  const form = await req.formData();

  if (form.get("consent") !== "yes") throw new HttpError(400, "Consent is required to enroll");
  const name = String(form.get("name") ?? "").trim().slice(0, 40);
  if (!name) throw new HttpError(400, "What should we call you?");

  const selfieFile = form.get("selfie");
  const selfie = selfieFile instanceof File && selfieFile.size ? Buffer.from(await selfieFile.arrayBuffer()) : undefined;
  if (selfie && selfie.length > 10 * 1024 * 1024) throw new HttpError(413, "Selfie too large");

  const result = await enrollGuest(d, await viewerId(), { name, selfie });
  return NextResponse.json(result);
});
