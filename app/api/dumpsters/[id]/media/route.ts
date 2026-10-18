import exifr from "exifr";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { sha256 } from "@/lib/dedupe";
import { getLiveDumpster } from "@/lib/dumpsters";
import { requireGuest } from "@/lib/guestAuth";
import { HttpError, notFound, route } from "@/lib/http";
import { cols } from "@/lib/mongo";
import { emptyReactions } from "@/lib/reactions";
import { storage } from "@/lib/storage";
import { tiger } from "@/lib/tiger";
import type { Media } from "@/lib/types";
import { classifyUpload } from "@/lib/uploadKind";

type Ctx = { params: Promise<{ id: string }> };

const num = (v: FormDataEntryValue | null) => (typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

/**
 * Drop a photo/video. Anonymous: nothing about the uploader is recorded.
 * The original is stored privately; the worker publishes a metadata-stripped render.
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  await requireGuest(d._id);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file");
  const classified = classifyUpload(file.type, file.name);
  if (!classified) throw new HttpError(415, "Photos and videos only");
  const { ext, mime, kind } = classified;
  if (kind === "video" && !d.settings.allowVideo) throw new HttpError(403, "This Dumpster is photos only");
  if (file.size > config.maxUploadBytes) throw new HttpError(413, "Too big — 150MB max");

  const buf = Buffer.from(await file.arrayBuffer());

  // The client extracts GPS before it compresses; fall back to the server reading EXIF.
  let lat = num(form.get("lat"));
  let lng = num(form.get("lng"));
  let takenAt = num(form.get("takenAt"));
  if (kind === "image" && (lat === undefined || lng === undefined)) {
    try {
      const gps = await exifr.gps(buf);
      if (gps) ({ latitude: lat, longitude: lng } = gps);
    } catch {}
  }
  if (kind === "image" && takenAt === undefined) {
    try {
      const meta = await exifr.parse(buf, ["DateTimeOriginal"]);
      if (meta?.DateTimeOriginal instanceof Date) takenAt = meta.DateTimeOriginal.getTime();
    } catch {}
  }

  const id = nanoid(14);
  const originalKey = `${d._id}/original/${id}.${ext}`;
  await storage.put(originalKey, buf, mime);

  const now = new Date();
  const doc: Media = {
    _id: id,
    dumpsterId: d._id,
    kind,
    mime,
    bytes: file.size,
    originalKey,
    sha256: sha256(buf),
    gps: lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : undefined,
    takenAt: takenAt ? new Date(takenAt) : undefined,
    status: "pending",
    attempts: 0,
    claimedAt: null,
    faces: [],
    text: [],
    objects: [],
    tags: [],
    reactions: emptyReactions(),
    mentions: [],
    createdAt: now,
    updatedAt: now,
    expiresAt: d.expiresAt,
  };
  const { media } = await cols();
  await media.insertOne(doc);
  await tiger.upload(d._id, kind, file.size);

  return NextResponse.json({ id, status: "pending" }, { status: 202 });
});
