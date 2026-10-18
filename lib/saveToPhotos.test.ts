import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentUrl,
  chooseBatch,
  filenameFromDisposition,
  isIosDevice,
  loadShots,
  namedDownload,
  sanitizeFilename,
  SHARE_BATCH_LIMIT,
  type FetchLike,
  type SaveShot,
} from "./saveToPhotos";

test("iOS detection covers iPhone and iPadOS, not a desktop Mac", () => {
  assert.equal(isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), true);
  assert.equal(isIosDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), true);
  assert.equal(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5), true);
  assert.equal(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0), false);
  assert.equal(isIosDevice("Mozilla/5.0 (Linux; Android 14)"), false);
});

test("attachment urls ask the file route for a photo-app export", () => {
  assert.equal(attachmentUrl("/api/files/e/public/a.webp"), "/api/files/e/public/a.webp?download=1");
  assert.equal(attachmentUrl("/api/files/e/public/a.webp?v=5"), "/api/files/e/public/a.webp?v=5&download=1");
});

test("download names come from Content-Disposition and stay safe", () => {
  assert.equal(filenameFromDisposition('attachment; filename="dump-a.jpg"', "fallback.jpg"), "dump-a.jpg");
  assert.equal(filenameFromDisposition("attachment; filename=dump-a.jpg", "fallback.jpg"), "dump-a.jpg");
  assert.equal(filenameFromDisposition("attachment; filename*=UTF-8''dump%20a.jpg", "fallback.jpg"), "dump a.jpg");
  assert.equal(filenameFromDisposition(null, "fallback.jpg"), "fallback.jpg");
  assert.equal(sanitizeFilename("../../dump-a.jpg"), "dump-a.jpg");
  assert.equal(sanitizeFilename("a b.jpg"), "ab.jpg");
  assert.equal(sanitizeFilename(""), "photo");
});

test("a nameless blob picks up the export type", () => {
  const blob = new Blob([Uint8Array.from([1, 2, 3])], { type: "image/jpeg" });
  assert.deepEqual(namedDownload(blob, null, "shot"), { name: "shot.jpg", type: "image/jpeg" });
  const emptyType = new Blob([Uint8Array.from([1])], { type: "" });
  assert.deepEqual(namedDownload(emptyType, 'attachment; filename="clip.mp4"', "clip.mp4"), {
    name: "clip.mp4",
    type: "video/mp4",
  });
});

function jpegResponse(name: string, bytes: number[]) {
  return new Response(Uint8Array.from(bytes), {
    status: 200,
    headers: { "content-type": "image/jpeg", "content-disposition": `attachment; filename="${name}"` },
  });
}

test("loadShots keeps order, reads the jpeg export, and records failures", async () => {
  const shots: SaveShot[] = [
    { id: "a", url: "/api/files/e/public/a.webp?v=1", kind: "image" },
    { id: "b", url: "/api/files/e/public/b.webp?v=1", kind: "image" },
    { id: "c", url: "/api/files/e/public/c.webp?v=1", kind: "image" },
  ];
  const fetchImpl: FetchLike = async (url) => {
    assert.match(url, /download=1$/);
    if (url.includes("/c.webp")) return new Response("missing", { status: 404 });
    const id = url.includes("/b.webp") ? "b" : "a";
    await new Promise((resolve) => setTimeout(resolve, id === "a" ? 20 : 1));
    return jpegResponse(`${id}.jpg`, [id === "a" ? 9 : 4]);
  };
  const { loaded, failed } = await loadShots(shots, fetchImpl, 3);
  assert.deepEqual(
    loaded.map((item) => item.shot.id),
    ["a", "b"],
  );
  assert.deepEqual(
    loaded.map((item) => item.file.name),
    ["a.jpg", "b.jpg"],
  );
  assert.equal(loaded[0].file.type, "image/jpeg");
  assert.equal(loaded[0].file.size, 1);
  assert.deepEqual(
    failed.map((shot) => shot.id),
    ["c"],
  );
});

test("an empty export is a failure", async () => {
  const fetchImpl: FetchLike = async () => jpegResponse("a.jpg", []);
  const { loaded, failed } = await loadShots([{ id: "a", url: "/a", kind: "image" }], fetchImpl);
  assert.equal(loaded.length, 0);
  assert.equal(failed.length, 1);
});

test("chooseBatch caps a share and prefers photos when a mix is rejected", () => {
  const photos = Array.from({ length: SHARE_BATCH_LIMIT + 5 }, (_, i) => ({ id: i, type: "image/jpeg" }));
  const all = chooseBatch(photos, (item) => item.type, () => true);
  assert.equal(all.batch.length, SHARE_BATCH_LIMIT);
  assert.equal(all.rest.length, 5);
  assert.equal(all.batch[0].id, 0);
  assert.equal(all.rest[0].id, SHARE_BATCH_LIMIT);

  const mixed = [
    { id: "v", type: "video/mp4" },
    { id: "p1", type: "image/jpeg" },
    { id: "p2", type: "image/jpeg" },
  ];
  const photosOnly = chooseBatch(mixed, (item) => item.type, (group) => group.every((item) => item.type.startsWith("image/")));
  assert.deepEqual(
    photosOnly.batch.map((item) => item.id),
    ["p1", "p2"],
  );
  assert.deepEqual(
    photosOnly.rest.map((item) => item.id),
    ["v"],
  );

  const prefix = chooseBatch(photos.slice(0, 5), (item) => item.type, (group) => group.length <= 2);
  assert.deepEqual(
    prefix.batch.map((item) => item.id),
    [0, 1],
  );
  assert.deepEqual(
    prefix.rest.map((item) => item.id),
    [2, 3, 4],
  );

  const blocked = chooseBatch(photos.slice(0, 2), (item) => item.type, () => {
    throw new Error("no share");
  });
  assert.equal(blocked.batch.length, 0);
  assert.equal(blocked.rest.length, 2);
});
