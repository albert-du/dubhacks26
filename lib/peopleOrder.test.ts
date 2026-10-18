import assert from "node:assert/strict";
import { test } from "node:test";
import { namedFirst } from "./peopleOrder";

test("named people come first, and a larger group still leads inside each group", () => {
  const people = [
    { id: "unnamed-big", count: 9 },
    { id: "named-small", name: "Bo", count: 2 },
    { id: "named-big", name: "Ana", count: 8 },
    { id: "unnamed-small", count: 1 },
    { id: "blank", name: "", count: 7 },
  ];
  assert.deepEqual(
    namedFirst(people).map((p) => p.id),
    ["named-big", "named-small", "unnamed-big", "blank", "unnamed-small"],
  );
});

test("a shot lists named tags first and keeps face order inside each group", () => {
  const tags = [
    { face: 0, label: "Person 1" },
    { face: 1, name: "Ana", label: "Ana" },
    { face: 2, name: "Bo", label: "Bo" },
    { face: 3, label: "Person 2" },
  ];
  assert.deepEqual(
    namedFirst(tags).map((t) => t.face),
    [1, 2, 0, 3],
  );
});
