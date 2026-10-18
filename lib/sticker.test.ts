import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { composeSticker, fitIMessageSticker, IMESSAGE_STICKER_MAX_BYTES, stickerCropRect } from "./imaging";
import { faceOverlapping, isPng, personBox, STICKER_FILE_NAME, stickerId } from "./sticker";
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

test("sticker: ids stay in the public key and the share name is a plain png", () => {
  assert.equal(stickerId("abc", { kind: "frame" }), "abc-frame");
  assert.equal(stickerId("abc", { kind: "face", index: 2 }), "abc-face-2");
  assert.equal(stickerId("abc", { kind: "object", index: 0 }), "abc-object-0");
  assert.equal(STICKER_FILE_NAME, "sticker.png");
  assert.equal(/dump/i.test(STICKER_FILE_NAME), false);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  assert.equal(isPng(png), true);
  assert.equal(isPng(png.subarray(0, 4)), false);
  assert.equal(isPng(Uint8Array.from([0xff, 0xd8, 0xff, 0xd8, 0, 0, 0, 0, 0])), false);
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
  assert.ok(png.length < IMESSAGE_STICKER_MAX_BYTES);

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

test("sticker: a huge cutout is squeezed under the iMessage sticker limit", async () => {
  const width = 900;
  const height = 900;
  const raw = Buffer.alloc(width * height * 4);
  for (let i = 0; i < raw.length; i += 4) {
    raw[i] = i % 251;
    raw[i + 1] = (i * 3) % 251;
    raw[i + 2] = (i * 7) % 251;
    raw[i + 3] = i % 5 === 0 ? 0 : 255;
  }
  const big = await sharp(raw, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(big.length > IMESSAGE_STICKER_MAX_BYTES);
  const fitted = await fitIMessageSticker(big);
  const meta = await sharp(fitted).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.hasAlpha, true);
  assert.ok((meta.width ?? 999) <= 618);
  assert.ok((meta.height ?? 999) <= 618);
  assert.ok(fitted.length < IMESSAGE_STICKER_MAX_BYTES, `sticker is ${fitted.length} bytes`);
});
