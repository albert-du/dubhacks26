import { config } from "./config";
import { dumpsterUrl } from "./dumpsters";
import { cols } from "./mongo";
import { maskPhone, photon } from "./photon";

/** Sends batched "N new photos of you" / "you were mentioned" texts. Debounced per guest. */
export async function flushFaceAlerts() {
  const { guests, dumpsters } = await cols();
  const cutoff = new Date(Date.now() - config.alertDebounceMs);
  const due = await guests
    .find({
      phone: { $exists: true },
      $and: [
        { $or: [{ pendingPhotoAlerts: { $gt: 0 } }, { pendingMentionAlerts: { $gt: 0 } }] },
        { $or: [{ lastAlertAt: { $exists: false } }, { lastAlertAt: { $lt: cutoff } }] },
      ],
    })
    .limit(50)
    .toArray();

  for (const g of due) {
    const d = await dumpsters.findOne({ _id: g.dumpsterId });
    if (!d || d.expiresAt.getTime() <= Date.now() || !g.phone) continue;
    const p = g.pendingPhotoAlerts;
    const mm = g.pendingMentionAlerts;
    const url = `${dumpsterUrl(d._id)}?me=1`;
    const lines: string[] = [];
    if (p > 0) lines.push(`📸 ${p} new photo${p === 1 ? "" : "s"} of you just dropped into the Dumpster "${d.name}"!`);
    if (mm > 0) lines.push(`🎙️ Your name was mentioned in ${mm === 1 ? "a new video" : `${mm} new videos`}.`);
    lines.push(url);
    try {
      await photon.send(g.phone, lines.join("\n"));
      await guests.updateOne(
        { _id: g._id },
        { $inc: { pendingPhotoAlerts: -p, pendingMentionAlerts: -mm }, $set: { lastAlertAt: new Date() } },
      );
    } catch (e) {
      console.warn(`[alerts] ${maskPhone(g.phone)}:`, (e as Error).message);
    }
  }
}

/** One "burning soon" digest per Dumpster, to every guest who left a phone number. */
export async function sendExpiryWarnings() {
  const { dumpsters, guests, media } = await cols();
  const now = Date.now();
  const soon = await dumpsters
    .find({ expiresAt: { $gt: new Date(now), $lte: new Date(now + config.warnBeforeMs) }, warningSent: { $ne: true } })
    .toArray();

  for (const d of soon) {
    // Mark first so a crash mid-send can't double-text everyone.
    const claimed = await dumpsters.updateOne({ _id: d._id, warningSent: { $ne: true } }, { $set: { warningSent: true } });
    if (!claimed.modifiedCount) continue;

    const count = await media.countDocuments({ dumpsterId: d._id, status: "ready" });
    const top = await media.find({ dumpsterId: d._id, status: "ready" }).sort({ "reactions.fire": -1 }).limit(1).next();
    const fires = top?.reactions?.fire ?? 0;
    const mins = Math.max(1, Math.round((d.expiresAt.getTime() - now) / 60_000));
    const left = mins >= 90 ? `${Math.round(mins / 60)}h` : `${mins} min`;
    const text = [
      `🔥 "${d.name}" burns in ${left}.`,
      `${count} photo${count === 1 ? "" : "s"} & videos inside${fires ? ` — the top Dumpster Fire has ${fires} 🔥` : ""}.`,
      `Save what you want before it's gone: ${dumpsterUrl(d._id)}`,
    ].join("\n");

    const phones = new Set<string>();
    for (const g of await guests.find({ dumpsterId: d._id, phone: { $exists: true } }).toArray()) if (g.phone) phones.add(g.phone);
    await Promise.allSettled([...phones].map((p) => photon.send(p, text)));
  }
}
