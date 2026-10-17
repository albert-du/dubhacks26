import { nanoid } from "nanoid";
import { publish } from "./backboard";
import { config } from "./config";
import { cosine } from "./faces";
import { faceEmbed } from "./faceEmbed";
import { HttpError } from "./http";
import { cols } from "./mongo";
import { normalizeImage } from "./imaging";
import { tiger } from "./tiger";
import type { Dumpster, Guest } from "./types";

/**
 * Guest opt-in: name + optional phone + 1-second selfie.
 * The selfie is embedded in memory and discarded — only the vector is stored, and it
 * expires with the Dumpster. It names your face in the gallery and powers "new photos of you" texts.
 */
export async function enrollGuest(
  d: Dumpster,
  viewerId: string,
  input: { name: string; phone?: string; selfie?: Buffer },
): Promise<{ guestId: string; faceMatched: boolean; clustersClaimed: number }> {
  const { guests, clusters } = await cols();

  let embedding: number[] | undefined;
  if (input.selfie) {
    if (!faceEmbed.enabled()) throw new HttpError(503, "Selfies aren’t working right now. Try again without one.");
    const { jpeg } = await normalizeImage(input.selfie);
    const faces = await faceEmbed.detect(jpeg);
    if (!faces.length) throw new HttpError(422, "Couldn't find a face. More light, closer to the camera.");
    const area = (b: number[]) => (b[2] - b[0]) * (b[3] - b[1]);
    embedding = faces.sort((a, b) => area(b.box) - area(a.box))[0].embedding;
  }

  const existing = await guests.findOne({ dumpsterId: d._id, viewerId });
  const guest: Guest = {
    _id: existing?._id ?? nanoid(12),
    dumpsterId: d._id,
    viewerId,
    name: input.name,
    phone: input.phone,
    embedding: embedding ?? existing?.embedding,
    pendingPhotoAlerts: existing?.pendingPhotoAlerts ?? 0,
    pendingMentionAlerts: existing?.pendingMentionAlerts ?? 0,
    lastAlertAt: existing?.lastAlertAt,
    createdAt: existing?.createdAt ?? new Date(),
    expiresAt: d.expiresAt,
  };
  await guests.replaceOne({ _id: guest._id }, guest, { upsert: true });
  await tiger.engagement(d._id, "enroll");

  if (!embedding) return { guestId: guest._id, faceMatched: false, clustersClaimed: 0 };

  // Claim every unclaimed cluster that looks like this guest.
  const candidates = await clusters
    .find({ dumpsterId: d._id, $or: [{ guestId: { $exists: false } }, { guestId: guest._id }] })
    .toArray();
  const matched = candidates.filter((c) => cosine(c.centroid, embedding!) >= config.faceMatchThreshold).map((c) => c._id);

  if (matched.length) {
    await clusters.updateMany({ _id: { $in: matched } }, { $set: { guestId: guest._id, updatedAt: new Date() } });
  } else {
    await clusters.insertOne({
      _id: nanoid(10),
      dumpsterId: d._id,
      centroid: embedding,
      n: 0,
      guestId: guest._id,
      expiresAt: d.expiresAt,
      updatedAt: new Date(),
    });
  }
  await publish(d._id, { type: "clusters" });
  return { guestId: guest._id, faceMatched: true, clustersClaimed: matched.length };
}
