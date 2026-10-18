import { config } from "./config";
import { dumpsterUrl } from "./dumpsters";
import { cols } from "./mongo";
import { maskPhone } from "./photon";
import { sendGuestNotification } from "./notifications";

/** Sends batched "N new photos of you" / "you were mentioned" texts. Debounced per guest. */
export async function flushFaceAlerts() {
  const { guests, dumpsters } = await cols();
  const cutoff = new Date(Date.now() - config.alertDebounceMs);
  const due = await guests
    .find({
      "notification.verifiedAt": { $exists: true },
      expiresAt: { $gt: new Date() },
      $and: [
        { $or: [{ pendingPhotoAlerts: { $gt: 0 } }, { pendingMentionAlerts: { $gt: 0 } }] },
        { $or: [{ lastAlertAt: { $exists: false } }, { lastAlertAt: { $lt: cutoff } }] },
      ],
    })
    .limit(50)
    .toArray();

  for (const g of due) {
    const d = await dumpsters.findOne({ _id: g.dumpsterId });
    if (!d || d.expiresAt.getTime() <= Date.now() || !g.notification) continue;
    const p = g.pendingPhotoAlerts;
    const mm = g.pendingMentionAlerts;
    const url = `${dumpsterUrl(d._id)}?me=1`;
    const lines: string[] = [];
    if (p > 0) lines.push(`📸 ${p} new photo${p === 1 ? "" : "s"} of you just dropped into the Dumpster "${d.name}"!`);
    if (mm > 0) lines.push(`🎙️ Your name was mentioned in ${mm === 1 ? "a new video" : `${mm} new videos`}.`);
    lines.push(url);
    try {
      const sent = await sendGuestNotification(g, lines.join("\n"),
        `alert:${g._id}:${g.notification.verifiedAt.getTime()}:${p}:${mm}:${g.lastAlertAt?.getTime() ?? 0}`);
      if (!sent) continue;
      await guests.updateOne(
        { _id: g._id, "notification.verifiedAt": g.notification.verifiedAt },
        { $inc: { pendingPhotoAlerts: -p, pendingMentionAlerts: -mm }, $set: { lastAlertAt: new Date() } },
      );
    } catch {
      console.warn(`[alerts] ${maskPhone(g.phone ?? "")}: notification send failed`);
    }
  }
}

/** One accepted "burning soon" digest per verified guest. Failed requests retry on the next loop. */
export async function sendExpiryWarnings() {
  const { dumpsters, guests, media } = await cols();
  const now = Date.now();
  const soon = await dumpsters
    .find({ expiresAt: { $gt: new Date(now), $lte: new Date(now + config.warnBeforeMs) } })
    .toArray();

  for (const d of soon) {
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

    const due = await guests.find({
      dumpsterId: d._id,
      "notification.verifiedAt": { $exists: true },
      expiresAt: { $gt: new Date(now) },
      expiryWarningSentAt: { $exists: false },
    }).toArray();
    for (const g of due) {
      if (!g.notification) continue;
      try {
        // Persist the first payload so a retry uses the same body and idempotency key,
        // even if the countdown, media count, or Dumpster name changes meanwhile.
        const queued = await guests.findOneAndUpdate({
          _id: g._id, "notification.verifiedAt": g.notification.verifiedAt,
          expiryWarningSentAt: { $exists: false }, expiryWarningText: { $exists: false },
        }, { $set: { expiryWarningText: text } }, { returnDocument: "after" });
        const current = queued ?? await guests.findOne({
          _id: g._id, "notification.verifiedAt": g.notification.verifiedAt, expiryWarningSentAt: { $exists: false },
        });
        if (!current?.expiryWarningText) continue;
        const sent = await sendGuestNotification(current, current.expiryWarningText, `warn:${d._id}:${g._id}:${g.notification.verifiedAt.getTime()}`);
        if (sent) await guests.updateOne({ _id: g._id, "notification.verifiedAt": g.notification.verifiedAt }, {
          $set: { expiryWarningSentAt: new Date() },
          $unset: { expiryWarningText: "" },
        });
      } catch {
        console.warn(`[alerts] ${maskPhone(g.phone ?? "")}: expiry notification send failed`);
      }
    }
  }
}
