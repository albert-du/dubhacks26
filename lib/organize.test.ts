import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { findDuplicate, hamming, pixelHash } from "./dedupe";
import { groupMoments } from "./moments";
import { emptyReactions } from "./reactions";
import { matchSources } from "./search";
import type { PublicMedia } from "./types";

async function scene(seed: number) {
  // Photo-like: a few big random shapes, softened, so structure lives at low frequencies.
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) % 1000) / 1000;
  const shapes = Array.from({ length: 6 }, () => {
    const g = Math.round(rnd() * 255);
    return `<rect x="${rnd() * 400}" y="${rnd() * 300}" width="${80 + rnd() * 200}" height="${60 + rnd() * 150}" fill="rgb(${g},${g},${g})"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#777"/>${shapes}</svg>`;
  return sharp(Buffer.from(svg)).blur(3).png().toBuffer();
}

test("dedupe: re-encoded copies match, different photos don't", async () => {
  const a = await scene(1);
  const reencoded = await sharp(a).resize(240).jpeg({ quality: 60 }).toBuffer();
  const other = await scene(2);
  const [ha, hr, ho] = await Promise.all([pixelHash(a), pixelHash(reencoded), pixelHash(other)]);
  assert.ok(hamming(ha, hr) <= 4, `re-encode drifted ${hamming(ha, hr)} bits`);
  assert.ok(hamming(ha, ho) > 10);

  const t = new Date("2026-10-17T20:00:00Z");
  const orig = { _id: "orig", sha256: "aaa", phash: ha, takenAt: t };
  assert.equal(findDuplicate({ sha256: "zzz", phash: hr, takenAt: t }, [orig]), "orig");
  assert.equal(findDuplicate({ sha256: "aaa" }, [orig]), "orig"); // identical bytes (video)
  assert.equal(findDuplicate({ sha256: "zzz", phash: ho, takenAt: t }, [orig]), undefined);
  // Same pixels but captured 10 minutes apart = two real photos of a still scene.
  assert.equal(findDuplicate({ sha256: "zzz", phash: ha, takenAt: new Date(t.getTime() + 600_000) }, [orig]), undefined);
});

test("moments: split on time gaps and on distance", () => {
  const base = Date.parse("2026-10-17T20:00:00Z");
  const here = { lat: 47.5, lng: -121.7 };
  const far = { lat: 47.51, lng: -121.7 }; // ~1.1 km north
  const m = (id: string, mins: number, gps?: typeof here, venue?: string) => ({ id, t: base + mins * 60_000, gps, venue, tags: [] });
  const moments = groupMoments([
    m("a", 0, here, "Trailhead"),
    m("b", 5, here),
    m("c", 9), // no GPS: joins on time
    m("d", 12, far), // same time window, different place
    m("e", 60, far), // long gap
  ]);
  assert.deepEqual(
    moments.map((x) => x.ids),
    [["a", "b", "c"], ["d"], ["e"]],
  );
  assert.equal(moments[0].label, "Trailhead");
});

test("search: matches objects, written text and speech, AND across words", () => {
  const m = {
    id: "1",
    objects: [{ label: "dog", box: [0, 0, 1, 1] }],
    text: [{ text: "HAPPY BIRTHDAY SAM", box: [0, 0, 1, 1] }],
    transcript: "everybody say cheese",
    faces: [{ box: [0, 0, 1, 1], clusterId: "c1" }],
    mentions: [],
    tags: ["party"],
    caption: "Cake time",
    reactions: emptyReactions(),
  } as unknown as PublicMedia;
  const names = new Map([["c1", "Priya"]]);
  assert.deepEqual(matchSources(m, "dog", names), ["objects"]);
  assert.deepEqual(matchSources(m, "birthday", names), ["text"]);
  assert.deepEqual(matchSources(m, "cheese", names), ["speech"]);
  assert.deepEqual(matchSources(m, "priya", names), ["people"]);
  assert.deepEqual(matchSources(m, "dog cheese", names)?.sort(), ["objects", "speech"]);
  assert.equal(matchSources(m, "dog cat", names), null);
});
