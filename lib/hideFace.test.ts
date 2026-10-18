import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "./config";
import { claimFaces } from "./enroll";
import { hideFace, mergeClusters, unhideFace } from "./faceIdentity";
import { HttpError } from "./http";
import { closeMongo, cols, db } from "./mongo";
import { publicClusters } from "./serialize";
import type { Cluster, Dumpster, Media } from "./types";

test("faces: hiding a stranger takes it off the gallery and the shots, and never a signed-in guest", { skip: !process.env.TEST_MONGODB_URI }, async () => {
  const saved = { uri: config.mongoUri, name: config.mongoDb, tiger: config.tigerUrl };
  await closeMongo();
  config.mongoUri = process.env.TEST_MONGODB_URI!;
  config.mongoDb = `dump_connection_test_hide_${process.pid}_${Date.now()}`;
  config.tigerUrl = undefined;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3600_000);
  const d: Dumpster = { _id: "demo", name: "Demo", ttlHours: 24, createdAt: now, expiresAt, hardDeleteAt: new Date(expiresAt.getTime() + 3600_000), settings: { allowVideo: false } };
  const face = (id: string, extra: Partial<Cluster> = {}): Cluster => ({ _id: id, dumpsterId: d._id, centroid: [1, 0], n: 1, expiresAt, updatedAt: now, ...extra });
  const shot: Media = {
    _id: "s1", dumpsterId: d._id, kind: "image", mime: "image/webp", bytes: 1, originalKey: "s1", publicKey: "demo/public/s1.webp", sha256: "s1",
    status: "ready", attempts: 1, faces: [{ box: [0, 0, 0.5, 0.5], clusterId: "friend" }, { box: [0.5, 0.5, 1, 1], clusterId: "stranger" }],
    text: [], objects: [], tags: [], mentions: [], reactions: { fire: 0, love: 0, lol: 0, wow: 0, cry: 0, clap: 0 }, createdAt: now, updatedAt: now, expiresAt,
  };
  try {
    const { dumpsters, clusters, media } = await cols();
    await dumpsters.insertOne(d);
    await clusters.insertMany([face("friend", { name: "Ana", guestId: "g-ana" }), face("stranger", { name: "Guy" }), face("other")]);
    await media.insertOne(shot);

    await assert.rejects(hideFace(d._id, "friend"), (e) => e instanceof HttpError && e.status === 409);
    await hideFace(d._id, "stranger");
    const hiddenOf = async () => (await media.findOne({ _id: "s1" }))?.faces.map((f) => [f.clusterId, !!f.hidden]);
    assert.deepEqual(await hiddenOf(), [["friend", false], ["stranger", true]], "its box is marked hidden, not deleted");
    assert.deepEqual((await publicClusters(d)).map((c) => c.id).sort(), ["friend", "other"], "gone from the face row");
    assert.deepEqual((await publicClusters(d, { hidden: true })).map((c) => c.id), ["stranger"], "listed as hidden");
    assert.equal((await clusters.findOne({ _id: "stranger" }))?.name, undefined);

    // Unhide puts it back on the row and its box back on the shot; then hide it again.
    await unhideFace(d._id, "stranger");
    assert.deepEqual(await hiddenOf(), [["friend", false], ["stranger", false]]);
    assert.deepEqual((await publicClusters(d)).map((c) => c.id).sort(), ["friend", "other", "stranger"]);
    await assert.rejects(unhideFace(d._id, "stranger"), (e) => e instanceof HttpError && e.status === 404);
    await hideFace(d._id, "stranger");

    // Nobody can claim a hidden face, and merging it with a real person brings that person back.
    assert.equal(await claimFaces(d, { _id: "g-bo", name: "Bo" }, ["stranger"]), 0);
    const keep = await mergeClusters(d._id, [(await clusters.findOne({ _id: "stranger" }))!, (await clusters.findOne({ _id: "other" }))!]);
    assert.equal(keep, "other");
    assert.equal((await clusters.findOne({ _id: "other" }))?.hidden, undefined);
    assert.deepEqual(await hiddenOf(), [["friend", false], ["other", false]], "its boxes come back with the real person");
  } finally {
    await (await db()).dropDatabase();
    await closeMongo();
    config.mongoUri = saved.uri;
    config.mongoDb = saved.name;
    config.tigerUrl = saved.tiger;
  }
});
