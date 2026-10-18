import { MongoServerError } from "mongodb";
import { nanoid } from "nanoid";
import { config } from "./config";
import { identityScore } from "./faces";
import { faceEmbed } from "./faceEmbed";
import { HttpError } from "./http";
import { cols } from "./mongo";
import { normalizeImage } from "./imaging";
import { tiger } from "./tiger";
import type { Dumpster } from "./types";

/** Names are unique within a dumpster, ignoring case and spacing, so the name alone finds you again. */
export function nameKey(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

const taken = (name: string) =>
  new HttpError(409, `Someone already signed in as ${name}. If that's you, sign in with just your name. If not, add a last initial.`);

const isDuplicateName = (e: unknown) => e instanceof MongoServerError && e.code === 11000;

/**
 * The first sign-in to a dumpster: a name and a quick selfie. There are no accounts; the
 * sign-in lives on this dumpster only and burns with it. After this, the name alone gets
 * you back in from any browser (see signInByName).
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
  const key = nameKey(input.name);

  const existing = await guests.findOne({ dumpsterId: d._id, viewerIds: viewerId }, { projection: { _id: 1 } });
  const holder = await guests.findOne({ dumpsterId: d._id, nameKey: key }, { projection: { _id: 1 } });
  if (holder && holder._id !== existing?._id) throw taken(input.name);

  let embedding: number[] | undefined;
  if (faceEmbed.enabled()) {
    const { jpeg } = await normalizeImage(input.selfie);
    const faces = await faceEmbed.detect(jpeg).catch(() => null);
    if (faces && !faces.length) throw new HttpError(422, "Couldn't find a face. More light, closer to the camera.");
    const area = (b: number[]) => (b[2] - b[0]) * (b[3] - b[1]);
    embedding = faces?.sort((a, b) => area(b.box) - area(a.box))[0].embedding;
  }

  const guestId = existing?._id ?? nanoid(12);
  // Updating a sign-in must not overwrite a connection verified by a concurrent webhook.
  try {
    await guests.updateOne({ _id: guestId }, {
      $set: { dumpsterId: d._id, name: input.name, nameKey: key, ...(embedding ? { embedding } : {}) },
      $addToSet: { viewerIds: viewerId },
      $setOnInsert: { createdAt: new Date(), expiresAt: d.expiresAt, pendingPhotoAlerts: 0, pendingMentionAlerts: 0 },
    }, { upsert: true });
  } catch (e) {
    if (isDuplicateName(e)) throw taken(input.name);
    throw e;
  }
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

/**
 * Coming back: the name alone. "new" means nobody has that name here yet (take a selfie next).
 * "returning" asks the browser to confirm it's really them before `confirm` signs it in.
 */
export async function signInByName(
  d: Dumpster,
  viewerId: string,
  name: string,
  confirm: boolean,
): Promise<"new" | "returning" | "signed-in"> {
  const { guests } = await cols();
  const g = await guests.findOne({ dumpsterId: d._id, nameKey: nameKey(name) }, { projection: { _id: 1 } });
  if (!g) return "new";
  if (!confirm) return "returning";
  // One browser is one person in a dumpster.
  await guests.updateMany({ dumpsterId: d._id, viewerIds: viewerId, _id: { $ne: g._id } }, { $pull: { viewerIds: viewerId } });
  await guests.updateOne({ _id: g._id }, { $addToSet: { viewerIds: viewerId } });
  return "signed-in";
}

/** Rename yourself: your sign-in and every face that's yours. */
export async function renameGuest(d: Dumpster, viewerId: string, name: string) {
  const { guests, clusters } = await cols();
  const g = await guests.findOne({ dumpsterId: d._id, viewerIds: viewerId }, { projection: { _id: 1 } });
  if (!g) throw new HttpError(401, "Sign in to this dumpster first.");
  const holder = await guests.findOne({ dumpsterId: d._id, nameKey: nameKey(name) }, { projection: { _id: 1 } });
  if (holder && holder._id !== g._id) throw taken(name);
  try {
    await guests.updateOne({ _id: g._id }, { $set: { name, nameKey: nameKey(name) } });
  } catch (e) {
    if (isDuplicateName(e)) throw taken(name);
    throw e;
  }
  await clusters.updateMany({ dumpsterId: d._id, guestId: g._id }, { $set: { name, updatedAt: new Date() } });
}

/** Sign out: this browser forgets you. Your name still works to get back in until the dumpster burns. */
export async function signOutGuest(d: Dumpster, viewerId: string) {
  const { guests } = await cols();
  await guests.updateMany({ dumpsterId: d._id, viewerIds: viewerId }, { $pull: { viewerIds: viewerId } });
}

/** Forget me: delete the name, number and selfie vector everywhere, and release the faces. */
export async function forgetGuest(d: Dumpster, viewerId: string) {
  const { guests, clusters } = await cols();
  const g = await guests.findOne({ dumpsterId: d._id, viewerIds: viewerId }, { projection: { _id: 1 } });
  if (!g) return;
  await clusters.updateMany({ guestId: g._id }, { $unset: { guestId: "" }, $set: { updatedAt: new Date() } });
  await guests.deleteOne({ _id: g._id });
}
