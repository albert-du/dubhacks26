import assert from "node:assert/strict";
import test from "node:test";
import { planAll, revealImmediately, type PlanSlot, type SlotState } from "./reveal";

const on = () => true;

function slot(
  group: string,
  index: number,
  state: SlotState,
  row = 3,
  priority = 0,
): PlanSlot {
  return { key: `${group}:${index}`, group, index, row, state, priority };
}

function loads(slots: PlanSlot[], concurrency = 4, enabled: (group: string) => boolean = on) {
  const plan = planAll(slots, concurrency, enabled);
  return slots.filter((slot) => plan.get(slot.key)?.load).map((slot) => slot.key);
}

function shown(slots: PlanSlot[], concurrency = 4) {
  const plan = planAll(slots, concurrency, on);
  return slots.filter((slot) => plan.get(slot.key)?.show).map((slot) => slot.key);
}

test("the first row starts together and the next row waits for a free slot", () => {
  const slots = [0, 1, 2, 3].map((index) => slot("dump", index, "idle"));
  assert.deepEqual(loads(slots, 3), ["dump:0", "dump:1", "dump:2"]);
  assert.deepEqual(loads(slots, 4), ["dump:0", "dump:1", "dump:2", "dump:3"]);
});

test("a row stays hidden until every image in it has settled, then the next row can appear", () => {
  const waiting = [slot("dump", 0, "settled"), slot("dump", 1, "settled"), slot("dump", 2, "loading")];
  assert.deepEqual(shown(waiting), []);
  const ready = [slot("dump", 0, "settled"), slot("dump", 1, "settled"), slot("dump", 2, "settled")];
  assert.deepEqual(shown(ready), ["dump:0", "dump:1", "dump:2"]);
  const early = [
    slot("dump", 0, "loading"),
    slot("dump", 1, "idle"),
    slot("dump", 2, "idle"),
    slot("dump", 3, "settled"),
    slot("dump", 4, "settled"),
    slot("dump", 5, "settled"),
  ];
  assert.deepEqual(shown(early), []);
  const capped = [slot("dump", 0, "loading"), slot("dump", 1, "idle"), slot("dump", 2, "idle"), slot("dump", 3, "idle")];
  assert.deepEqual(loads(capped, 1), ["dump:0"]);
});

test("a missing index does not block the rest of its row or the next row", () => {
  const gap = [slot("dump", 0, "settled"), slot("dump", 2, "settled"), slot("dump", 3, "settled")];
  assert.deepEqual(shown(gap), ["dump:0", "dump:2", "dump:3"]);
});

test("the photo row takes slots before the face row on the same screen", () => {
  const slots = [
    slot("dump", 0, "idle", 3, 0),
    slot("dump", 1, "idle", 3, 0),
    slot("dump", 2, "idle", 3, 0),
    slot("faces", 0, "idle", 4, 1),
    slot("faces", 1, "idle", 4, 1),
    slot("faces", 2, "idle", 4, 1),
  ];
  assert.deepEqual(loads(slots, 4), ["dump:0", "dump:1", "dump:2", "faces:0"]);
});

test("a paused list does not start, and an in-flight image still counts toward the cap", () => {
  const slots = [slot("dump", 0, "loading"), slot("dump", 1, "idle"), slot("fire", 0, "idle", 4, 0)];
  const enabled = (group: string) => group !== "dump";
  assert.deepEqual(loads(slots, 1, enabled), ["dump:0"]);
  assert.deepEqual(loads([slot("fire", 0, "idle", 4, 0)], 1, enabled), ["fire:0"]);
});

test("only the first screen of a top-priority list is in the first HTML", () => {
  assert.equal(revealImmediately(0, 3, 0), true);
  assert.equal(revealImmediately(2, 3, 0), true);
  assert.equal(revealImmediately(3, 3, 0), false);
  assert.equal(revealImmediately(0, 4, 1), false);
  assert.equal(revealImmediately(-1, 3, 0), false);
});
