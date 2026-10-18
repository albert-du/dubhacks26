/**
 * Dump background worker — runs on a Vultr instance next to the AI services.
 *   - media pipeline (Perceptron + face-embed + redaction), N concurrent lanes
 *   - sticker rendering
 *   - Photon face/mention alerts (batched) and expiry digests
 *   - ephemeral cleanup: purge expired Dumpsters + orphaned blobs
 *
 *   npm run worker
 */
import { flushFaceAlerts, sendExpiryWarnings } from "../lib/alerts";
import { purgeExpired } from "../lib/cleanup";
import { mergeAllFaces } from "../lib/faceIdentity";
import { closeMongo } from "../lib/mongo";
import { processNextMedia, processNextSticker } from "../lib/pipeline";

const MEDIA_LANES = Number(process.env.WORKER_MEDIA_LANES ?? 3);
let running = true;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Drains a queue as fast as it can, then idles. */
async function drain(name: string, next: () => Promise<boolean>, idleMs: number) {
  while (running) {
    try {
      if (!(await next())) await sleep(idleMs);
    } catch (e) {
      console.error(`[${name}]`, (e as Error).message);
      await sleep(idleMs * 3);
    }
  }
}

async function every(name: string, fn: () => Promise<unknown>, ms: number) {
  while (running) {
    try {
      await fn();
    } catch (e) {
      console.error(`[${name}]`, (e as Error).message);
    }
    await sleep(ms);
  }
}

async function main() {
  console.log(`[worker] up — ${MEDIA_LANES} media lanes`);
  await Promise.all([
    ...Array.from({ length: MEDIA_LANES }, (_, i) => drain(`media-${i}`, processNextMedia, 1000)),
    drain("stickers", processNextSticker, 1500),
    every("alerts", flushFaceAlerts, 15_000),
    every("warnings", sendExpiryWarnings, 60_000),
    every("cleanup", purgeExpired, 60_000),
    every("faces", mergeAllFaces, 120_000),
  ]);
  await closeMongo();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[worker] ${sig}, finishing current jobs…`);
    running = false;
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
