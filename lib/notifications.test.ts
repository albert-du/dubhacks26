import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "./config";
import { HttpError } from "./http";
import { closeMongo, cols, db } from "./mongo";
import { connectFromMessage, disconnectNotifications, getNotificationStatus, hashConnectionCode, notificationStatus, requestNotificationConnection, sendGuestNotification } from "./notifications";
import { photon, type InboundText } from "./photon";
import sharp from "sharp";
import { enrollGuest } from "./enroll";
import { faceEmbed } from "./faceEmbed";
import { flushFaceAlerts, sendExpiryWarnings } from "./alerts";
import { dumpsterState } from "./serialize";
import type { Dumpster, Guest } from "./types";

function photonEnvironment() {
  const keys = ["PHOTON_API_KEY", "PHOTON_PROJECT_ID", "PHOTON_PLATFORM", "PHOTON_AGENT_USER_ID"];
  const saved = keys.map((k) => process.env[k]);
  process.env.PHOTON_API_KEY = "test-key";
  process.env.PHOTON_PROJECT_ID = "test-project";
  process.env.PHOTON_PLATFORM = "imessage";
  delete process.env.PHOTON_AGENT_USER_ID;
  return () => keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
}

function fixtureGuest(id = "guest-a"): Guest {
  return {
    _id: id, dumpsterId: "demo", viewerId: `viewer-${id}`,
    pendingPhotoAlerts: 0, pendingMentionAlerts: 0, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000),
  };
}

test("notifications: public state omits private connection details and expires pending codes", () => {
  const guest = fixtureGuest();
  const now = new Date();
  assert.deepEqual(notificationStatus(guest, now), { state: "disconnected" });
  guest.notificationPending = { codeHash: hashConnectionCode("a-random-code"), phone: "+12065550101", agentNumber: "+12065550201", expiresAt: new Date(now.getTime() + 600_000) };
  const pending = notificationStatus(guest, now);
  assert.equal(pending.state, "pending");
  assert.ok(!JSON.stringify(pending).includes("1206555"));
  assert.ok(!JSON.stringify(pending).includes("codeHash"));
  assert.deepEqual(notificationStatus(guest, new Date(now.getTime() + 600_001)), { state: "disconnected" });
  assert.notEqual(hashConnectionCode("a-random-code"), "a-random-code");
});

test("notifications: route each guest through their verified line without a global agent", async () => {
  const restore = photonEnvironment();
  const original = photon.reply;
  const calls: Parameters<typeof photon.reply>[0][] = [];
  photon.reply = async (input) => { calls.push(input); };
  try {
    const a = fixtureGuest();
    a.phone = "+12065550101";
    assert.equal(await sendGuestNotification(a, "hello", "unverified"), false);
    for (const [guest, suffix] of [[a, "a"], [fixtureGuest("guest-b"), "b"]] as const) {
      guest.notification = { spaceId: `space-${suffix}`, agentUserId: `agent-${suffix}`, recipientUserId: `recipient-${suffix}`, verifiedAt: new Date(), connectedMessageId: `message-${suffix}` };
      assert.equal(await sendGuestNotification(guest, "hello", `alert-${suffix}`), true);
    }
    assert.deepEqual(calls.map((c) => [c.spaceId, c.senderId]), [["space-a", "agent-a"], ["space-b", "agent-b"]]);
    photon.reply = async () => { throw new Error("provider unavailable"); };
    await assert.rejects(sendGuestNotification(a, "hello", "failure"), /provider unavailable/);
    delete process.env.PHOTON_API_KEY;
    await assert.rejects(sendGuestNotification(a, "hello", "missing-config"), /configured/);
  } finally { photon.reply = original; restore(); }
});

test("notifications: assignment lookup only reads the roster and returns the requested service number", async () => {
  const restore = photonEnvironment();
  const original = globalThis.fetch;
  const calls: { url: string; method: string }[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    return new Response(JSON.stringify({ assignments: [
      { handle: "+1 (206) 555-0101", assignedPhoneNumber: "+12065550201" },
      { handle: "+12065550102", assignedPhoneNumber: "+12065550202" },
    ] }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(await photon.imessageAssignment("+12065550102"), "+12065550202");
    assert.equal(await photon.imessageAssignment("+12065550999"), null);
    assert.ok(calls.every((c) => c.method === "GET" && c.url.endsWith("/platforms/imessage/assignments?pageSize=200")));
  } finally { globalThis.fetch = original; restore(); }
});

test("homepage: registration returns only a service number and handles a full demo", async () => {
  const restore = photonEnvironment();
  const original = photon.ensureImessageAssignment;
  photon.ensureImessageAssignment = async (handle) => {
    if (handle === "+12065550101") return "+12065550201";
    throw new HttpError(409, "All demo iMessage slots are in use.");
  };
  try {
    const { POST } = await import("../app/api/photon/assignment/route");
    const request = (phone: string, origin?: string) => POST(new Request("http://localhost/api/photon/assignment", {
      method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify({ phone }),
    }), {});
    const found = await request("2065550101");
    assert.equal(found.status, 200);
    assert.deepEqual(await found.json(), { agentNumber: "+12065550201" });
    assert.match(found.headers.get("cache-control")!, /no-store/);
    assert.equal((await request("+12065550999")).status, 409);
    assert.equal((await request("invalid")).status, 400);
    assert.equal((await request("+12065550101", new URL(config.appUrl).origin)).status, 200);
    assert.equal((await request("+12065550101", "https://other.example")).status, 403);
  } finally { photon.ensureImessageAssignment = original; restore(); }
});

test("registration: reuse seats, create idempotently, handle races and capacity", async () => {
  const restore = photonEnvironment();
  const original = globalThis.fetch;
  const requests: { method: string; headers?: HeadersInit; body?: BodyInit | null }[] = [];
  let existing = true;
  let failure: string | undefined;
  let lookups = 0;
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    requests.push({ method: init?.method ?? "GET", headers: init?.headers, body: init?.body });
    if (!init?.method) {
      lookups++;
      return Response.json({ assignments: existing || (failure === "ASSIGNMENT_EXISTS" && lookups % 2 === 0)
        ? [{ handle: "+12065550101", assignedPhoneNumber: "+12065550201" }] : [] });
    }
    return failure ? Response.json({ code: failure }, { status: 409 }) : Response.json({ assignedPhoneNumber: "+12065550201" }, { status: 201 });
  }) as typeof fetch;
  try {
    assert.equal(await photon.ensureImessageAssignment("+12065550101"), "+12065550201");
    assert.equal(requests.length, 1);
    existing = false;
    assert.equal(await photon.ensureImessageAssignment("+12065550101"), "+12065550201");
    assert.equal(await photon.ensureImessageAssignment("+12065550101"), "+12065550201");
    const writes = requests.filter((r) => r.method === "POST");
    assert.deepEqual(JSON.parse(String(writes[0].body)), { handle: "+12065550101" });
    const key = new Headers(writes[0].headers).get("idempotency-key");
    assert.ok(key && !key.includes("1206555"));
    assert.equal(key, new Headers(writes[1].headers).get("idempotency-key"));
    failure = "SHARED_LINE_CAP_EXCEEDED";
    await assert.rejects(photon.ensureImessageAssignment("+12065550101"), (e) => e instanceof HttpError && e.status === 409);
    failure = "ASSIGNMENT_EXISTS";
    lookups = 0;
    assert.equal(await photon.ensureImessageAssignment("+12065550101"), "+12065550201");
  } finally { globalThis.fetch = original; restore(); }
});

// Opt in with a disposable MongoDB instance. Each run creates and removes its own isolated database.
test("notifications: verify, retry, edit, isolate, and disconnect real guest records", { skip: !process.env.TEST_MONGODB_URI }, async () => {
  const restore = photonEnvironment();
  const saved = { uri: config.mongoUri, name: config.mongoDb, tiger: config.tigerUrl };
  const originalAssignment = photon.imessageAssignment;
  const originalReply = photon.reply;
  await closeMongo();
  config.mongoUri = process.env.TEST_MONGODB_URI!;
  config.mongoDb = `dump_connection_test_${process.pid}_${Date.now()}`;
  config.tigerUrl = undefined;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3600_000);
  const d: Dumpster = { _id: "demo", name: "Demo", ttlHours: 24, createdAt: now, expiresAt, hardDeleteAt: new Date(expiresAt.getTime() + 3600_000), settings: { allowVideo: false } };
  const a = fixtureGuest();
  const b = fixtureGuest("guest-b");
  const c = fixtureGuest("guest-c");
  const calls: Parameters<typeof photon.reply>[0][] = [];
  let failSecondLine = false;
  photon.imessageAssignment = async (phone) => phone === "+12065550101" ? "+12065550201" : phone === "+12065550102" ? "+12065550202" : null;
  photon.reply = async (input) => {
    calls.push(input);
    if (failSecondLine && input.senderId === "agent-b") throw new Error("temporary provider failure");
  };
  try {
    const collection = await cols();
    await collection.dumpsters.insertOne(d);
    await collection.guests.insertMany([a, b, c]);
    await assert.rejects(requestNotificationConnection(d, "other-viewer", "+12065550101"), (e) => e instanceof HttpError && e.status === 400);
    await assert.rejects(requestNotificationConnection(d, c.viewerId, "+12065550999"), (e) => e instanceof HttpError && e.status === 422);
    const challenge = await requestNotificationConnection(d, a.viewerId, "+12065550101", now);
    assert.equal(challenge.agentNumber, "+12065550201");
    const pending = await collection.guests.findOne({ _id: a._id });
    assert.equal(pending?.phone, undefined);
    assert.equal(pending?.notification, undefined);
    assert.equal(pending?.notificationPending?.codeHash, hashConnectionCode(challenge.message.slice(8)));
    await assert.rejects(requestNotificationConnection(d, a.viewerId, "+12065550101", now), (e) => e instanceof HttpError && e.status === 429);
    const inbound: InboundText = { from: "+12065550101", text: challenge.message, platform: "imessage", spaceKind: "direct", spaceId: "space-a", agentUserId: "agent-a", senderUserId: "recipient-a", agentHandle: "+12065550201", messageId: "message-a" };
    assert.match((await connectFromMessage({ ...inbound, from: "+12065550102" }, now))!, /invalid or expired/);
    assert.match((await connectFromMessage({ ...inbound, agentHandle: "+12065550202" }, now))!, /invalid or expired/);
    assert.match((await connectFromMessage({ ...inbound, spaceKind: "group" }, now))!, /invalid or expired/);
    assert.match((await connectFromMessage(inbound, new Date(now.getTime() + 600_001)))!, /invalid or expired/);
    assert.match((await connectFromMessage(inbound, now))!, /alerts connected/);
    assert.match((await connectFromMessage(inbound, now))!, /alerts connected/);
    assert.match((await connectFromMessage({ ...inbound, messageId: "message-reuse" }, now))!, /invalid or expired/);
    // Re-taking the selfie must not clobber the verified connection.
    const { enabled, detect } = faceEmbed;
    faceEmbed.enabled = () => true;
    faceEmbed.detect = async () => [{ box: [0, 0, 1, 1], embedding: Array(512).fill(0), score: 1 }];
    const selfie = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } }).jpeg().toBuffer();
    try { await enrollGuest(d, a.viewerId, { selfie }); } finally { Object.assign(faceEmbed, { enabled, detect }); }
    assert.equal((await collection.guests.findOne({ _id: a._id }))?.notification?.spaceId, "space-a");
    const state = await dumpsterState(d, a.viewerId);
    assert.deepEqual(state.me?.notifications, { state: "connected" });
    for (const secret of ["12065550101", "space-a", "agent-a", "recipient-a", "codeHash"]) assert.ok(!JSON.stringify(state).includes(secret));
    assert.equal((await getNotificationStatus(d, b.viewerId)).state, "disconnected");
    const second = await requestNotificationConnection(d, b.viewerId, "+12065550102", now);
    assert.equal(second.agentNumber, "+12065550202");
    await connectFromMessage({ ...inbound, from: "+12065550102", text: second.message, spaceId: "space-b", agentUserId: "agent-b", senderUserId: "recipient-b", agentHandle: "+12065550202", messageId: "message-b" }, now);
    await collection.guests.updateMany({ _id: { $in: [a._id, b._id] } }, { $set: { pendingPhotoAlerts: 2 } });
    failSecondLine = true;
    await flushFaceAlerts();
    const photoAlerts = calls.filter((call) => call.idempotencyKey?.startsWith("alert:"));
    assert.deepEqual(photoAlerts.map((call) => [call.spaceId, call.senderId]), [["space-a", "agent-a"], ["space-b", "agent-b"]]);
    for (const alert of photoAlerts) {
      assert.match(alert.text, /2 new photos of you/);
      assert.match(alert.text, /\/demo\?me=1/);
    }
    assert.equal((await collection.guests.findOne({ _id: a._id }))?.pendingPhotoAlerts, 0);
    assert.equal((await collection.guests.findOne({ _id: b._id }))?.pendingPhotoAlerts, 2);
    await sendExpiryWarnings();
    assert.ok((await collection.guests.findOne({ _id: a._id }))?.expiryWarningSentAt);
    assert.equal((await collection.guests.findOne({ _id: b._id }))?.expiryWarningSentAt, undefined);
    failSecondLine = false;
    await collection.dumpsters.updateOne({ _id: d._id }, { $set: { name: "Changed while retrying" } });
    await flushFaceAlerts();
    await sendExpiryWarnings();
    assert.equal((await collection.guests.findOne({ _id: b._id }))?.pendingPhotoAlerts, 0);
    assert.ok((await collection.guests.findOne({ _id: b._id }))?.expiryWarningSentAt);
    const warnings = calls.filter((call) => call.idempotencyKey?.startsWith("warn:"));
    assert.equal(warnings.filter((call) => call.senderId === "agent-a").length, 1);
    const retries = warnings.filter((call) => call.senderId === "agent-b");
    assert.equal(retries.length, 2);
    assert.equal(retries[0].idempotencyKey, retries[1].idempotencyKey);
    assert.equal(retries[0].text, retries[1].text);
    await disconnectNotifications(d, b.viewerId);
    const disconnected = await collection.guests.findOne({ _id: b._id });
    assert.equal(disconnected?.phone, undefined);
    assert.equal(disconnected?.notification, undefined);
    assert.equal(disconnected?.notificationPending, undefined);
    assert.match((await connectFromMessage({ ...inbound, from: "+12065550102", text: second.message, spaceId: "space-b", agentUserId: "agent-b", agentHandle: "+12065550202", messageId: "message-b" }, now))!, /invalid or expired/);
    const before = calls.length;
    await collection.guests.updateOne({ _id: b._id }, { $set: { pendingPhotoAlerts: 5 } });
    await flushFaceAlerts();
    assert.equal(calls.length, before);
    await assert.rejects(requestNotificationConnection(d, b.viewerId, "+12065550102", now), (e) => e instanceof HttpError && e.status === 429);
  } finally {
    await (await db()).dropDatabase();
    await closeMongo();
    config.mongoUri = saved.uri;
    config.mongoDb = saved.name;
    config.tigerUrl = saved.tiger;
    photon.imessageAssignment = originalAssignment;
    photon.reply = originalReply;
    restore();
  }
});
