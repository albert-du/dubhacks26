import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { composeSticker, stickerCropRect } from "./imaging";
import { faceOverlapping, personBox, stickerFilename, stickerId } from "./sticker";
import type { Box } from "./types";

test("sticker: a full-frame crop covers the photo and a tight box stays inside it", () => {
  assert.deepEqual(stickerCropRect([0, 0, 1, 1], 200, 80), { left: 0, top: 0, width: 200, height: 80 });
  const tight = stickerCropRect([0.4, 0.4, 0.42, 0.42], 400, 400);
  assert.ok(tight.left >= 0 && tight.top >= 0);
  assert.ok(tight.left + tight.width <= 400);
  assert.ok(tight.top + tight.height <= 400);
  assert.ok(tight.width >= 32 && tight.height >= 32);
});

test("sticker: a face box grows into a body window and stays on the frame", () => {
  const face: Box = [0.4, 0.2, 0.55, 0.35];
  const body = personBox(face);
  assert.ok(body.every((n) => n >= 0 && n <= 1));
  assert.ok(body[0] < face[0]);
  assert.ok(body[2] > face[2]);
  assert.ok(body[1] <= face[1]);
  assert.ok(body[3] > face[3]);
  const edge = personBox([0, 0, 0.08, 0.08]);
  assert.ok(edge.every((n) => n >= 0 && n <= 1));
  assert.ok(edge[2] > edge[0] && edge[3] > edge[1]);
});

test("sticker: the face inside a person box is the one that gets the name", () => {
  const faces = [
    { id: "a", box: [0.1, 0.1, 0.2, 0.2] as Box },
    { id: "b", box: [0.62, 0.15, 0.74, 0.3] as Box },
  ];
  assert.equal(faceOverlapping(faces, [0.55, 0.05, 0.9, 0.95])?.id, "b");
  assert.equal(faceOverlapping(faces, [0, 0.8, 0.1, 0.9]), undefined);
});

test("sticker: ids and download names stay in the public key", () => {
  assert.equal(stickerId("abc", { kind: "frame" }), "abc-frame");
  assert.equal(stickerId("abc", { kind: "face", index: 2 }), "abc-face-2");
  assert.equal(stickerId("abc", { kind: "object", index: 0 }), "abc-object-0");
  assert.equal(stickerFilename("Sam O'Neil"), "dump-Sam-O-Neil.png");
  assert.equal(stickerFilename("!!!"), "dump-sticker.png");
  assert.ok(stickerFilename("x".repeat(80)).length < 60);
});

test("sticker: the cutout drops the background and keeps a white die-cut edge", async () => {
  const width = 160;
  const height = 160;
  const rgba = Buffer.alloc(width * height * 4);
  const mask = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const inside = x >= 60 && x < 100 && y >= 60 && y < 100;
      rgba[i * 4] = inside ? 220 : 20;
      rgba[i * 4 + 1] = inside ? 30 : 180;
      rgba[i * 4 + 2] = 40;
      rgba[i * 4 + 3] = 255;
      mask[i] = inside ? 255 : 0;
    }
  }
  const crop = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const matte = await sharp(mask, { raw: { width, height, channels: 1 } }).png().toBuffer();
  const png = await composeSticker(crop, matte);
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);
  assert.equal(meta.format, "png");
  assert.equal(meta.exif, undefined);

  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => {
    const i = (y * info.width + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]] as const;
  };
  const [cr, cg, cb, ca] = px(0, 0);
  assert.equal(ca, 0, `corner leaked rgba ${cr},${cg},${cb},${ca}`);

  let red = 0;
  let white = 0;
  let green = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 200) continue;
    if (r > 180 && g < 80 && b < 80) red++;
    if (r > 245 && g > 245 && b > 245) white++;
    if (g > r + 40 && g > b + 40) green++;
  }
  assert.ok(red > 50, `subject pixels ${red}`);
  assert.ok(white > 50, `outline pixels ${white}`);
  assert.equal(green, 0);
  let edge = false;
  for (let x = 0; x < info.width; x++) {
    const [r, g, b, a] = px(x, 256);
    if (a > 200 && r > 245 && g > 245 && b > 245) edge = true;
  }
  assert.ok(edge, "the midline should cross the white sticker edge");
});
