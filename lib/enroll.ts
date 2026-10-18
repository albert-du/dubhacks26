import { MongoServerError } from "mongodb";
import { nanoid } from "nanoid";
import { config } from "./config";
import { cosine, identityScore } from "./faces";
import { faceEmbed } from "./ai-face-embed";
import { HttpError } from "./http";
import { cols } from "./mongo";
import { normalizeImage } from "./imaging";
import { tiger } from "./tiger";
import type { Dumpster, Guest } from "./types";

/** Names are unique within a dumpster, ignoring case and spacing, so the name alone finds you again. */
export function nameKey(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

const taken = (name: string) =>
  new HttpError(409, `Someone already signed in as ${name}. If that's you, sign in with just your name. If not, add a last initial.`);

const isDuplicateName = (e: unknown) => e instanceof MongoServerError && e.code === 11000;

/** The biggest face in a selfie, embedded in memory. Undefined when face matching is off or down. */
async function embedSelfie(selfie: Buffer): Promise<number[] | undefined> {
  if (!faceEmbed.enabled()) return undefined;
  const { jpeg } = await normalizeImage(selfie);
  const faces = await faceEmbed.detect(jpeg).catch(() => null);
  if (faces && !faces.length) throw new HttpError(422, "Couldn't find a face. More light, closer to the camera.");
  const area = (b: number[]) => (b[2] - b[0]) * (b[3] - b[1]);
  return faces?.sort((a, b) => area(b.box) - area(a.box))[0].embedding;
}

/**
 * Before a first sign-in is saved: who does this selfie look like?
 * `guest` is someone already signed in here with this face (ask "is that you?").
 * `faceIds` are unclaimed faces in the pile that look like you (offer to claim them).
 * The selfie is not kept; the browser sends it again to sign in.
 */
export async function matchSelfie(
  d: Dumpster,
  viewerId: string,
  selfie: Buffer,
): Promise<{ guest?: { name: string }; faceIds: string[] }> {
  const embedding = await embedSelfie(selfie);
  if (!embedding) return { faceIds: [] };
  const { guests, clusters } = await cols();
  const self = await guests.findOne({ dumpsterId: d._id, viewerIds: viewerId }, { projection: { _id: 1 } });
  const threshold = config.faceMatchThreshold;

  const hits = (await clusters.find({ dumpsterId: d._id }).toArray())
    .map((c) => ({ c, score: identityScore(c, embedding) }))
    .filter((h) => h.score >= threshold);

  // The closest other guest, by a face they've claimed or by their own selfie.
  const scores = new Map<string, number>();
  for (const { c, score } of hits) {
    if (c.guestId && c.guestId !== self?._id) scores.set(c.guestId, Math.max(scores.get(c.guestId) ?? 0, score));
  }
  const enrolled = await guests
    .find({ dumpsterId: d._id, embedding: { $exists: true }, ...(self ? { _id: { $ne: self._id } } : {}) }, { projection: { embedding: 1 } })
    .toArray();
  for (const g of enrolled) {
    const score = cosine(g.embedding!, embedding);
    if (score >= threshold) scores.set(g._id, Math.max(scores.get(g._id) ?? 0, score));
  }
  const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  const guest = best ? await guests.findOne({ _id: best[0] }, { projection: { name: 1 } }) : null;

  return {
    ...(guest ? { guest: { name: guest.name } } : {}),
    faceIds: hits.filter((h) => !h.c.guestId).sort((a, b) => b.score - a.score).map((h) => h.c._id),
  };
}

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
  /** `claim`: the matched faces they said are them. Left out (a new selfie from Me), every match is claimed. */
  input: { name: string; selfie: Buffer; claim?: string[] },
): Promise<{ guestId: string; faceMatched: boolean; clustersClaimed: number }> {
  const { guests, clusters } = await cols();
  const key = nameKey(input.name);

  const existing = await guests.findOne({ dumpsterId: d._id, viewerIds: viewerId }, { projection: { _id: 1 } });
  const holder = await guests.findOne({ dumpsterId: d._id, nameKey: key }, { projection: { _id: 1 } });
  if (holder && holder._id !== existing?._id) throw taken(input.name);

  const embedding = await embedSelfie(input.selfie);

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

  // Claim the unclaimed faces that look like you (the ones you picked), and name them.
  const candidates = await clusters
    .find({ dumpsterId: d._id, $or: [{ guestId: { $exists: false } }, { guestId }] })
    .toArray();
  const picked = input.claim && new Set(input.claim);
  const matched = candidates
    .filter((c) => identityScore(c, embedding!) >= config.faceMatchThreshold)
    .filter((c) => c.guestId === guestId || !picked || picked.has(c._id))
    .map((c) => c._id);

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

/**
 * "That's me": a signed-in guest takes faces nobody has claimed yet. The faces get their
 * name, and new shots of those faces count as theirs (photos of you, texts).
 */
export async function claimFaces(d: Dumpster, guest: Pick<Guest, "_id" | "name">, faceIds: string[]) {
  if (!faceIds.length) return 0;
  const { clusters } = await cols();
  const r = await clusters.updateMany(
    { _id: { $in: faceIds }, dumpsterId: d._id, $or: [{ guestId: { $exists: false } }, { guestId: guest._id }] },
    { $set: { guestId: guest._id, name: guest.name, updatedAt: new Date() } },
  );
  return r.matchedCount;
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
