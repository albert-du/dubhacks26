import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { renderThumb } from "./imaging";
import { isPreviewKey, previewEdge, previewKey, previewUrl } from "./preview";
import { emptyReactions } from "./reactions";
import { publicMedia, publicSticker } from "./serialize";
import type { Media, Sticker } from "./types";

test("preview urls keep the file version and ask for a small edge", () => {
  assert.equal(previewUrl("/api/files/evt/public/shot.webp?v=100", 320), "/api/files/evt/public/shot.webp?v=100&s=320");
  assert.equal(previewUrl("/api/files/evt/public/shot.webp?v=100", 960), "/api/files/evt/public/shot.webp?v=100&s=960");
  assert.equal(previewUrl("/api/files/evt/public/shot.webp?v=100&download=1"), "/api/files/evt/public/shot.webp?v=100&download=1");
  assert.equal(previewUrl(""), "");
  assert.equal(previewUrl("blob:preview"), "blob:preview");
});

test("preview keys stay inside the public prefix and only two sizes are accepted", () => {
  assert.equal(previewKey("evt/public/shot.webp", 320), "evt/public/shot.t320.webp");
  assert.equal(previewKey("evt/public/sticker-one.png", 960), "evt/public/sticker-one.t960.webp");
  assert.equal(isPreviewKey("evt/public/shot.t320.webp"), true);
  assert.equal(isPreviewKey("evt/public/shot.webp"), false);
  assert.equal(previewEdge("320"), 320);
  assert.equal(previewEdge("960"), 960);
  assert.equal(previewEdge("64"), null);
  assert.equal(previewEdge("1000"), null);
});

test("thumbs stay inside the requested edge and keep sticker transparency", async () => {
  const png = await sharp({
    create: { width: 40, height: 30, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.4 } },
  })
    .png()
    .toBuffer();
  const thumb = await renderThumb(png, 320);
  const meta = await sharp(thumb).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.hasAlpha, true);
  assert.equal(meta.width, 40);
  assert.equal(meta.height, 30);
});

test("photo urls stay put when a reaction bumps updatedAt", () => {
  const createdAt = new Date("2026-10-18T00:00:00Z");
  const updatedAt = new Date("2026-10-18T02:00:00Z");
  const media: Media = {
    _id: "m1",
    dumpsterId: "d",
    kind: "image",
    mime: "image/webp",
    bytes: 1,
    originalKey: "o",
    publicKey: "d/public/m1.webp",
    sha256: "x",
    status: "ready",
    attempts: 1,
    faces: [],
    text: [],
    objects: [],
    tags: [],
    mentions: [],
    reactions: emptyReactions(),
    createdAt,
    updatedAt,
    expiresAt: updatedAt,
  };
  assert.equal(publicMedia(media, []).url, `/api/files/d/public/m1.webp?v=${createdAt.getTime()}`);

  const sticker: Sticker = {
    _id: "s1",
    dumpsterId: "d",
    mediaId: "m1",
    label: "person",
    box: [0, 0, 1, 1],
    publicKey: "d/public/sticker-s1.png",
    status: "ready",
    createdAt,
    updatedAt,
    expiresAt: updatedAt,
  };
  assert.equal(publicSticker(sticker).url, `/api/files/d/public/sticker-s1.png?v=${updatedAt.getTime()}`);
});
