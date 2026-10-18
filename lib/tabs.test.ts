import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { TAB_IDS, initialTab, tabFromParam, withTab } from "./tabs";

test("tabs: only the six screens are accepted from the url", () => {
  for (const id of TAB_IDS) assert.equal(tabFromParam(id), id);
  assert.equal(tabFromParam(null), null);
  assert.equal(tabFromParam(undefined), null);
  assert.equal(tabFromParam(""), null);
  assert.equal(tabFromParam("Dump"), null);
  assert.equal(tabFromParam("stage"), null);
  assert.equal(tabFromParam("drop "), null);
});

test("tabs: a reload opens the screen in the url, not dump", () => {
  const base = { requested: undefined, showMine: false, isNew: false, hasMedia: true };
  assert.equal(initialTab(base), "dump");
  assert.equal(initialTab({ ...base, hasMedia: false }), "drop");
  assert.equal(initialTab({ ...base, isNew: true }), "drop");
  assert.equal(initialTab({ ...base, showMine: true, isNew: true, hasMedia: false }), "dump");
  assert.equal(initialTab({ ...base, requested: "fire" }), "fire");
  assert.equal(initialTab({ ...base, requested: "map", hasMedia: false }), "map");
  assert.equal(initialTab({ ...base, requested: "pack", isNew: true }), "pack");
  assert.equal(initialTab({ ...base, requested: "me", showMine: true }), "me");
  assert.equal(initialTab({ ...base, requested: "nope" }), "dump");
  assert.equal(initialTab({ ...base, requested: "nope", hasMedia: false }), "drop");
});

test("tabs: switching screens keeps the other query params", () => {
  assert.equal(withTab("", "dump"), "?tab=dump");
  assert.equal(withTab("?new=1", "drop"), "?new=1&tab=drop");
  assert.equal(withTab("?me=1", "fire"), "?me=1&tab=fire");
  assert.equal(withTab("?me=1&tab=dump", "map"), "?me=1&tab=map");
  assert.equal(withTab("?tab=fire", "fire"), "?tab=fire");
  assert.equal(withTab("tab=pack", "me"), "?tab=me");
  assert.equal(withTab("?tab=dump&tab=fire", "map"), "?tab=map");
});

test("tabs: the dumpster page reads tab and the view writes it back", () => {
  const page = readFileSync(path.join(import.meta.dirname, "../app/[eventId]/page.tsx"), "utf8");
  const view = readFileSync(path.join(import.meta.dirname, "../components/dumpster/DumpsterView.tsx"), "utf8");
  assert.match(page, /initialTab\(/);
  assert.match(page, /requested:\s*sp\.tab/);
  assert.match(view, /withTab\(window\.location\.search,\s*next\)/);
  assert.match(view, /history\.replaceState\(null,/);
  for (const id of TAB_IDS) assert.match(view, new RegExp(`id: "${id}"`));
});
