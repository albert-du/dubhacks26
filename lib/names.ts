import { findMentions } from "./ai-transcribe";
import { mergeClusters } from "./faceIdentity";
import { HttpError } from "./http";
import { cols } from "./mongo";
import type { Dumpster } from "./types";

/** Names are unique within a dumpster, ignoring case and spacing, so the name alone finds you again. */
export function nameKey(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Who already goes by this name here: a signed-in guest, and any faces named it.
 * `except` leaves out the person being named (their own sign-in and faces).
 */
export async function nameHolders(d: Dumpster, name: string, except: { guestId?: string; faceIds?: string[] } = {}) {
  const key = nameKey(name);
  const { guests, clusters } = await cols();
  const guest = await guests.findOne(
    { dumpsterId: d._id, nameKey: key, ...(except.guestId ? { _id: { $ne: except.guestId } } : {}) },
    { projection: { _id: 1, name: 1 } },
  );
  // Full records: grouping merges their vectors. Only ids and the name ever reach a browser.
  const faces = (await clusters.find({ dumpsterId: d._id, name: { $exists: true } }).toArray())
    .filter((c) => nameKey(c.name!) === key)
    .filter((c) => !except.faceIds?.includes(c._id) && !(except.guestId && c.guestId === except.guestId));
  return { guest, faces, name: guest?.name ?? faces[0]?.name ?? name };
}

/**
 * 409 with what the browser needs to ask "same person?": the existing spelling of the name,
 * the faces already called that, and whether someone signed in with it.
 */
export function sameNameError(holders: Awaited<ReturnType<typeof nameHolders>>, message: string) {
  return new HttpError(409, message, {
    sameName: { name: holders.name, faceIds: holders.faces.map((c) => c._id), signedIn: !!holders.guest },
  });
}

/**
 * Name (or rename, or un-name with "") a face. No two people share a name: if someone here
 * already goes by it, this throws a "same person?" 409, and `group` folds the face into theirs
 * (under their spelling and their sign-in). Video mentions follow the new name.
 */
export async function nameFace(d: Dumpster, faceId: string, input: string, group: boolean) {
  const { clusters, media } = await cols();
  const face = await clusters.findOne({ _id: faceId, dumpsterId: d._id });
  if (!face) throw new HttpError(404, "That face isn’t here anymore");
  const now = new Date();
  let name = input;
  let keep = faceId;

  const holders = name ? await nameHolders(d, name, { guestId: face.guestId, faceIds: [faceId] }) : null;
  if (holders && (holders.guest || holders.faces.length)) {
    const otherGuest = holders.guest?._id ?? holders.faces.find((c) => c.guestId)?.guestId;
    if (face.guestId && otherGuest && otherGuest !== face.guestId) {
      throw new HttpError(409, `${holders.name} is someone else who signed in here. Pick a different name.`);
    }
    if (!group) throw sameNameError(holders, `There’s already a ${holders.name} here. Same person?`);
    // Same person: one face group, under their name and sign-in.
    const theirs = holders.guest ? await clusters.find({ dumpsterId: d._id, guestId: holders.guest._id }).toArray() : [];
    const members = [face, ...holders.faces, ...theirs.filter((c) => !holders.faces.some((f) => f._id === c._id))];
    keep = await mergeClusters(d._id, members);
    name = holders.name;
    await clusters.updateOne({ _id: keep }, { $set: { name, updatedAt: now, ...(holders.guest ? { guestId: holders.guest._id } : {}) } });
  } else {
    await clusters.updateOne({ _id: faceId }, name ? { $set: { name, updatedAt: now } } : { $unset: { name: "" }, $set: { updatedAt: now } });
  }

  // Keep video mentions in step with face names.
  const videos = await media
    .find({ dumpsterId: d._id, kind: "video", status: "ready", transcript: { $exists: true } }, { projection: { transcript: 1, mentions: 1 } })
    .toArray();
  for (const v of videos) {
    const next = new Set((v.mentions ?? []).filter((n) => n !== face.name));
    if (name && findMentions(v.transcript ?? "", [name]).length) next.add(name);
    const changed = next.size !== (v.mentions ?? []).length || [...next].some((n) => !(v.mentions ?? []).includes(n));
    if (changed) await media.updateOne({ _id: v._id }, { $set: { mentions: [...next], updatedAt: now } });
  }
  return { id: keep, name: name || undefined };
}
