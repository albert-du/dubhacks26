import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { parseCommand } from "./commands";
import { cosine, nearest, updateCentroid } from "./faces";
import { parseVision } from "./perceptron";
import { isRoomId, ROOM_ID_ALPHABET, ROOM_ID_LENGTH } from "./dumpsters";
import { normalizeImage } from "./imaging";
import { findMentions } from "./transcribe";

test("photon: parses create commands with smart quotes and TTL", () => {
  assert.deepEqual(parseCommand("Create dumpster “Mt. Si Hike” 48h"), { type: "create", name: "Mt. Si Hike", ttlHours: 48 });
  assert.deepEqual(parseCommand("new dumpster Bar Crawl 72 hours"), { type: "create", name: "Bar Crawl", ttlHours: 72 });
  assert.deepEqual(parseCommand("create dumpster 'Wedding'"), { type: "create", name: "Wedding", ttlHours: 24 });
  // Unsupported TTLs clamp to the 24h default rather than extending retention.
  assert.equal((parseCommand('create dumpster "X" 999h') as { ttlHours: number }).ttlHours, 24);
  assert.equal(parseCommand("help").type, "help");
  assert.equal(parseCommand("lol").type, "unknown");
});

test("rooms: ids are high-entropy and strictly validated", () => {
  const bits = ROOM_ID_LENGTH * Math.log2(ROOM_ID_ALPHABET.length);
  assert.ok(bits >= 122, `only ${bits} bits`);
  assert.ok(isRoomId("a".repeat(ROOM_ID_LENGTH)));
  assert.ok(!isRoomId("mt-si-hike-7s9kz"));
  assert.ok(!isRoomId("../../etc/passwd"));
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

test("perceptron: parses grounded JSON and normalizes 0-1000 boxes", () => {
  const v = parseVision(`Sure! {"caption":"cake hits floor","tags":["cake"],"venue":"null","candid_score":91,
    "faces":[{"box":[100,200,300,400]}],"text":[{"text":"7ABC123","box":[0,0,500,100],"sensitive":"license_plate"}],
    "subjects":[{"label":"cake","box":[400,400,600,600]},{"label":"bad","box":[5,5,1,1]}]}`);
  assert.equal(v.caption, "cake hits floor");
  assert.equal(v.venue, undefined);
  assert.equal(v.candidScore, 91);
  assert.deepEqual(v.faces[0].box, [0.1, 0.2, 0.3, 0.4]);
  assert.equal(v.text[0].sensitiveHint, "license_plate");
  assert.equal(v.subjects.length, 1);
});

test("transcripts: whole-word first-name mentions", () => {
  assert.deepEqual(findMentions("Yo Sam, get in the photo! Samantha too", ["Sam Lee", "Priya", "Al"]), ["Sam Lee"]);
  assert.deepEqual(findMentions("totally normal", ["Al"]), []);
});
