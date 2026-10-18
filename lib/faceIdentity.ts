import { config } from "./config";
import { bestCover, mergeGroups, withExemplar } from "./faces";
import { HttpError } from "./http";
import { cols } from "./mongo";
import type { Cluster } from "./types";

/**
 * Collapses face groups that are the same person. Runs after new faces are clustered
 * and periodically from the worker, so drift and older duplicates get repaired too.
 * Names and sign-ins survive the merge; two different signed-in guests never merge.
 */
export async function mergeDumpsterFaces(dumpsterId: string): Promise<{ merged: number; remap: Map<string, string> }> {
  const { clusters, media } = await cols();
  const remap = new Map<string, string>();
  const list = await clusters.find({ dumpsterId }).toArray();
  if (list.length < 2) return { merged: 0, remap };

  // Older clusters have no exemplars yet: backfill a few angles from their stored faces.
  const missing = list.filter((c) => !c.exemplars?.length);
  if (missing.length) {
    const shots = await media
      .find({ dumpsterId, "faces.clusterId": { $in: missing.map((c) => c._id) } }, { projection: { faces: 1 } })
      .toArray();
    for (const c of missing) {
      let ex: number[][] = [];
      for (const s of shots) for (const f of s.faces) if (f.clusterId === c._id && f.embedding) ex = withExemplar(ex, f.embedding);
      c.exemplars = ex;
      if (ex.length) await clusters.updateOne({ _id: c._id }, { $set: { exemplars: ex } });
    }
  }

  let merged = 0;
  for (const group of mergeGroups(list, config.faceMergeThreshold)) {
    const keep = await mergeClusters(dumpsterId, group.map((i) => list[i]));
    for (const c of group.map((i) => list[i])) if (c._id !== keep) remap.set(c._id, keep);
    merged += group.length - 1;
  }
  return { merged, remap };
}

/**
 * Fold several face groups into one person: the signed-in one survives, else the named one,
 * else the biggest. Every shot's faces point at the survivor; the others are deleted.
 * Returns the survivor's id.
 */
export async function mergeClusters(dumpsterId: string, members: Cluster[]): Promise<string> {
  const { clusters, media } = await cols();
  // Keep the signed-in one, else the named one, else the biggest.
  members = [...members].sort(
    (a, b) =>
      Number(!!b.guestId) - Number(!!a.guestId) ||
      Number(!!a.hidden) - Number(!!b.hidden) ||
      Number(!!b.name) - Number(!!a.name) ||
      b.n - a.n,
  );
  const [keep, ...rest] = members;
  if (!rest.length) return keep._id;
  const n = members.reduce((s, c) => s + c.n, 0);
  const dim = keep.centroid.length;
  const sum = new Array(dim).fill(0);
  for (const c of members) for (let k = 0; k < dim; k++) sum[k] += c.centroid[k] * Math.max(1, c.n);
  const norm = Math.sqrt(sum.reduce((s, x) => s + x * x, 0)) || 1;
  let exemplars = keep.exemplars ?? [];
  for (const c of rest) for (const e of [c.centroid, ...(c.exemplars ?? [])]) exemplars = withExemplar(exemplars, e);
  const restIds = rest.map((c) => c._id);
  const cover = bestCover([keep.cover, ...rest.map((c) => c.cover)]);

  const update: Partial<Cluster> = {
    centroid: sum.map((x) => x / norm),
    exemplars,
    n,
    updatedAt: new Date(),
    ...(keep.name ? {} : rest.find((c) => c.name) ? { name: rest.find((c) => c.name)!.name } : {}),
    ...(keep.guestId ? {} : rest.find((c) => c.guestId) ? { guestId: rest.find((c) => c.guestId)!.guestId } : {}),
    ...(cover ? { cover } : {}),
  };
  // Hidden only if every part was: a real person never disappears by merging with a stranger.
  const hidden = members.every((c) => c.hidden);
  await clusters.updateOne({ _id: keep._id }, { $set: update, ...(keep.hidden && !hidden ? { $unset: { hidden: "" } } : {}) });
  await media.updateMany(
    { dumpsterId, "faces.clusterId": { $in: restIds } },
    { $set: { "faces.$[f].clusterId": keep._id, updatedAt: new Date() } },
    { arrayFilters: [{ "f.clusterId": { $in: restIds } }] },
  );
  await clusters.deleteMany({ _id: { $in: restIds } });
  // A stranger's boxes merged into a real person come back onto their shots.
  if (!hidden && members.some((c) => c.hidden)) await setFacesHidden(dumpsterId, keep._id, false);
  return keep._id;
}

/**
 * Hide a face nobody signed in has claimed: it leaves the gallery and every shot (its boxes are
 * marked hidden, not deleted), and new shots of the same face stay hidden. The group itself is
 * kept so it keeps matching, and so it can be unhidden.
 */
export async function hideFace(dumpsterId: string, faceId: string) {
  const { clusters, media } = await cols();
  const c = await clusters.findOne({ _id: faceId, dumpsterId }, { projection: { guestId: 1, name: 1 } });
  if (!c) throw new HttpError(404, "That face isn’t here anymore");
  if (c.guestId) throw new HttpError(409, `That’s ${c.name ?? "someone"}, who signed in. Only faces nobody has claimed can be hidden.`);
  const now = new Date();
  await clusters.updateOne({ _id: faceId }, { $set: { hidden: true, updatedAt: now }, $unset: { name: "" } });
  await setFacesHidden(dumpsterId, faceId, true);
}

/** Bring a hidden face back: to the gallery, and its boxes back onto every shot. */
export async function unhideFace(dumpsterId: string, faceId: string) {
  const { clusters } = await cols();
  const r = await clusters.updateOne({ _id: faceId, dumpsterId, hidden: true }, { $unset: { hidden: "" }, $set: { updatedAt: new Date() } });
  if (!r.matchedCount) throw new HttpError(404, "That face isn’t hidden anymore");
  await setFacesHidden(dumpsterId, faceId, false);
}

async function setFacesHidden(dumpsterId: string, clusterId: string, hidden: boolean) {
  const { media } = await cols();
  await media.updateMany(
    { dumpsterId, "faces.clusterId": clusterId },
    hidden
      ? { $set: { "faces.$[f].hidden": true, updatedAt: new Date() } }
      : { $unset: { "faces.$[f].hidden": "" }, $set: { updatedAt: new Date() } },
    { arrayFilters: [{ "f.clusterId": clusterId }] },
  );
}

/** Worker sweep: re-merge every live dumpster's faces. */
export async function mergeAllFaces() {
  const { dumpsters } = await cols();
  const live = await dumpsters.find({ expiresAt: { $gt: new Date() } }, { projection: { _id: 1 } }).toArray();
  let total = 0;
  for (const d of live) total += (await mergeDumpsterFaces(d._id)).merged;
  if (total) console.log(`[faces] merged ${total} duplicate face group(s)`);
  return total;
}
