import { nanoid } from "nanoid";
import { publish } from "./backboard";
import { config } from "./config";
import { cosine, nearest, updateCentroid } from "./faces";
import { faceEmbed } from "./faceEmbed";
import { cols } from "./mongo";
import { perceptron, type VisionResult } from "./perceptron";
import { normalizeImage, renderPublic, renderSticker } from "./imaging";
import { storage } from "./storage";
import { findMentions, transcriber } from "./transcribe";
import type { Cluster, Dumpster, FaceHit, Media, TextHit } from "./types";

/*
 * Media pipeline, run by the Vultr worker (worker/index.ts):
 *   original → normalize (orient, resize, strip EXIF) → public WebP
 *   → Perceptron + face-embed in parallel → cluster faces → notify.
 * Analysis is enrichment only: if a vision service is down the photo still publishes.
 */

const STALE_CLAIM_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

async function liveDumpster(id: string) {
  const { dumpsters } = await cols();
  const d = await dumpsters.findOne({ _id: id });
  return d && d.expiresAt.getTime() > Date.now() ? d : null;
}

/** Claims and processes one queued media item. Returns false when the queue is empty. */
export async function processNextMedia(): Promise<boolean> {
  const { media } = await cols();
  const m = await media.findOneAndUpdate(
    {
      status: "pending",
      $or: [{ claimedAt: null }, { claimedAt: { $lt: new Date(Date.now() - STALE_CLAIM_MS) } }],
    },
    { $set: { claimedAt: new Date() }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  );
  if (!m) return false;

  const d = await liveDumpster(m.dumpsterId);
  if (!d) return true; // expired: the cleanup loop will delete it

  try {
    if (m.kind === "video") await processVideo(m, d);
    else await processImage(m, d);
  } catch (e) {
    const failed = m.attempts >= MAX_ATTEMPTS;
    console.error(`[pipeline] ${m._id} attempt ${m.attempts}${failed ? " — giving up" : ""}:`, (e as Error).message);
    await media.updateOne(
      { _id: m._id },
      { $set: { claimedAt: null, updatedAt: new Date(), ...(failed ? { status: "failed" as const } : {}) } },
    );
    if (failed) await storage.delete(m.originalKey).catch(() => {});
  }
  return true;
}

async function processImage(m: Media, d: Dumpster) {
  const { media, guests, clusters } = await cols();
  const { jpeg, width, height } = await normalizeImage(await storage.get(m.originalKey));

  const [v, e] = await Promise.allSettled([
    perceptron.enabled() ? perceptron.analyze(jpeg) : Promise.reject(new Error("perceptron not configured")),
    faceEmbed.enabled() ? faceEmbed.detect(jpeg) : Promise.reject(new Error("face-embed not configured")),
  ]);
  if (v.status === "rejected" && perceptron.enabled()) console.warn("[perceptron]", (v.reason as Error).message);
  if (e.status === "rejected" && faceEmbed.enabled()) console.warn("[face-embed]", (e.reason as Error).message);
  const vision: VisionResult | null = v.status === "fulfilled" ? v.value : null;
  const embedded = e.status === "fulfilled" ? e.value : null;

  const faces: FaceHit[] = embedded
    ? embedded.map((f) => ({ box: f.box, embedding: f.embedding }))
    : (vision?.faces ?? []).map((f) => ({ box: f.box }));
  const text: TextHit[] = (vision?.text ?? []).map((t) => ({ text: t.text, box: t.box }));
  await assignClusters(d, m._id, faces);

  const publicKey = `${d._id}/public/${m._id}.webp`;
  await storage.put(publicKey, await renderPublic(jpeg), "image/webp");

  await media.updateOne(
    { _id: m._id },
    {
      $set: {
        status: "ready",
        claimedAt: null,
        publicKey,
        width,
        height,
        faces,
        text,
        updatedAt: new Date(),
        ...(vision
          ? {
              caption: vision.caption,
              tags: vision.tags,
              venue: vision.venue,
              subjects: vision.subjects,
            }
          : {}),
      },
    },
  );

  // Text guests who enrolled and appear in this photo.
  const clusterIds = [...new Set(faces.map((f) => f.clusterId).filter(Boolean))] as string[];
  if (clusterIds.length) {
    const claimed = await clusters
      .find({ _id: { $in: clusterIds }, guestId: { $exists: true } }, { projection: { guestId: 1 } })
      .toArray();
    const guestIds = [...new Set(claimed.map((c) => c.guestId!))];
    if (guestIds.length) await guests.updateMany({ _id: { $in: guestIds } }, { $inc: { pendingPhotoAlerts: 1 } });
    await publish(d._id, { type: "clusters" });
  }
  await publish(d._id, { type: "media", mediaId: m._id });
}

/** Online clustering: each face joins the nearest cluster above threshold, or starts a new one. */
async function assignClusters(d: Dumpster, mediaId: string, faces: FaceHit[]) {
  const pending = faces.filter((f) => f.embedding && !f.clusterId);
  if (!pending.length) return;
  const { clusters, guests } = await cols();
  const list = await clusters.find({ dumpsterId: d._id }).toArray();
  const enrolled = await guests.find({ dumpsterId: d._id, embedding: { $exists: true } }).toArray();

  for (const f of pending) {
    const emb = f.embedding!;
    const i = nearest(
      list.map((c) => c.centroid),
      emb,
      config.faceMatchThreshold,
    );
    if (i >= 0) {
      const c = list[i];
      c.centroid = updateCentroid(c.centroid, c.n, emb);
      const cover = c.cover ?? { mediaId, box: f.box };
      await clusters.updateOne({ _id: c._id }, { $set: { centroid: c.centroid, cover, updatedAt: new Date() }, $inc: { n: 1 } });
      c.n += 1;
      c.cover = cover;
      f.clusterId = c._id;
      continue;
    }
    // New face: does it belong to an enrolled guest whose selfie we already hold?
    const guest = enrolled.find((g) => cosine(g.embedding!, emb) >= config.faceMatchThreshold);
    const c: Cluster = {
      _id: nanoid(10),
      dumpsterId: d._id,
      centroid: emb,
      n: 1,
      cover: { mediaId, box: f.box },
      expiresAt: d.expiresAt,
      updatedAt: new Date(),
      ...(guest ? { guestId: guest._id } : {}),
    };
    await clusters.insertOne(c);
    list.push(c);
    f.clusterId = c._id;
  }
}

async function processVideo(m: Media, d: Dumpster) {
  const { media, guests } = await cols();
  const buf = await storage.get(m.originalKey);
  const ext = m.originalKey.split(".").pop() ?? "mp4";

  let transcript: string | undefined;
  let mentions: string[] = [];
  if (transcriber.enabled()) {
    try {
      transcript = await transcriber.transcribe(buf, `${m._id}.${ext}`, m.mime);
    } catch (e) {
      console.warn("[transcribe]", (e as Error).message);
    }
  }
  if (transcript) {
    const roster = await guests.find({ dumpsterId: d._id }, { projection: { name: 1 } }).toArray();
    mentions = findMentions(
      transcript,
      roster.map((g) => g.name),
    );
    const ids = roster.filter((g) => mentions.includes(g.name)).map((g) => g._id);
    if (ids.length) await guests.updateMany({ _id: { $in: ids } }, { $inc: { pendingMentionAlerts: 1 } });
  }

  const publicKey = `${d._id}/public/${m._id}.${ext}`;
  await storage.put(publicKey, buf, m.mime);
  await media.updateOne(
    { _id: m._id },
    {
      $set: { status: "ready", claimedAt: null, publicKey, transcript, mentions, updatedAt: new Date() },
    },
  );
  await publish(d._id, { type: "media", mediaId: m._id });
}

/** Renders one queued sticker from the public image. */
export async function processNextSticker(): Promise<boolean> {
  const { stickers, media } = await cols();
  const s = await stickers.findOneAndUpdate(
    { status: "pending", $or: [{ claimedAt: null }, { claimedAt: { $lt: new Date(Date.now() - STALE_CLAIM_MS) } }] },
    { $set: { claimedAt: new Date() } },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  );
  if (!s) return false;
  try {
    const m = await media.findOne({ _id: s.mediaId, status: "ready" });
    if (!m?.publicKey || m.kind !== "image") throw new Error("source not ready");
    const png = await renderSticker(await storage.get(m.publicKey), s.box);
    const publicKey = `${s.dumpsterId}/public/sticker-${s._id}.webp`;
    await storage.put(publicKey, png, "image/webp");
    await stickers.updateOne({ _id: s._id }, { $set: { status: "ready", publicKey, claimedAt: null, updatedAt: new Date() } });
  } catch (e) {
    console.error("[sticker]", (e as Error).message);
    await stickers.updateOne({ _id: s._id }, { $set: { status: "failed", claimedAt: null, updatedAt: new Date() } });
  }
  await publish(s.dumpsterId, { type: "sticker", stickerId: s._id });
  return true;
}
