import assert from "node:assert/strict";
import test from "node:test";
import { IMESSAGE_STICKER_MAX_BYTES } from "./imaging";
import { STICKER_FILE_NAME } from "./sticker";
import {
  STICKER_LIBRARY_FILES,
  STICKER_LIBRARY_HOLD,
  STICKER_LIBRARY_INTRO,
  STICKER_LIBRARY_MAX_BYTES,
  STICKER_LIBRARY_SENT,
  STICKER_LIBRARY_STEPS,
  STICKER_LIBRARY_TOO_BIG,
  shareStickerLibrary,
  stickerLibraryShare,
  type StickerFileLike,
} from "./stickerLibrary";

const png = (size = 1200, name = STICKER_FILE_NAME, type = "image/png"): StickerFileLike => ({ name, type, size });

test("sticker library: the share is one plain png and nothing Messages can turn into a filename", () => {
  assert.equal(STICKER_LIBRARY_MAX_BYTES, IMESSAGE_STICKER_MAX_BYTES);
  const payload = stickerLibraryShare([png()]);
  assert.ok(payload);
  assert.deepEqual(Object.keys(payload), ["files"]);
  assert.equal(payload.files.length, 1);
  assert.equal(payload.files[0].name, "sticker.png");
  assert.equal(payload.files[0].type, "image/png");
  assert.equal("title" in payload, false);
  assert.equal("text" in payload, false);
  assert.equal("url" in payload, false);

  assert.equal(stickerLibraryShare([png(), png()]), null);
  assert.equal(stickerLibraryShare([]), null);
  assert.equal(stickerLibraryShare([png(1200, "dump-sticker.png")]), null);
  assert.equal(stickerLibraryShare([png(1200, "sticker.png", "image/webp")]), null);
  assert.equal(stickerLibraryShare([png(0)]), null);
  assert.equal(stickerLibraryShare([png(STICKER_LIBRARY_MAX_BYTES)]), null);
  assert.equal(stickerLibraryShare([png(STICKER_LIBRARY_MAX_BYTES + 1)]), null);
  assert.equal(stickerLibraryShare([png(Number.NaN)]), null);
});

test("sticker library: a finished share is the only path that tells someone to save it", async () => {
  const shared: { files: StickerFileLike[] }[] = [];
  const ok = await shareStickerLibrary(
    png(),
    async (data) => {
      shared.push(data);
    },
    () => true,
  );
  assert.equal(ok, "shared");
  assert.equal(shared.length, 1);
  assert.deepEqual(Object.keys(shared[0]), ["files"]);

  const aborted = await shareStickerLibrary(
    png(),
    async () => {
      throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    },
    () => true,
  );
  assert.equal(aborted, "aborted");

  const blocked = await shareStickerLibrary(
    png(),
    async () => {
      throw new Error("no share");
    },
    () => true,
  );
  assert.equal(blocked, "unavailable");

  const unsupported = await shareStickerLibrary(png(), async () => {}, () => false);
  assert.equal(unsupported, "unavailable");

  const throwing = await shareStickerLibrary(png(), async () => {}, () => {
    throw new Error("canShare");
  });
  assert.equal(throwing, "unavailable");

  const huge = await shareStickerLibrary(png(STICKER_LIBRARY_MAX_BYTES), async () => {}, () => true);
  assert.equal(huge, "rejected");

  const steps = STICKER_LIBRARY_STEPS.join(" ");
  assert.match(steps, /Save to Stickers/);
  assert.match(steps, /text field empty/);
  assert.match(steps, /tap \+, then Stickers/);
  assert.match(STICKER_LIBRARY_INTRO, /WhatsApp/);
  assert.match(STICKER_LIBRARY_HOLD, /Add Sticker/);
  assert.match(STICKER_LIBRARY_SENT, /Save to Stickers/);
  assert.match(STICKER_LIBRARY_FILES, /Add Sticker/);
  assert.match(STICKER_LIBRARY_TOO_BIG, /too big/);
  assert.equal(/already in your library/i.test(steps), false);
});
