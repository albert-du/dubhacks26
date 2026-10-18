import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSpeechWav } from "./audio";

test("audio: a buffer that is not a video does not become a wav", async () => {
  await assert.rejects(() => extractSpeechWav(Buffer.from("not a video")));
});
