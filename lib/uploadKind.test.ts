import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { classifyUpload, MEDIA_UPLOAD_PATH } from "./uploadKind";

test("uploads: phone videos with a blank type are still videos", () => {
  assert.deepEqual(classifyUpload("video/mp4", "clip.mp4"), { ext: "mp4", mime: "video/mp4", kind: "video" });
  assert.deepEqual(classifyUpload("video/quicktime", "clip.mov"), { ext: "mov", mime: "video/quicktime", kind: "video" });
  assert.deepEqual(classifyUpload("", "clip.MOV"), { ext: "mov", mime: "video/quicktime", kind: "video" });
  assert.deepEqual(classifyUpload("application/octet-stream", "clip.mp4"), { ext: "mp4", mime: "video/mp4", kind: "video" });
  assert.deepEqual(classifyUpload("", "photo.JPG"), { ext: "jpg", mime: "image/jpeg", kind: "image" });
  assert.equal(classifyUpload("text/plain", "notes.mp4"), null);
  assert.equal(classifyUpload("", "no-extension"), null);
});

test("uploads: the video POST is the path middleware must not clone", () => {
  const src = readFileSync(path.join(import.meta.dirname, "../middleware.ts"), "utf8");
  assert.match(src, /api\/dumpsters\/\[\^\/\]\+\/media\$/);
  assert.equal(MEDIA_UPLOAD_PATH.test("/api/dumpsters/abc123/media"), true);
  assert.equal(MEDIA_UPLOAD_PATH.test("/api/dumpsters/abc123/media/"), false);
  assert.equal(MEDIA_UPLOAD_PATH.test("/api/dumpsters/abc123/media/shot1/react"), false);
  assert.equal(MEDIA_UPLOAD_PATH.test("/api/dumpsters/abc123/guests"), false);
  assert.equal(MEDIA_UPLOAD_PATH.test("/abc123"), false);
});
