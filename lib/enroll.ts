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
 * Text sign-up: a 1-second selfie. The selfie is embedded in memory and discarded —
 * only the vector is stored, and it expires with the Dumpster. It's how we know which face
 * is yours, so we can text you when you show up (or when your face's name is said in a video).
 * The phone number is attached separately, by the verified iMessage connection.
 */
export async function enrollGuest(
  d: Dumpster,
  viewerId: string,
  input: { selfie: Buffer },
): Promise<{ guestId: string; faceMatched: boolean; clustersClaimed: number }> {
  const { guests, clusters } = await cols();

  if (!faceEmbed.enabled()) throw new HttpError(503, "Selfies aren’t working right now. Try again in a bit.");
  const { jpeg } = await normalizeImage(input.selfie);
  const faces = await faceEmbed.detect(jpeg);
  if (!faces.length) throw new HttpError(422, "Couldn't find a face. More light, closer to the camera.");
  const area = (b: number[]) => (b[2] - b[0]) * (b[3] - b[1]);
  const embedding = faces.sort((a, b) => area(b.box) - area(a.box))[0].embedding;

  const existing = await guests.findOne({ dumpsterId: d._id, viewerId });
  const guestId = existing?._id ?? nanoid(12);
  // Updating a sign-up must not overwrite a connection verified by a concurrent webhook.
  await guests.updateOne({ _id: guestId }, {
    $set: { dumpsterId: d._id, viewerId, embedding },
    $setOnInsert: { createdAt: new Date(), expiresAt: d.expiresAt, pendingPhotoAlerts: 0, pendingMentionAlerts: 0 },
  }, { upsert: true });
  await tiger.engagement(d._id, "enroll");

  // Claim every unclaimed cluster that looks like this guest.
  const candidates = await clusters
    .find({ dumpsterId: d._id, $or: [{ guestId: { $exists: false } }, { guestId }] })
    .toArray();
  const matched = candidates.filter((c) => identityScore(c, embedding) >= config.faceMatchThreshold).map((c) => c._id);

  if (matched.length) {
    await clusters.updateMany({ _id: { $in: matched } }, { $set: { guestId, updatedAt: new Date() } });
  } else {
    await clusters.insertOne({
      _id: nanoid(10),
      dumpsterId: d._id,
      centroid: embedding,
      n: 0,
      guestId,
      expiresAt: d.expiresAt,
      updatedAt: new Date(),
    });
  }
  return { guestId, faceMatched: true, clustersClaimed: matched.length };
}
