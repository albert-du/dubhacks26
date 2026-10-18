import assert from "node:assert/strict";
import { test } from "node:test";
import { blobToSend, prepareFile } from "./uploadQueue";

test("uploads: a phone video is copied out of the disk-backed File before it is sent", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const file = new File([bytes], "clip.MOV", { type: "video/quicktime" });
  const prepared = await prepareFile(file);
  assert.equal(prepared.blob instanceof File, false);
  assert.equal(prepared.type, "video/quicktime");
  assert.equal(prepared.name, "clip.MOV");
  assert.deepEqual(new Uint8Array(await prepared.blob.arrayBuffer()), bytes);

  const again = await blobToSend(prepared.blob, prepared.type);
  assert.equal(again instanceof File, false);
  assert.equal(again.type, "video/quicktime");
  assert.deepEqual(new Uint8Array(await again.arrayBuffer()), bytes);
});

test("uploads: a blank-type video still keeps its bytes", async () => {
  const bytes = new Uint8Array([9, 8, 7]);
  const file = new File([bytes], "clip.mp4", { type: "" });
  const prepared = await prepareFile(file);
  const sent = await blobToSend(prepared.blob, prepared.type);
  assert.equal(sent.size, bytes.byteLength);
  assert.deepEqual(new Uint8Array(await sent.arrayBuffer()), bytes);
});
