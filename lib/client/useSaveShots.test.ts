import assert from "node:assert/strict";
import test from "node:test";
import { dropSavedShots } from "./useSaveShots";

test("a finished save drops those shots and leaves the rest checked", () => {
  const selected = new Set(["a", "b", "c"]);
  const next = dropSavedShots(selected, ["b", "missing"]);
  assert.deepEqual([...next].sort(), ["a", "c"]);
  assert.notEqual(next, selected);
  assert.equal(dropSavedShots(selected, ["missing"]), selected);
  assert.equal(dropSavedShots(selected, []), selected);
  assert.equal(dropSavedShots(selected, ["a", "b", "c"]).size, 0);
});
