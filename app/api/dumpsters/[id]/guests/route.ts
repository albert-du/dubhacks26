import { NextResponse } from "next/server";
import { getLiveDumpster } from "@/lib/dumpsters";
import { z } from "zod";
import { enrollGuest, forgetGuest, renameGuest, signInByName, signOutGuest } from "@/lib/enroll";
import { HttpError, notFound, route } from "@/lib/http";
import { viewerId } from "@/lib/viewer";

type Ctx = { params: Promise<{ id: string }> };

const Name = z.string().trim().min(1, "What should we call you?").max(40);

/**
 * Sign in to this dumpster.
 * JSON `{ name, confirm? }`: the name alone, for anyone who has signed in here before.
 * Form data `{ name, selfie, claim? }`: the first time (or a new selfie from Me). `claim` is a JSON
 * list of the matched faces they said are them (see /guests/match).
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();

  if (req.headers.get("content-type")?.includes("application/json")) {
    const { name, confirm } = z.object({ name: Name, confirm: z.boolean().optional() }).parse(await req.json());
    const status = await signInByName(d, await viewerId(), name, !!confirm);
    return NextResponse.json({ status });
  }

  const form = await req.formData();
  const name = Name.parse(String(form.get("name") ?? ""));
  const selfieFile = form.get("selfie");
  if (!(selfieFile instanceof File) || !selfieFile.size) throw new HttpError(400, "Add a selfie so people can find your photos");
  if (selfieFile.size > 15 * 1024 * 1024) throw new HttpError(413, "That selfie is too large");

  const claim = form.has("claim") ? z.array(z.string().max(40)).max(200).parse(JSON.parse(String(form.get("claim")))) : undefined;
  const result = await enrollGuest(d, await viewerId(), { name, selfie: Buffer.from(await selfieFile.arrayBuffer()), claim });
  return NextResponse.json(result);
});

/** Change the name you signed in with (and on your face). */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  const { name } = z.object({ name: Name }).parse(await req.json());
  await renameGuest(d, await viewerId(), name);
  return NextResponse.json({ ok: true, name });
});

/**
 * Sign out of this browser; the name still gets you back in.
 * `?forget=1` forgets the name, number and selfie vector for good, and releases the faces.
 */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  if (new URL(req.url).searchParams.get("forget") === "1") await forgetGuest(d, await viewerId());
  else await signOutGuest(d, await viewerId());
  return NextResponse.json({ ok: true });
});
