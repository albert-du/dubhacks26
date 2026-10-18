import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSpeechWav, pcmToWav } from "./audio";

test("audio: a buffer that is not a video does not become a wav", async () => {
  await assert.rejects(() => extractSpeechWav(Buffer.from("not a video")));
});

test("audio: pcm gets a wav header whose sizes match the samples", () => {
  const pcm = Buffer.alloc(320);
  const wav = pcmToWav(pcm, 16000);
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.equal(wav.readUInt32LE(4), 36 + pcm.length);
  assert.equal(wav.subarray(8, 12).toString(), "WAVE");
  assert.equal(wav.subarray(36, 40).toString(), "data");
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.length, 44 + pcm.length);
  const odd = pcmToWav(Buffer.concat([pcm, Buffer.from([1])]), 16000);
  assert.equal(odd.readUInt32LE(40), pcm.length);
});
