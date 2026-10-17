import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { parseCommand } from "./commands";
import { cosine, nearest, updateCentroid } from "./faces";
import { parseVision } from "./perceptron";
import { classifySensitive, renderPublic } from "./privacy";
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

test("privacy: flags sensitive OCR text", () => {
  assert.equal(classifySensitive("4111 1111 1111 1111"), "credit_card");
  // Fails Luhn, so not a card — but a 16-digit run still gets redacted as a possible number.
  assert.notEqual(classifySensitive("4111 1111 1111 1112"), "credit_card");
  assert.equal(classifySensitive("7ABC123"), "license_plate");
  assert.equal(classifySensitive("me@example.com"), "email");
  assert.equal(classifySensitive("DRIVER LICENSE"), "id_card");
  assert.equal(classifySensitive("MAIN STAGE"), null);
  assert.equal(classifySensitive("anything", "id_card"), "id_card");
});

test("privacy: redaction actually destroys pixels inside the box and strips metadata", async () => {
  // Left half: high-frequency checkerboard; we redact it.
  const W = 200;
  const H = 100;
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = (x + y) % 2 ? 255 : 0;
      raw.set([v, v, v], (y * W + x) * 3);
    }
  const jpeg = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .withMetadata({ exif: { IFD0: { Copyright: "secret" } } })
    .jpeg({ quality: 100 })
    .toBuffer();
  const out = await renderPublic(jpeg, W, H, [[0.1, 0.1, 0.4, 0.9]]);
  const meta = await sharp(out).metadata();
  assert.equal(meta.exif, undefined);
  const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  // Variance inside the redacted area should collapse vs. the untouched right side.
  const variance = (x0: number, x1: number) => {
    const vals: number[] = [];
    for (let y = 30; y < 70; y++) for (let x = x0; x < x1; x++) vals.push(data[(y * W + x) * 3]);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    return vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
  };
  assert.ok(variance(30, 70) < variance(130, 170) / 10, "redacted region still has detail");
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
