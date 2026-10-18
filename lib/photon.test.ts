import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { authorizeWebhook, parseInbound, photon, verifyStandardWebhook } from "./photon";

test("photon: reads a message.received event", () => {
  const parsed = parseInbound({
    id: "evt_1",
    type: "message.received",
    apiVersion: "2026-07-01",
    source: "imessage.photon",
    data: {
      projectId: "pho_prj_test",
      object: {
        id: "pho_msg_in",
        status: "received",
        sentBy: { id: "pho_usr_human", kind: "human", handle: "+1 (206) 555-0123" },
        receivedBy: { id: "pho_usr_agent", kind: "agent", handle: "+14155550188" },
        space: { id: "pho_spc_dm" },
        content: { type: "text", format: "plain", text: 'Create dumpster "Mt. Si Hike" 48h' },
      },
    },
  });
  assert.deepEqual(parsed, {
    kind: "text",
    message: {
      from: "+12065550123",
      text: 'Create dumpster "Mt. Si Hike" 48h',
      spaceId: "pho_spc_dm",
      agentUserId: "pho_usr_agent",
      messageId: "pho_msg_in",
    },
  });
});

test("photon: ignores non-text events, agent echoes, and reads the local simulator", () => {
  assert.equal(parseInbound({ type: "message.delivered", data: {} }).kind, "ignore");
  assert.equal(
    parseInbound({
      type: "message.received",
      data: { object: { sentBy: { kind: "human", handle: "+14155550123" }, content: { type: "attachment" } } },
    }).kind,
    "ignore",
  );
  assert.equal(
    parseInbound({
      type: "message.received",
      data: {
        object: {
          sentBy: { kind: "agent", handle: "+14155550188" },
          content: { type: "text", format: "plain", text: "hello" },
        },
      },
    }).kind,
    "ignore",
  );
  assert.deepEqual(parseInbound({ from: "2065550123", text: "help" }), {
    kind: "text",
    message: { from: "+12065550123", text: "help" },
  });
  assert.equal(parseInbound({}).kind, "invalid");
});

test("photon: joins plain parts of a group message", () => {
  const parsed = parseInbound({
    type: "message.received",
    data: {
      object: {
        id: "pho_msg_group",
        sentBy: { kind: "human", handle: "ada@example.com" },
        space: { id: "pho_spc_mail" },
        content: {
          type: "group",
          parts: [
            { type: "text", format: "html", text: "<p>no</p>" },
            { type: "text", format: "plain", text: "create dumpster Picnic" },
          ],
        },
      },
    },
  });
  assert.equal(parsed.kind, "text");
  if (parsed.kind !== "text") return;
  assert.equal(parsed.message.from, "ada@example.com");
  assert.equal(parsed.message.text, "create dumpster Picnic");
});

test("photon: verifies Standard Webhooks signatures", () => {
  const key = Buffer.from("test-secret-key");
  const secret = `whsec_${key.toString("base64")}`;
  const rawBody = JSON.stringify({ type: "message.received" });
  const id = "msg_123";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  const headers = new Headers({
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,not-the-signature v1,${signature}`,
  });
  assert.equal(verifyStandardWebhook(rawBody, headers, secret), true);
  assert.equal(verifyStandardWebhook(`${rawBody} `, headers, secret), false);
  headers.set("webhook-timestamp", "1");
  assert.equal(verifyStandardWebhook(rawBody, headers, secret), false);

  assert.equal(
    authorizeWebhook({ headers: new Headers({ "x-photon-secret": "change-me" }), rawBody, secret: "change-me", nodeEnv: "production" }),
    true,
  );
  assert.equal(authorizeWebhook({ headers: new Headers(), rawBody, secret: undefined, nodeEnv: "production" }), false);
  assert.equal(authorizeWebhook({ headers: new Headers(), rawBody, secret: undefined, nodeEnv: "development" }), true);
});

test("photon: sends through user, space, then message, and stays quiet without credentials", async () => {
  const saved = {
    PHOTON_API_KEY: process.env.PHOTON_API_KEY,
    PHOTON_PROJECT_ID: process.env.PHOTON_PROJECT_ID,
    PHOTON_AGENT_USER_ID: process.env.PHOTON_AGENT_USER_ID,
    PHOTON_PLATFORM: process.env.PHOTON_PLATFORM,
    PHOTON_API_URL: process.env.PHOTON_API_URL,
  };
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  process.env.PHOTON_API_KEY = "pho_sk_test";
  process.env.PHOTON_PROJECT_ID = "pho_prj_test";
  process.env.PHOTON_AGENT_USER_ID = "pho_usr_agent";
  process.env.PHOTON_PLATFORM = "sms";
  delete process.env.PHOTON_API_URL;

  const calls: { url: string; key: string; authorization: string; body: unknown }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      key: headers.get("idempotency-key") ?? "",
      authorization: headers.get("authorization") ?? "",
      body: JSON.parse(String(init?.body)),
    });
    const path = String(url);
    const id = path.endsWith("/users") ? "pho_usr_human" : path.endsWith("/spaces") ? "pho_spc_dm" : "pho_msg_out";
    const status = path.endsWith("/messages") ? 202 : 201;
    return new Response(JSON.stringify({ id }), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    await photon.send("+14155550999", " 3 new photos ", { idempotencyKey: "alert:guest:3:0:0" });
    await photon.reply({
      to: "+14155550999",
      text: "Dumpster is open",
      spaceId: "pho_spc_existing",
      senderId: "pho_usr_line",
      parentMessageId: "pho_msg_in",
      idempotencyKey: "reply:pho_msg_in",
    });
    assert.equal(calls[0].authorization, "Bearer pho_sk_test");

    delete process.env.PHOTON_API_KEY;
    delete process.env.PHOTON_PROJECT_ID;
    delete process.env.PHOTON_AGENT_USER_ID;
    const before = calls.length;
    await photon.send("+14155550999", "hello");
    assert.equal(calls.length, before);
    assert.equal(photon.enabled(), false);
  } finally {
    globalThis.fetch = original;
    restore();
  }

  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://api.photon.codes/v1/projects/pho_prj_test/users",
      "https://api.photon.codes/v1/projects/pho_prj_test/spaces",
      "https://api.photon.codes/v1/projects/pho_prj_test/messages",
      "https://api.photon.codes/v1/projects/pho_prj_test/messages",
    ],
  );
  assert.deepEqual(calls[0].body, { platform: "sms", handle: "+14155550999" });
  assert.equal(calls[0].key, "user:sms:+14155550999");
  assert.deepEqual(calls[1].body, { platform: "sms", participantIds: ["pho_usr_agent", "pho_usr_human"] });
  assert.deepEqual(calls[2].body, {
    spaceId: "pho_spc_dm",
    senderId: "pho_usr_agent",
    content: { type: "text", format: "plain", text: "3 new photos" },
  });
  assert.equal(calls[2].key, "alert:guest:3:0:0");
  assert.deepEqual(calls[3].body, {
    spaceId: "pho_spc_existing",
    senderId: "pho_usr_line",
    parentMessageId: "pho_msg_in",
    content: { type: "text", format: "plain", text: "Dumpster is open" },
  });
});
