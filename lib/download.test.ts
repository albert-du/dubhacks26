import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { IMESSAGE_STICKER_MAX_BYTES } from "./imaging";
import { downloadBody, downloadFilename } from "./download";

test("photo exports contain JPEG bytes with a matching filename and no metadata", async () => {
  const webp = await sharp({ create: { width: 8, height: 6, channels: 3, background: "red" } })
    .withMetadata({ exif: { IFD0: { Artist: "private" } } }).webp().toBuffer();
  const body = await downloadBody("event/public/photo.webp", webp);
  const meta = await sharp(body).metadata();
  assert.equal(downloadFilename("event/public/photo.webp"), "photo.jpg");
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 8);
  assert.equal(meta.height, 6);
  assert.equal(meta.exif, undefined);
});

test("WebP stickers export as PNG with transparency", async () => {
  const webp = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .webp().toBuffer();
  const body = await downloadBody("event/public/sticker-one.webp", webp);
  const meta = await sharp(body).metadata();
  assert.equal(downloadFilename("event/public/sticker-one.webp"), "sticker.png");
  assert.ok(body.length < IMESSAGE_STICKER_MAX_BYTES);
  assert.equal(meta.format, "png");
  assert.equal(meta.hasAlpha, true);
  assert.equal((await sharp(body).raw().toBuffer())[3], 0);
});

test("PNG stickers are re-exported under the iMessage limit with a plain name", async () => {
  const png = await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0 } },
  }).png().toBuffer();
  const body = await downloadBody("event/public/sticker-one.png", png);
  const meta = await sharp(body).metadata();
  assert.equal(downloadFilename("event/public/sticker-one.png"), "sticker.png");
  assert.equal(meta.format, "png");
  assert.equal(meta.hasAlpha, true);
  assert.ok(body.length < IMESSAGE_STICKER_MAX_BYTES);
});

test("videos pass through unchanged", async () => {
  const body = Buffer.from("unchanged");
  for (const name of ["video.mp4", "video.mov", "video.webm"]) {
    const key = `event/public/${name}`;
    assert.equal(downloadFilename(key), name);
    assert.equal(await downloadBody(key, body), body);
  }
});
