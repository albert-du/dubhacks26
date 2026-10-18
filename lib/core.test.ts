import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { parseCommand } from "./commands";
import { bestIdentity, cosine, identityScore, mergeGroups, nearest, updateCentroid, withExemplar } from "./faces";
import { parseVision, visionContent } from "./perceptron";
import { emptyReactions, fireRank } from "./reactions";
import { isDumpsterId, DUMPSTER_ID_ALPHABET, DUMPSTER_ID_LENGTH } from "./dumpsters";
import { normalizeImage } from "./imaging";
import { findMentions } from "./transcribe";
import { crc32, zipStream } from "./zip";

test("photon: parses create commands with smart quotes and TTL", () => {
  assert.deepEqual(parseCommand("Create dumpster “Mt. Si Hike” 48h"), { type: "create", name: "Mt. Si Hike", ttlHours: 48 });
  assert.deepEqual(parseCommand("new dumpster Bar Crawl 72 hours"), { type: "create", name: "Bar Crawl", ttlHours: 72 });
  assert.deepEqual(parseCommand("create dumpster 'Wedding'"), { type: "create", name: "Wedding", ttlHours: 24 });
  // Unsupported TTLs clamp to the 24h default rather than extending retention.
  assert.equal((parseCommand('create dumpster "X" 999h') as { ttlHours: number }).ttlHours, 24);
  assert.equal(parseCommand("help").type, "help");
  assert.equal(parseCommand("lol").type, "unknown");
});

test("dumpsters: ids are high-entropy and strictly validated", () => {
  const bits = DUMPSTER_ID_LENGTH * Math.log2(DUMPSTER_ID_ALPHABET.length);
  assert.ok(bits >= 122, `only ${bits} bits`);
  assert.ok(isDumpsterId("a".repeat(DUMPSTER_ID_LENGTH)));
  assert.ok(!isDumpsterId("mt-si-hike-7s9kz"));
  assert.ok(!isDumpsterId("../../etc/passwd"));
});

test("imaging: public renders carry no EXIF/GPS metadata", async () => {
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#46a65a" } })
    .withMetadata({ exif: { IFD0: { Copyright: "secret" } } })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(jpeg).metadata()).exif);
  const out = await normalizeImage(jpeg);
  assert.equal((await sharp(out.jpeg).metadata()).exif, undefined);
  assert.deepEqual([out.width, out.height], [64, 48]);
});

test("faces: clustering math", () => {
  const a = [1, 0, 0];
  const b = [0.9, 0.1, 0];
  const c = [0, 1, 0];
  assert.ok(cosine(a, b) > 0.9);
  assert.equal(nearest([a, c], b, 0.5), 0);
  assert.equal(nearest([c], a, 0.5), -1);
  const m = updateCentroid(a, 1, c);
  assert.ok(Math.abs(Math.hypot(...m) - 1) < 1e-9);
});

test("perceptron: parses point_box markup on a 0-1000 grid", () => {
  const v = parseVision(`{"caption":"cake hits floor","tags":["cake"],"venue":null}
    <point_box mention="face" asset_idx="0"> (100,200) (300,400) </point_box>
    <point_box mention='text:MAIN STAGE'> (0,0) (500,100) </point_box>
    <point_box mention="object:Cake"> (400,400) (600,600) </point_box>
    <point_box mention="object:corner"> (0,0) (1,2) </point_box>
    <point_box mention="object:edge" asset_idx="0"> (0,0) (1000,10) </point_box>
    <point_box mention="object:bad"> (5,5) (1,1) </point_box>
    <point_box mention="object:off"> (0,0) (1001,10) </point_box>
    <point_box mention="object:other" asset_idx="1"> (10,10) (20,20) </point_box>
    <point_box mention="text:a>b sign"> (10,10) (40,30) </point_box>
    <point_box mention="object:<noun>"> (10,10) (40,30) </point_box>
    <point_box mention="text:<exact text>"> (10,10) (40,30) </point_box>`);
  assert.ok(!v.objects.some((o) => o.label.includes("<")), "template placeholder leaked into objects");
  assert.ok(!v.text.some((t) => t.text.startsWith("<")), "template placeholder leaked into text");
  assert.equal(v.caption, "cake hits floor");
  assert.equal(v.venue, undefined);
  assert.deepEqual(v.faces[0].box, [0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(v.text.map((t) => t.text), ["MAIN STAGE", "a>b sign"]);
  assert.deepEqual(v.objects.map((o) => o.label), ["cake", "corner", "edge"]);
  assert.deepEqual(v.objects[1].box, [0, 0, 0.001, 0.002]);
  assert.deepEqual(v.objects[2].box, [0, 0, 1, 0.01]);
});

test("perceptron: falls back to JSON boxes when the answer has no point_box tags", () => {
  const v = parseVision(`Sure! {"caption":"cake hits floor","tags":["cake"],"venue":"null",
    "faces":[{"box":[100,200,300,400]}],"text":[{"text":" MAIN STAGE ","box":[0,0,500,100]}],
    "objects":[{"label":"Cake","box":[400,400,600,600]},{"label":"bad","box":[5,5,1,1]}]}`);
  assert.equal(v.caption, "cake hits floor");
  assert.equal(v.venue, undefined);
  assert.deepEqual(v.faces[0].box, [0.1, 0.2, 0.3, 0.4]);
  assert.equal(v.text[0].text, "MAIN STAGE");
  assert.deepEqual(v.objects.map((o) => o.label), ["cake"]);
});

test("perceptron: uses only a completed answer, not reasoning", () => {
  const content = visionContent({
    choices: [{ finish_reason: "stop", message: { content: '{"caption":"ok","tags":[]}', reasoning_content: "hidden" } }],
  });
  assert.equal(parseVision(content).caption, "ok");
  assert.throws(() => visionContent({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }), /length/);
  assert.throws(() => visionContent({ choices: [{ finish_reason: "stop", message: { content: "{}", tool_calls: [{}] } }] }), /tool_calls/);
});

test("transcripts: whole-word first-name mentions", () => {
  assert.deepEqual(findMentions("Yo Sam, get in the photo! Samantha too", ["Sam Lee", "Priya", "Al"]), ["Sam Lee"]);
  assert.deepEqual(findMentions("totally normal", ["Al"]), []);
});

test("reactions: Dumpster Fire rank uses only fire, then other reactions, then age", () => {
  const r = (fire: number, love = 0) => ({ ...emptyReactions(), fire, love });
  const items = [
    { id: "none", reactions: r(0, 50), createdAt: "2026-01-01T00:00:05Z" },
    { id: "two-old", reactions: r(2), createdAt: "2026-01-01T00:00:01Z" },
    { id: "two-new", reactions: r(2), createdAt: "2026-01-01T00:00:02Z" },
    { id: "two-loved", reactions: r(2, 3), createdAt: "2026-01-01T00:00:03Z" },
    { id: "five", reactions: r(5), createdAt: "2026-01-01T00:00:04Z" },
  ];
  // Lots of non-fire reactions never get you on the board.
  assert.deepEqual(
    fireRank(items).map((m) => m.id),
    ["five", "two-loved", "two-old", "two-new"],
  );
});

test("zip: a streamed STORE archive has valid structure and CRCs", async () => {
  const files = { "a.txt": Buffer.from("hello"), "b.bin": Buffer.from([0, 1, 2, 3, 255]) };
  const stream = zipStream(Object.entries(files).map(([name, data]) => ({ name, date: new Date(2026, 9, 17), read: async () => data })));
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) chunks.push(r.value);
  const zip = Buffer.concat(chunks);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const eocd = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50);
  assert.equal(zip.readUInt16LE(eocd + 10), 2);
  assert.equal(crc32(Buffer.from("hello")), 0x3610a686);
  // central directory points at each local header
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < 2; n++) {
    assert.equal(zip.readUInt32LE(p), 0x02014b50);
    assert.equal(zip.readUInt32LE(zip.readUInt32LE(p + 42)), 0x04034b50);
    p += 46 + zip.readUInt16LE(p + 28);
  }
});

test("faces: one person seen from different angles stays one identity", () => {
  // Unit vectors at known angles: cos = similarity.
  const at = (deg: number) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), 0];
  const frontal = { centroid: at(0), exemplars: [at(0), at(50)] }; // has a profile exemplar
  // 60° off the centroid (cos 0.5) but 10° off the profile exemplar.
  assert.ok(identityScore(frontal, at(60)) > 0.95);
  assert.equal(bestIdentity([{ centroid: at(90) }, frontal], at(60), 0.42), 1);
  assert.equal(withExemplar([at(0)], at(5)).length, 1); // same angle: not added
  assert.equal(withExemplar([at(0)], at(60)).length, 2); // new angle: added

  // Two groups of the same person merge; a stranger and a different guest don't.
  const groups = mergeGroups(
    [
      { centroid: [...at(0), 0], exemplars: [[...at(40), 0]] },
      { centroid: [...at(55), 0] }, // same person, other angle
      { centroid: [0, 0, 0, 1] }, // stranger
      { centroid: [0, 0, 1, 0], guestId: "g1" }, // two signed-in guests who look
      { centroid: [0, 0, 0.99, 0.14], guestId: "g2" }, // almost identical
    ],
    0.42,
  );
  const groupOf = (i: number) => groups.find((g) => g.includes(i));
  assert.ok(groupOf(0) && groupOf(0) === groupOf(1), "same person from two angles stayed split");
  assert.equal(groupOf(2), undefined, "stranger merged");
  assert.ok(!groups.some((g) => g.includes(3) && g.includes(4)), "two different signed-in guests merged");
});
