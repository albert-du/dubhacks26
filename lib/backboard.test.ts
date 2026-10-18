import assert from "node:assert/strict";
import { test } from "node:test";
import { createDumpSession, searchShots, shotFromMedia, type ShotCard } from "./ask";
import { backboard, isStaleTextAssistant } from "./backboard";
import { dumpsterIdFrom } from "./dumpsters";
import { emptyReactions } from "./reactions";
import { HELP, answerText, formatCreated } from "./texts";
import type { Media } from "./types";

test("shot cards keep search text and drop face vectors", () => {
  const shot = shotFromMedia(
    {
      _id: "shot1",
      caption: "toast on the floor",
      tags: ["party"],
      venue: "trailhead",
      objects: [{ label: "cake", box: [0, 0, 1, 1] }],
      text: [{ text: "HAPPY", box: [0, 0, 1, 1] }],
      faces: [{ box: [0, 0, 1, 1], embedding: [9, 8, 7], clusterId: "c1" }],
      mentions: ["sam"],
      transcript: "alex said cheers",
      reactions: { ...emptyReactions(), fire: 2 },
    } as Media,
    new Map([["c1", "Alex"]]),
  );
  assert.equal(JSON.stringify(shot).includes("embedding"), false);
  assert.equal(JSON.stringify(shot).includes("[9,8,7]"), false);
  assert.deepEqual(shot.people, ["Alex"]);
  assert.deepEqual(
    searchShots([shot], ["toast", "alex"]).map((h) => h.id),
    ["shot1"],
  );
  assert.deepEqual(searchShots([shot], ["dog"]), []);

  const session = createDumpSession([shot]);
  session.dispatch("search_dump", { words: ["toast"] });
  session.dispatch("show", { ids: ["shot1", "nope"], answer: "The toast." });
  assert.deepEqual(session.shown(), { ids: ["shot1"], answer: "The toast." });
  assert.deepEqual(session.lastIds(), ["shot1"]);
});

test("dumpster ids can be lifted out of a link", () => {
  const id = "23456789abcdefghijkmnpqrs";
  assert.equal(id.length, 25);
  assert.equal(dumpsterIdFrom(`https://dumpster.photo/${id}/stage`), id);
  assert.equal(dumpsterIdFrom("no id here"), null);
});

test("text assistants are stale after 10 minutes, dumpster assistants are not", () => {
  const old = new Date(Date.now() - 11 * 60_000).toISOString();
  assert.equal(isStaleTextAssistant("dump-text-abc", old), true);
  assert.equal(isStaleTextAssistant("dump-text-abc", new Date().toISOString()), false);
  assert.equal(isStaleTextAssistant("dumpster-abc", old), false);
});

test("fixed help never calls Backboard, and a free-text turn deletes its assistant", async () => {
  const previousKey = process.env.BACKBOARD_API_KEY;
  const previousFetch = globalThis.fetch;
  delete process.env.BACKBOARD_API_KEY;
  assert.equal(backboard.enabled(), false);
  assert.equal(await answerText("what's the top fire?"), HELP);
  assert.match(formatCreated({ name: "Hike", ttlHours: 48, id: "23456789abcdefghijkmnpqrs", expiresAt: new Date("2026-10-18T00:00:00Z") }), /open for 48h/);

  process.env.BACKBOARD_API_KEY = "test-key";
  const calls: { url: string; method: string; key?: string; body?: Record<string, unknown> }[] = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const headers = init?.headers as Record<string, string>;
    calls.push({ url: String(url), method: init?.method ?? "GET", key: headers["X-API-Key"], body });
    if (String(url).endsWith("/assistants") && init?.method === "POST") {
      return Response.json({ assistant_id: "asst-1" });
    }
    if (String(url).endsWith("/threads") && init?.method === "POST") {
      return Response.json({ thread_id: "thr-1" });
    }
    if (String(url).endsWith("/threads/messages")) {
      assert.equal(body?.memory, "off");
      assert.equal(headers.authorization, undefined);
      return Response.json({
        status: "REQUIRES_ACTION",
        thread_id: "thr-1",
        assistant_id: "asst-1",
        tool_calls: [{ id: "call-1", function: { name: "create_dumpster", arguments: '{"name":"Hike","hours":48}' } }],
      });
    }
    if (String(url).endsWith("/tool-outputs")) {
      const output = JSON.parse(String((body?.tool_outputs as { output: string }[])[0].output)) as { url?: string; hours?: number };
      assert.equal(output.hours, 48);
      assert.match(output.url ?? "", /\/23456789abcdefghijkmnpqrs$/);
      return Response.json({ status: "COMPLETED", thread_id: "thr-1", assistant_id: "asst-1", content: "Opened the hike." });
    }
    if (init?.method === "DELETE") return Response.json({ ok: true });
    return new Response("nope", { status: 500 });
  };

  try {
    // create_dumpster inside the tool reaches Mongo. Stop before that by using run() directly,
    // and cover the delete path with a turn whose tool does not touch the database.
    const turn = await backboard.run({
      content: "open one for the hike",
      tools: [],
      dispatch: async () => ({ url: "https://dump.example/23456789abcdefghijkmnpqrs", hours: 48 }),
      ephemeralAssistantId: "asst-1",
      assistantId: "asst-1",
      threadId: "thr-1",
      memory: "off",
    });
    assert.equal(turn.content, "Opened the hike.");
    assert.equal(calls[0].key, "test-key");
    assert.ok(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/assistants/asst-1/memories")));
    assert.ok(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/assistants/asst-1")));
    assert.equal(JSON.stringify(calls).includes("+1206"), false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.BACKBOARD_API_KEY;
    else process.env.BACKBOARD_API_KEY = previousKey;
  }
});

test("search words are AND, and show refuses ids that are not in the dump", () => {
  const cards: ShotCard[] = [
    {
      id: "a",
      tags: [],
      objects: ["dog"],
      text: [],
      people: [],
      mentions: [],
      fire: 0,
      speech: "the lake",
    },
    {
      id: "b",
      tags: [],
      objects: ["dog"],
      text: [],
      people: [],
      mentions: [],
      fire: 1,
    },
  ];
  assert.deepEqual(
    searchShots(cards, ["dog", "lake"]).map((h) => h.id),
    ["a"],
  );
  const session = createDumpSession(cards);
  session.dispatch("show", { ids: ["b", "foreign"], answer: "Just the dog." });
  assert.deepEqual(session.shown()?.ids, ["b"]);
});
