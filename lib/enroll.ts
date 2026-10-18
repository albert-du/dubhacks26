import { nanoid } from "nanoid";
import { config } from "./config";
import { identityScore } from "./faces";
import { faceEmbed } from "./faceEmbed";
import { HttpError } from "./http";
import { cols } from "./mongo";
import { normalizeImage } from "./imaging";
import { tiger } from "./tiger";
import type { Dumpster } from "./types";

/**
 * Sign in to one dumpster: a name and a quick selfie. There are no accounts; the sign-in
 * lives on this browser's cookie for this dumpster only and burns with it.
 * The selfie is embedded in memory and discarded — only the vector is kept. It finds your
 * face in the gallery and names it, and powers "new photos of you" texts. If face matching
 * is down, you still get in; your face gets matched next time you update your selfie.
 * The phone number is optional and connects separately, verified by iMessage.
 */
export async function enrollGuest(
  d: Dumpster,
  viewerId: string,
  input: { name: string; selfie: Buffer },
): Promise<{ guestId: string; faceMatched: boolean; clustersClaimed: number }> {
  const { guests, clusters } = await cols();

  let embedding: number[] | undefined;
  if (faceEmbed.enabled()) {
    const { jpeg } = await normalizeImage(input.selfie);
    const faces = await faceEmbed.detect(jpeg).catch(() => null);
    if (faces && !faces.length) throw new HttpError(422, "Couldn't find a face. More light, closer to the camera.");
    const area = (b: number[]) => (b[2] - b[0]) * (b[3] - b[1]);
    embedding = faces?.sort((a, b) => area(b.box) - area(a.box))[0].embedding;
  }

  const existing = await guests.findOne({ dumpsterId: d._id, viewerId });
  const guestId = existing?._id ?? nanoid(12);
  // Updating a sign-in must not overwrite a connection verified by a concurrent webhook.
  await guests.updateOne({ _id: guestId }, {
    $set: { dumpsterId: d._id, viewerId, name: input.name, ...(embedding ? { embedding } : {}) },
    $setOnInsert: { createdAt: new Date(), expiresAt: d.expiresAt, pendingPhotoAlerts: 0, pendingMentionAlerts: 0 },
  }, { upsert: true });
  await tiger.engagement(d._id, "enroll");

  // Your name goes on any face that's already yours.
  await clusters.updateMany({ dumpsterId: d._id, guestId }, { $set: { name: input.name, updatedAt: new Date() } });
  if (!embedding) return { guestId, faceMatched: false, clustersClaimed: 0 };

  // Claim every unclaimed face that looks like you, and name it.
  const candidates = await clusters
    .find({ dumpsterId: d._id, $or: [{ guestId: { $exists: false } }, { guestId }] })
    .toArray();
  const matched = candidates.filter((c) => identityScore(c, embedding!) >= config.faceMatchThreshold).map((c) => c._id);

  if (matched.length) {
    await clusters.updateMany({ _id: { $in: matched } }, { $set: { guestId, name: input.name, updatedAt: new Date() } });
  } else if (!(await clusters.findOne({ dumpsterId: d._id, guestId }, { projection: { _id: 1 } }))) {
    await clusters.insertOne({
      _id: nanoid(10),
      dumpsterId: d._id,
      centroid: embedding,
      exemplars: [embedding],
      n: 0,
      guestId,
      name: input.name,
      expiresAt: d.expiresAt,
      updatedAt: new Date(),
    });
  }
  return { guestId, faceMatched: true, clustersClaimed: matched.length };
}

/** Rename yourself: your sign-in and every face that's yours. */
export async function renameGuest(d: Dumpster, viewerId: string, name: string) {
  const { guests, clusters } = await cols();
  const g = await guests.findOne({ dumpsterId: d._id, viewerId }, { projection: { _id: 1 } });
  if (!g) throw new HttpError(401, "Sign in to this dumpster first.");
  await guests.updateOne({ _id: g._id }, { $set: { name } });
  await clusters.updateMany({ dumpsterId: d._id, guestId: g._id }, { $set: { name, updatedAt: new Date() } });
}
