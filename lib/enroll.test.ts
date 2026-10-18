import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { config } from "./config";
import { claimFaces, enrollGuest, forgetGuest, nameKey, renameGuest, signInByName, signOutGuest } from "./enroll";
import { faceEmbed } from "./faceEmbed";
import { HttpError } from "./http";
import { closeMongo, cols, db } from "./mongo";
import { dumpsterState } from "./serialize";
import type { Dumpster } from "./types";

test("enroll: names fold case and spacing", () => {
  assert.equal(nameKey("  Sam   Lee "), "sam lee");
  assert.equal(nameKey("SAM LEE"), nameKey("sam lee"));
});

test("enroll: first sign-in takes a selfie, then the name alone gets you back in", { skip: !process.env.TEST_MONGODB_URI }, async () => {
  const saved = { uri: config.mongoUri, name: config.mongoDb, tiger: config.tigerUrl };
  const { enabled } = faceEmbed;
  await closeMongo();
  config.mongoUri = process.env.TEST_MONGODB_URI!;
  config.mongoDb = `dump_connection_test_enroll_${process.pid}_${Date.now()}`;
  config.tigerUrl = undefined;
  faceEmbed.enabled = () => false;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3600_000);
  const d: Dumpster = { _id: "demo", name: "Demo", ttlHours: 24, createdAt: now, expiresAt, hardDeleteAt: new Date(expiresAt.getTime() + 3600_000), settings: { allowVideo: false } };
  const selfie = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } }).jpeg().toBuffer();
  const conflict = (e: unknown) => e instanceof HttpError && e.status === 409;
  try {
    const { guests, dumpsters } = await cols();
    await dumpsters.insertOne(d);

    assert.equal(await signInByName(d, "phone", "Sam", false), "new");
    const { guestId } = await enrollGuest(d, "phone", { name: "Sam", selfie });
    const sam = await guests.findOne({ _id: guestId });
    assert.deepEqual(sam?.viewerIds, ["phone"]);
    assert.equal(sam?.expiresAt.getTime(), d.expiresAt.getTime());

    // Someone else can't enroll over an existing name, in any casing.
    await assert.rejects(enrollGuest(d, "stranger", { name: " sam ", selfie }), conflict);

    // A second browser: the name finds Sam, and only signs in once confirmed.
    assert.equal(await signInByName(d, "laptop", "SAM", false), "returning");
    assert.equal((await dumpsterState(d, "laptop")).me, undefined);
    assert.equal(await signInByName(d, "laptop", "SAM", true), "signed-in");
    assert.equal((await dumpsterState(d, "laptop")).me?.guestId, guestId);
    assert.equal((await dumpsterState(d, "phone")).me?.guestId, guestId);

    // A browser belongs to one guest: signing in as Ana moves it off Sam.
    await enrollGuest(d, "ana-phone", { name: "Ana", selfie });
    await signInByName(d, "laptop", "ana", true);
    assert.equal((await dumpsterState(d, "laptop")).me?.name, "Ana");
    assert.deepEqual((await guests.findOne({ _id: guestId }))?.viewerIds, ["phone"]);

    await assert.rejects(renameGuest(d, "phone", "ANA"), conflict);
    await renameGuest(d, "phone", "Sammy");
    assert.equal(await signInByName(d, "tablet", "sammy", false), "returning");

    // "That's me" takes unclaimed faces only, and names them.
    const { clusters } = await cols();
    const anaId = (await guests.findOne({ nameKey: "ana" }))!._id;
    const face = (id: string, guestId?: string) => ({ _id: id, dumpsterId: d._id, centroid: [1, 0], n: 1, expiresAt, updatedAt: now, ...(guestId ? { guestId, name: "Ana" } : {}) });
    await clusters.insertMany([face("loose"), face("anas", anaId)]);
    assert.equal(await claimFaces(d, { _id: guestId, name: "Sammy" }, ["anas"]), 0);
    assert.equal(await claimFaces(d, { _id: guestId, name: "Sammy" }, ["loose"]), 1);
    assert.deepEqual(await clusters.findOne({ _id: "loose" }, { projection: { _id: 0, guestId: 1, name: 1 } }), { guestId, name: "Sammy" });
    assert.equal((await clusters.findOne({ _id: "anas" }))?.guestId, anaId);
    assert.deepEqual((await dumpsterState(d, "phone")).me?.clusterIds, ["loose"]);

    // Sign out forgets this browser only; the name still works.
    await signOutGuest(d, "phone");
    assert.equal((await dumpsterState(d, "phone")).me, undefined);
    assert.equal(await signInByName(d, "phone", "Sammy", true), "signed-in");

    // Forget me deletes the guest, so the name is free again.
    await forgetGuest(d, "phone");
    assert.equal(await guests.findOne({ _id: guestId }), null);
    assert.equal(await signInByName(d, "phone", "Sammy", false), "new");
  } finally {
    faceEmbed.enabled = enabled;
    await (await db()).dropDatabase();
    await closeMongo();
    config.mongoUri = saved.uri;
    config.mongoDb = saved.name;
    config.tigerUrl = saved.tiger;
  }
});
