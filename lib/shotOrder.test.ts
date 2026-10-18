import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "./config";
import { closeMongo, cols, db } from "./mongo";
import { dumpsterState } from "./serialize";
import { newestShotFirst } from "./shotOrder";
import type { Dumpster, Media } from "./types";

const at = (h: number) => new Date(Date.UTC(2026, 9, 17, h));

test("shot order: newest taken first, drop time when there's no capture time", () => {
  const list = newestShotFirst([
    { id: "dropped-last-taken-first", takenAt: at(1).toISOString(), createdAt: at(9).toISOString() },
    { id: "no-exif", createdAt: at(5).toISOString() },
    { id: "taken-last", takenAt: at(7).toISOString(), createdAt: at(8).toISOString() },
  ]);
  assert.deepEqual(list.map((m) => m.id), ["taken-last", "no-exif", "dropped-last-taken-first"]);
});

test("shot order: the dump loads in the same order", { skip: !process.env.TEST_MONGODB_URI }, async () => {
  const saved = { uri: config.mongoUri, name: config.mongoDb, tiger: config.tigerUrl };
  await closeMongo();
  config.mongoUri = process.env.TEST_MONGODB_URI!;
  config.mongoDb = `dump_connection_test_order_${process.pid}_${Date.now()}`;
  config.tigerUrl = undefined;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3600_000);
  const d: Dumpster = { _id: "demo", name: "Demo", ttlHours: 24, createdAt: now, expiresAt, hardDeleteAt: new Date(expiresAt.getTime() + 3600_000), settings: { allowVideo: true } };
  const shot = (id: string, createdAt: Date, takenAt?: Date): Media => ({
    _id: id, dumpsterId: d._id, kind: "image", mime: "image/webp", bytes: 1, originalKey: id, publicKey: `demo/public/${id}.webp`, sha256: id,
    status: "ready", attempts: 1, faces: [], text: [], objects: [], tags: [], mentions: [],
    reactions: { fire: 0, love: 0, lol: 0, wow: 0, cry: 0, clap: 0 }, createdAt, updatedAt: createdAt, expiresAt, takenAt,
  });
  try {
    const { dumpsters, media } = await cols();
    await dumpsters.insertOne(d);
    await media.insertMany([shot("dropped-last-taken-first", at(9), at(1)), shot("no-exif", at(5)), shot("taken-last", at(8), at(7))]);
    const state = await dumpsterState(d, "viewer");
    assert.deepEqual(state.media.map((m) => m.id), ["taken-last", "no-exif", "dropped-last-taken-first"]);
  } finally {
    await (await db()).dropDatabase();
    await closeMongo();
    config.mongoUri = saved.uri;
    config.mongoDb = saved.name;
    config.tigerUrl = saved.tiger;
  }
});
