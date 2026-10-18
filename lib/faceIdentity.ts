import { config } from "./config";
import { mergeGroups, withExemplar } from "./faces";
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
    const members = group.map((i) => list[i]);
    // Keep the signed-in one, else the named one, else the biggest.
    members.sort((a, b) => Number(!!b.guestId) - Number(!!a.guestId) || Number(!!b.name) - Number(!!a.name) || b.n - a.n);
    const [keep, ...rest] = members;
    const n = members.reduce((s, c) => s + c.n, 0);
    const dim = keep.centroid.length;
    const sum = new Array(dim).fill(0);
    for (const c of members) for (let k = 0; k < dim; k++) sum[k] += c.centroid[k] * Math.max(1, c.n);
    const norm = Math.sqrt(sum.reduce((s, x) => s + x * x, 0)) || 1;
    let exemplars = keep.exemplars ?? [];
    for (const c of rest) for (const e of [c.centroid, ...(c.exemplars ?? [])]) exemplars = withExemplar(exemplars, e);
    const restIds = rest.map((c) => c._id);

    const update: Partial<Cluster> = {
      centroid: sum.map((x) => x / norm),
      exemplars,
      n,
      updatedAt: new Date(),
      ...(keep.name ? {} : rest.find((c) => c.name) ? { name: rest.find((c) => c.name)!.name } : {}),
      ...(keep.guestId ? {} : rest.find((c) => c.guestId) ? { guestId: rest.find((c) => c.guestId)!.guestId } : {}),
      ...(keep.cover ? {} : rest.find((c) => c.cover) ? { cover: rest.find((c) => c.cover)!.cover } : {}),
    };
    await clusters.updateOne({ _id: keep._id }, { $set: update });
    await media.updateMany(
      { dumpsterId, "faces.clusterId": { $in: restIds } },
      { $set: { "faces.$[f].clusterId": keep._id, updatedAt: new Date() } },
      { arrayFilters: [{ "f.clusterId": { $in: restIds } }] },
    );
    await clusters.deleteMany({ _id: { $in: restIds } });
    for (const r of restIds) remap.set(r, keep._id);
    merged += rest.length;
  }
  return { merged, remap };
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
