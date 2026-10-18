import { nanoid } from "nanoid";
import { config } from "./config";
import { cols } from "./mongo";
import type { Dumpster } from "./types";

/**
 * Local UI testing only (DEV_BYPASS=true, never in production builds): sign this browser
 * in as "Dev" so the name + selfie gate doesn't block looking at the app.
 */
export async function ensureDevGuest(d: Dumpster, viewerId: string) {
  if (!config.devBypass) return;
  const { guests } = await cols();
  await guests.updateOne(
    { dumpsterId: d._id, viewerId },
    {
      $setOnInsert: {
        _id: nanoid(12),
        dumpsterId: d._id,
        viewerId,
        name: "Dev",
        pendingPhotoAlerts: 0,
        pendingMentionAlerts: 0,
        createdAt: new Date(),
        expiresAt: d.expiresAt,
      },
    },
    { upsert: true },
  );
}
