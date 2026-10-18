import { config } from "./config";
import { dumpsterUrl } from "./dumpsters";
import { cols } from "./mongo";
import { maskPhone } from "./photon";
import { sendGuestNotification } from "./notifications";

type AlertCounts = { pendingPhotoAlerts?: number; pendingMentionAlerts?: number; alertBatchStartedAt?: Date };

/** True once a connected guest's open batch has been collecting for the full window. */
export function alertIsDue(guest: AlertCounts, now = Date.now()) {
  const pending = (guest.pendingPhotoAlerts ?? 0) > 0 || (guest.pendingMentionAlerts ?? 0) > 0;
  if (!pending) return false;
  // A batch queued before this field existed has already waited; send it.
  if (!guest.alertBatchStartedAt) return true;
  return now - guest.alertBatchStartedAt.getTime() >= config.alertDebounceMs;
}

/** Count one more photo or mention. The first one opens a two-minute batch; later ones join it. */
export async function queueGuestAlert(guestIds: string[], kind: "photo" | "mention") {
  if (!guestIds.length) return;
  const field = kind === "photo" ? "pendingPhotoAlerts" : "pendingMentionAlerts";
  const { guests } = await cols();
  await guests.updateMany({ _id: { $in: guestIds } }, [
    {
      $set: {
        [field]: { $add: [{ $ifNull: [`$${field}`, 0] }, 1] },
        alertBatchStartedAt: { $ifNull: ["$alertBatchStartedAt", "$$NOW"] },
      },
    },
  ]);
}

/** Sends one "N new shots of you" / "you were mentioned" text after the batch window. */
export async function flushFaceAlerts() {
  const { guests, dumpsters } = await cols();
  const now = Date.now();
  const cutoff = new Date(now - config.alertDebounceMs);
  const due = await guests
    .find({
      "notification.verifiedAt": { $exists: true },
      expiresAt: { $gt: new Date(now) },
      $and: [
        { $or: [{ pendingPhotoAlerts: { $gt: 0 } }, { pendingMentionAlerts: { $gt: 0 } }] },
        { $or: [{ alertBatchStartedAt: { $lte: cutoff } }, { alertBatchStartedAt: { $exists: false } }] },
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
    if (p > 0) lines.push(`📸 ${p} new shot${p === 1 ? "" : "s"} of you just dropped into the Dumpster "${d.name}"!`);
    if (mm > 0) lines.push(`🎙️ Your name was mentioned in ${mm === 1 ? "a new video" : `${mm} new videos`}.`);
    lines.push(url);
    try {
      const sent = await sendGuestNotification(g, lines.join("\n"),
        `alert:${g._id}:${g.notification.verifiedAt.getTime()}:${p}:${mm}:${g.lastAlertAt?.getTime() ?? 0}`);
      if (!sent) continue;
      // Subtract only the counts that were sent. Photos that landed during the send
      // stay pending and open a new two-minute batch.
      await guests.updateOne(
        {
          _id: g._id,
          "notification.verifiedAt": g.notification.verifiedAt,
          pendingPhotoAlerts: { $gte: p },
          pendingMentionAlerts: { $gte: mm },
        },
        [
          {
            $set: {
              pendingPhotoAlerts: { $subtract: ["$pendingPhotoAlerts", p] },
              pendingMentionAlerts: { $subtract: ["$pendingMentionAlerts", mm] },
              lastAlertAt: "$$NOW",
              alertBatchStartedAt: {
                $cond: [
                  {
                    $or: [
                      { $gt: [{ $subtract: ["$pendingPhotoAlerts", p] }, 0] },
                      { $gt: [{ $subtract: ["$pendingMentionAlerts", mm] }, 0] },
                    ],
                  },
                  "$$NOW",
                  "$$REMOVE",
                ],
              },
            },
          },
        ],
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
