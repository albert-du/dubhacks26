import assert from "node:assert/strict";
import { test } from "node:test";
import { bestCover, nextCover } from "./faces";
import type { Box } from "./types";
import { jpegSize, sampleTimestamps, uniqueVideoFaces } from "./videoFrames";

function sof(width: number, height: number) {
  const marker = Buffer.alloc(11);
  marker[0] = 0xff;
  marker[1] = 0xc0;
  marker.writeUInt16BE(8, 2);
  marker[4] = 8;
  marker.writeUInt16BE(height, 5);
  marker.writeUInt16BE(width, 7);
  marker[9] = 1;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), marker, Buffer.from([0xff, 0xd9])]);
}

test("frames: a long clip is sampled across its length", () => {
  const times = sampleTimestamps(60, 8);
  assert.equal(times.length, 8);
  assert.ok(times[0] < 1);
  assert.ok(times.at(-1)! > 50);
  for (let i = 0; i < times.length; i++) {
    assert.ok(times[i] >= 0 && times[i] < 60);
    if (i > 0) assert.ok(times[i] > times[i - 1]);
  }
  assert.deepEqual(sampleTimestamps(0), [0]);
  const one = sampleTimestamps(0.4);
  assert.equal(one.length, 1);
  assert.ok(one[0] >= 0 && one[0] <= 0.4);
});

test("frames: jpeg size comes from the start-of-frame marker", () => {
  assert.deepEqual(jpegSize(sof(960, 540)), { width: 960, height: 540 });
  assert.equal(jpegSize(Buffer.from("not a jpeg")), null);
});

test("video faces: the same person across frames counts once", () => {
  const faces = uniqueVideoFaces(
    [
      { faces: [{ box: [0, 0, 0.2, 0.2], embedding: [1, 0, 0], score: 0.6 }] },
      { faces: [{ box: [0.1, 0.1, 0.5, 0.5], embedding: [0.99, 0.01, 0], score: 0.9 }] },
      { faces: [{ box: [0.6, 0.6, 0.9, 0.9], embedding: [0, 1, 0], score: 0.8 }] },
    ],
    0.42,
  );
  assert.equal(faces.length, 2);
  assert.equal(faces[0].frame, 1);
  assert.equal(faces[0].score, 0.9);
  assert.equal(faces[1].embedding[1], 1);
});

test("video faces: a later photo replaces a clip still as the gallery picture", () => {
  const box: Box = [0, 0, 1, 1];
  const still = { mediaId: "v", box, stillKey: "d/public/v.f0.webp", width: 100, height: 100 };
  const photo = { mediaId: "p", box: [0, 0, 0.4, 0.4] as Box };
  assert.deepEqual(nextCover(undefined, still), still);
  assert.equal(nextCover(still, { ...still, mediaId: "v2" }).mediaId, "v");
  assert.equal(nextCover(photo, still).mediaId, "p");
  assert.equal(nextCover(still, photo).mediaId, "p");
  assert.equal(bestCover([still, undefined, photo])?.mediaId, "p");
  assert.equal(bestCover([undefined, still])?.mediaId, "v");
});
