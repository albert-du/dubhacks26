/**
 * Local UI testing: creates a dumpster full of sample shots with people, signs,
 * reactions, moments, a duplicate and a sticker, so every tab has something to show
 * without the vision services or a worker. Pair with DEV_BYPASS=true to skip sign-in.
 *
 *   npm run seed:demo
 */
import { nanoid } from "nanoid";
import sharp from "sharp";
import { createDumpster, dumpsterUrl } from "../lib/dumpsters";
import { normalizeImage, renderPublic, renderSticker } from "../lib/imaging";
import { closeMongo, cols } from "../lib/mongo";
import { emptyReactions, type ReactionCounts } from "../lib/reactions";
import { storage } from "../lib/storage";
import type { Box, Cluster, Media } from "../lib/types";

if (process.env.NODE_ENV === "production") {
  console.error("seed:demo is for local testing only.");
  process.exit(1);
}

const PALETTES = [
  ["#46a65a", "#2c6b3a", "#e3dece"], ["#ff5b1f", "#121212", "#f1eee4"], ["#3b6fd8", "#f2c14e", "#1d1d1d"],
  ["#8a5cf6", "#f1eee4", "#46a65a"], ["#d94f70", "#232323", "#f6d55c"], ["#2a9d8f", "#e9c46a", "#264653"],
  ["#e76f51", "#f4a261", "#2a9d8f"], ["#6d597a", "#b56576", "#eaac8b"], ["#118ab2", "#06d6a0", "#ffd166"],
  ["#264653", "#e9c46a", "#f4a261"], ["#9b2226", "#ee9b00", "#e9d8a6"], ["#005f73", "#94d2bd", "#ee9b00"],
];

/** A blocky "scene" with a face-ish circle where the face box is, so overlays line up. */
async function scene(i: number, w: number, h: number, label: string) {
  const [a, b, c] = PALETTES[i % PALETTES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="${c}"/>
    <rect x="${w * 0.55}" y="${h * 0.25}" width="${w * 0.33}" height="${h * 0.55}" fill="${b}"/>
    <circle cx="${w * 0.25}" cy="${h * 0.32}" r="${Math.min(w, h) * 0.12}" fill="${a}"/>
    <rect x="${w * 0.12}" y="${h * 0.45}" width="${w * 0.26}" height="${h * 0.45}" fill="${a}"/>
    <rect x="${w * 0.06}" y="${h * 0.84}" width="${w * 0.5}" height="${h * 0.1}" fill="#121212"/>
    <text x="${w * 0.08}" y="${h * 0.915}" font-family="Arial Black, Arial" font-size="${h * 0.06}" fill="#f1eee4">${label}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

/** Random unit vector: stand-in face embedding (distinct per person, so they don't merge). */
const vector = () => {
  const v = Array.from({ length: 512 }, () => Math.random() - 0.5);
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};

const SHOTS: { mins: number; gps?: [number, number]; portrait?: boolean; venue?: string; caption: string; people: number[]; sign?: string; fire: number }[] = [
  { mins: 0, gps: [47.4881, -121.7236], venue: "Mt. Si Trailhead", caption: "Boots on, bad decisions pending", people: [0, 1], sign: "MT SI TRAIL 4 MI", fire: 5 },
  { mins: 4, gps: [47.4882, -121.7235], caption: "Group photo, round one", people: [0, 1, 2], fire: 2 },
  { mins: 9, gps: [47.488, -121.7238], portrait: true, caption: "Somebody brought a dog", people: [2], fire: 7 },
  { mins: 70, gps: [47.496, -121.731], venue: "Snag Flats", caption: "Halfway, mostly vibes", people: [1], sign: "SNAG FLATS", fire: 0 },
  { mins: 74, gps: [47.4961, -121.7309], caption: "Snack break", people: [0, 3], fire: 1 },
  { mins: 79, portrait: true, caption: "Fog rolling in", people: [3], fire: 0 },
  { mins: 150, gps: [47.5001, -121.74], venue: "Haystack Summit", caption: "Summit or bust", people: [0, 1, 2, 3], sign: "SUMMIT 0.2 MI", fire: 3 },
  { mins: 155, gps: [47.5002, -121.7401], caption: "We made it", people: [2, 3], fire: 0 },
  { mins: 158, gps: [47.5002, -121.7402], caption: "Cold sandwiches at the top", people: [1], fire: 2 },
];

const FACE_BOXES: Box[] = [
  [0.14, 0.18, 0.36, 0.46],
  [0.58, 0.28, 0.74, 0.5],
  [0.4, 0.2, 0.54, 0.4],
  [0.76, 0.12, 0.92, 0.34],
];

async function main() {
  const d = await createDumpster({ name: "Mt. Si Hike (demo)", ttlHours: 72 });
  const { media, clusters, stickers } = await cols();
  const now = Date.now();
  const t0 = now - 4 * 3600_000;
  const people = ["Priya", "Sam", undefined, "Jo"].map((name, i) => ({ id: nanoid(10), name, centroid: vector(), i }));
  const counts = new Map<string, number>();
  const ids: string[] = [];

  for (let i = 0; i < SHOTS.length; i++) {
    const s = SHOTS[i];
    const [w, h] = s.portrait ? [900, 1600] : [1600, 1200];
    const original = await scene(i, w, h, s.sign ?? `SHOT ${i + 1}`);
    const { jpeg, width, height } = await normalizeImage(original);
    const id = nanoid(14);
    const publicKey = `${d._id}/public/${id}.webp`;
    await storage.put(`${d._id}/original/${id}.jpg`, original, "image/jpeg");
    await storage.put(publicKey, await renderPublic(jpeg), "image/webp");
    const reactions: ReactionCounts = { ...emptyReactions(), fire: s.fire, love: i % 4, lol: i % 3, cry: i === 2 ? 1 : 0 };
    const doc: Media = {
      _id: id,
      dumpsterId: d._id,
      kind: "image",
      mime: "image/jpeg",
      bytes: original.length,
      originalKey: `${d._id}/original/${id}.jpg`,
      publicKey,
      sha256: nanoid(),
      width,
      height,
      gps: s.gps ? { lat: s.gps[0], lng: s.gps[1] } : undefined,
      takenAt: new Date(t0 + s.mins * 60_000),
      status: "ready",
      attempts: 1,
      claimedAt: null,
      faces: s.people.map((p, k) => ({ box: FACE_BOXES[k % FACE_BOXES.length], clusterId: people[p].id })),
      text: s.sign ? [{ text: s.sign, box: [0.06, 0.84, 0.56, 0.94] as Box }] : [],
      objects: [
        { label: "person", box: [0.1, 0.15, 0.4, 0.92] as Box },
        { label: i === 2 ? "dog" : "backpack", box: [0.55, 0.25, 0.88, 0.8] as Box },
      ],
      caption: s.caption,
      tags: ["hike", i % 2 ? "trail" : "friends"],
      venue: s.venue,
      reactions,
      mentions: [],
      createdAt: new Date(now - (SHOTS.length - i) * 60_000),
      updatedAt: new Date(),
      expiresAt: d.expiresAt,
    };
    await media.insertOne(doc);
    ids.push(id);
    for (const p of s.people) counts.set(people[p].id, (counts.get(people[p].id) ?? 0) + 1);
  }

  // A re-upload of the first shot, flagged as a duplicate.
  const first = (await media.findOne({ _id: ids[0] }))!;
  const dupId = nanoid(14);
  await media.insertOne({ ...first, _id: dupId, duplicateOf: ids[0], createdAt: new Date(), updatedAt: new Date(), reactions: emptyReactions() });

  // Face groups, most named, one left for "+ name".
  const docs: Cluster[] = people.map((p) => {
    const cover = SHOTS.findIndex((s) => s.people.includes(p.i));
    return {
      _id: p.id,
      dumpsterId: d._id,
      centroid: p.centroid,
      exemplars: [p.centroid],
      n: counts.get(p.id) ?? 0,
      ...(p.name ? { name: p.name } : {}),
      cover: { mediaId: ids[cover], box: FACE_BOXES[SHOTS[cover].people.indexOf(p.i) % FACE_BOXES.length] },
      expiresAt: d.expiresAt,
      updatedAt: new Date(),
    };
  });
  await clusters.insertMany(docs);

  // One ready sticker in the Pack.
  const stickerBox: Box = [0.5, 0.2, 0.92, 0.84];
  const stickerId = `${ids[2]}-1`;
  const png = await renderSticker(await storage.get(`${d._id}/public/${ids[2]}.webp`), stickerBox);
  await storage.put(`${d._id}/public/sticker-${stickerId}.webp`, png, "image/webp");
  await stickers.insertOne({
    _id: stickerId,
    dumpsterId: d._id,
    mediaId: ids[2],
    label: "dog",
    box: stickerBox,
    publicKey: `${d._id}/public/sticker-${stickerId}.webp`,
    status: "ready",
    claimedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: d.expiresAt,
  });

  console.log(`\nDemo dumpster ready (${SHOTS.length + 1} shots, 4 faces, 1 sticker):\n\n  ${dumpsterUrl(d._id)}\n  ${dumpsterUrl(d._id)}/stage\n`);
  await closeMongo();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
