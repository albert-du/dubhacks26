import { publish } from "./backboard";
import { cols } from "./mongo";
import { storage } from "./storage";
import { tiger } from "./tiger";

/**
 * Hard delete of everything an event produced: blobs (originals, public renders, stickers),
 * media docs, face clusters + centroids, guest selfie vectors and phones, reactions, the room itself.
 */
export async function purgeDumpster(id: string, reason: "expired" | "host" | "orphan") {
  const c = await cols();
  const objects = await storage.deletePrefix(id);
  const [mediaRes, clusterRes, guestRes] = await Promise.all([
    c.media.deleteMany({ dumpsterId: id }),
    c.clusters.deleteMany({ dumpsterId: id }),
    c.guests.deleteMany({ dumpsterId: id }),
    c.stickers.deleteMany({ dumpsterId: id }),
    c.reactions.deleteMany({ dumpsterId: id }),
  ]);
  await c.dumpsters.deleteOne({ _id: id });
  const counts = {
    media: mediaRes.deletedCount,
    vectors: clusterRes.deletedCount + guestRes.deletedCount,
    objects,
  };
  await tiger.cleanupDone(id, counts, reason);
  await publish(id, { type: "destroyed" });
  console.log(`[cleanup] purged ${id} (${reason})`, counts);
  return counts;
}

/** Purges every expired Dumpster, then sweeps storage for prefixes with no live room. */
export async function purgeExpired() {
  const { dumpsters } = await cols();
  const expired = await dumpsters.find({ expiresAt: { $lte: new Date() } }, { projection: { _id: 1 } }).toArray();
  for (const d of expired) await purgeDumpster(d._id, "expired");

  const prefixes = await storage.listPrefixes();
  if (prefixes.length) {
    const live = new Set(
      (await dumpsters.find({ _id: { $in: prefixes } }, { projection: { _id: 1 } }).toArray()).map((d) => d._id),
    );
    for (const p of prefixes) if (!live.has(p)) await purgeDumpster(p, "orphan");
  }
  return expired.length;
}
