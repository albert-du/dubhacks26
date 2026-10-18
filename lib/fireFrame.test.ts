import assert from "node:assert/strict";
import test from "node:test";
import { topFireFrameStyle } from "./fireFrame";

test("fire frame: reserves the winner's box from known dimensions", () => {
  const style = topFireFrameStyle(1600, 1200);
  assert.equal(style.aspectRatio, "1600 / 1200");
  assert.equal(style.maxHeight, "60svh");
  assert.equal(style.height, "min(60svh, calc(100cqw * 1200 / 1600))");
  assert.equal(style.width, "100%");
  assert.equal(style.position, "relative");
  assert.equal(style.overflow, "hidden");
});

test("fire frame: a missing size still reserves a box", () => {
  for (const style of [topFireFrameStyle(), topFireFrameStyle(0, 0), topFireFrameStyle(-1, 800), topFireFrameStyle(800)]) {
    assert.equal(style.aspectRatio, "4 / 3");
    assert.equal(style.height, "min(60svh, calc(100cqw * 3 / 4))");
  }
});
