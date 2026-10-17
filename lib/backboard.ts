import { config } from "./config";

/**
 * Backboard realtime fan-out. The worker and API publish room events here so stage
 * displays and galleries update instantly. Browsers always have the SSE fallback
 * (/api/dumpsters/[id]/stream), so this stays fire-and-forget.
 * VERIFY the publish endpoint against Backboard's docs.
 */
export type RoomEvent =
  | { type: "media"; mediaId: string }
  | { type: "sticker"; stickerId: string }
  | { type: "clusters" }
  | { type: "destroyed" };

export async function publish(dumpsterId: string, event: RoomEvent) {
  if (!config.backboard.url) return;
  try {
    await fetch(`${config.backboard.url}/channels/dumpster-${dumpsterId}/events`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.backboard.apiKey ?? ""}` },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(3_000),
    });
  } catch (e) {
    console.warn("[backboard]", (e as Error).message);
  }
}
