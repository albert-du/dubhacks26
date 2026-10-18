import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { config } from "./config";
import { enrollGuest, renameGuest, signInByName } from "./enroll";
import { faceEmbed } from "./ai-face-embed";
import { HttpError } from "./http";
import { closeMongo, cols, db } from "./mongo";
import { nameFace } from "./names";
import { dumpsterState } from "./serialize";
import type { Cluster, Dumpster, Media } from "./types";

const sameName = (e: unknown) => e instanceof HttpError && e.status === 409 && !!e.extra?.sameName;
const refused = (e: unknown) => e instanceof HttpError && e.status === 409 && !e.extra;

test("names: one name is one person, and naming a face after someone asks to group", { skip: !process.env.TEST_MONGODB_URI }, async () => {
  const saved = { uri: config.mongoUri, name: config.mongoDb, tiger: config.tigerUrl };
  const { enabled } = faceEmbed;
  await closeMongo();
  config.mongoUri = process.env.TEST_MONGODB_URI!;
  config.mongoDb = `dump_connection_test_names_${process.pid}_${Date.now()}`;
  config.tigerUrl = undefined;
  faceEmbed.enabled = () => false;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3600_000);
  const d: Dumpster = { _id: "demo", name: "Demo", ttlHours: 24, createdAt: now, expiresAt, hardDeleteAt: new Date(expiresAt.getTime() + 3600_000), settings: { allowVideo: false } };
  const selfie = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } }).jpeg().toBuffer();
  const face = (id: string, centroid: number[], extra: Partial<Cluster> = {}): Cluster => ({ _id: id, dumpsterId: d._id, centroid, n: 1, expiresAt, updatedAt: now, ...extra });
  const shot = (id: string, clusterId: string): Media => ({
    _id: id, dumpsterId: d._id, kind: "image", mime: "image/webp", bytes: 1, originalKey: id, publicKey: `${d._id}/public/${id}.webp`, sha256: id,
    status: "ready", attempts: 1, faces: [{ box: [0, 0, 1, 1], clusterId }], text: [], objects: [], tags: [], mentions: [],
    reactions: { fire: 0, love: 0, lol: 0, wow: 0, cry: 0, clap: 0 }, createdAt: now, updatedAt: now, expiresAt,
  });
  try {
    const { dumpsters, clusters, media } = await cols();
    await dumpsters.insertOne(d);
    await clusters.insertMany([face("a", [1, 0]), face("b", [0, 1]), face("c", [1, 1])]);
    await media.insertMany([shot("s1", "a"), shot("s2", "b"), shot("s3", "c")]);

    // Naming a second face with a name already used (any case) asks first, then groups them.
    await nameFace(d, "a", "Rio", false);
    await assert.rejects(nameFace(d, "b", "rio", false), sameName);
    assert.equal((await clusters.findOne({ _id: "b" }))?.name, undefined, "nothing changes before they answer");
    const grouped = await nameFace(d, "b", "rio", true);
    assert.equal(grouped.name, "Rio");
    const rio = await clusters.find({ name: "Rio" }).toArray();
    assert.equal(rio.length, 1, "one person, not two");
    assert.equal(rio[0].n, 2);
    assert.deepEqual((await media.find({ _id: { $in: ["s1", "s2"] } }).toArray()).map((m) => m.faces[0].clusterId), [rio[0]._id, rio[0]._id]);

    // Signing in with a name only a face has: we show that face and ask, and the sign-in claims it.
    const named = await signInByName(d, "rio-phone", "RIO", false);
    assert.equal(named.status, "named");
    assert.deepEqual(named.faceIds, [rio[0]._id]);
    await assert.rejects(enrollGuest(d, "rio-phone", { name: "rio", selfie, claim: [] }), sameName);
    const { guestId: rioId } = await enrollGuest(d, "rio-phone", { name: "Rio", selfie, claim: [rio[0]._id] });
    assert.deepEqual((await dumpsterState(d, "rio-phone")).me?.clusterIds, [rio[0]._id]);

    // A returning name comes back with their faces, so the browser can show them.
    const back = await signInByName(d, "rio-laptop", "rio", false);
    assert.equal(back.status, "returning");
    assert.deepEqual(back.faceIds, [rio[0]._id]);

    // Naming an unclaimed face after a signed-in guest groups it into them.
    await assert.rejects(nameFace(d, "c", "RIO", false), sameName);
    await nameFace(d, "c", "RIO", true);
    assert.equal(await clusters.countDocuments({ guestId: rioId }), 1);
    assert.equal((await media.findOne({ _id: "s3" }))?.faces[0].clusterId, rio[0]._id);

    // A face that is someone else's can't take another signed-in guest's name.
    const { guestId: kaiId } = await enrollGuest(d, "kai-phone", { name: "Kai", selfie, claim: [] });
    await clusters.insertOne(face("k", [0, 1], { guestId: kaiId, name: "Kai" }));
    await assert.rejects(nameFace(d, "k", "Rio", true), refused);

    // Renaming yourself to a name a face has asks, then claims those faces.
    await clusters.insertOne(face("j", [1, -1], { name: "Jo" }));
    await assert.rejects(renameGuest(d, "kai-phone", "jo"), sameName);
    await renameGuest(d, "kai-phone", "jo", true);
    assert.equal((await clusters.findOne({ _id: "j" }))?.guestId, kaiId);
    await assert.rejects(renameGuest(d, "kai-phone", "Rio", true), (e) => e instanceof HttpError && e.status === 409);
  } finally {
    faceEmbed.enabled = enabled;
    await (await db()).dropDatabase();
    await closeMongo();
    config.mongoUri = saved.uri;
    config.mongoDb = saved.name;
    config.tigerUrl = saved.tiger;
  }
});
