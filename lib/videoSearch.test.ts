import assert from "node:assert/strict";
import { test } from "node:test";
import { findMentions, readTranscript, readyVideoFields } from "./ai-transcribe";
import { emptyReactions } from "./reactions";
import { matchSources } from "./search";
import type { PublicMedia } from "./types";

test("transcript: words come back from text, segments, or a plain body", () => {
  assert.equal(readTranscript({ text: "  say cheese  " }), "say cheese");
  assert.equal(readTranscript({ text: "", segments: [{ text: "say cheese" }, { text: " " }, { text: "for Sam" }] }), "say cheese for Sam");
  assert.equal(readTranscript("everybody say cheese"), "everybody say cheese");
  assert.equal(readTranscript({}), "");
});

test("video search: spoken words match, and a missed transcript still publishes", () => {
  const transcript = "Everybody, say cheese!\nFor Sam";
  const mentions = findMentions(transcript, ["Sam Lee", "Priya"]);
  const ready = readyVideoFields(
    { publicKey: "demo/public/clip.mp4", mentions, updatedAt: new Date("2026-10-18T00:00:00Z") },
    transcript,
    undefined,
  );
  assert.equal(ready.transcript, transcript);
  assert.deepEqual(ready.mentions, ["Sam Lee"]);
  assert.equal("duplicateOf" in ready, false);
  assert.equal(JSON.stringify(ready).includes("undefined"), false);

  const shot = {
    kind: "video",
    objects: [],
    text: [],
    transcript: ready.transcript,
    faces: [],
    mentions: ready.mentions,
    tags: [],
    caption: "",
    reactions: emptyReactions(),
  } as unknown as PublicMedia;
  assert.deepEqual(matchSources(shot, "cheese", new Map()), ["speech"]);
  assert.ok(matchSources(shot, "sam", new Map())?.includes("speech"));
  assert.ok(matchSources(shot, "sam", new Map())?.includes("people"));
  assert.ok(matchSources({ ...shot, transcript: "please don’t stop", mentions: [] }, "don't", new Map())?.includes("speech"));

  const silent = readyVideoFields(
    { publicKey: "demo/public/silent.mp4", mentions: [], updatedAt: new Date("2026-10-18T00:00:00Z") },
    undefined,
    undefined,
  );
  assert.equal("transcript" in silent, false);
  assert.equal(matchSources({ ...shot, transcript: undefined, mentions: [] }, "cheese", new Map()), null);
});
