import assert from "node:assert/strict";
import { test } from "node:test";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { dumpMapStyle, MAP_COLORS } from "./mapStyle";

test("dump map style uses the app palette on OpenFreeMap", () => {
  const style = dumpMapStyle();
  assert.equal(style.version, 8);

  const paint = (id: string, key: string) => {
    const layer = style.layers.find((item) => item.id === id);
    assert.ok(layer && "paint" in layer && layer.paint);
    return (layer.paint as Record<string, unknown>)[key];
  };

  assert.equal(paint("background", "background-color"), MAP_COLORS.paper);
  assert.equal(paint("water", "fill-color"), MAP_COLORS.ink);
  assert.equal(paint("park", "fill-color"), MAP_COLORS.park);
  assert.equal(paint("building", "fill-color"), MAP_COLORS.bone);
  assert.equal(paint("highway_motorway_inner", "line-color"), MAP_COLORS.green);
  assert.equal(paint("highway_major_casing", "line-color"), MAP_COLORS.ink);

  const urls = JSON.stringify(style).match(/https?:\/\/[^"\s]+/g) ?? [];
  assert.ok(urls.length >= 2);
  for (const url of urls) assert.match(new URL(url).hostname, /(^|\.)openfreemap\.org$/);

  const errors = validateStyleMin(style);
  assert.deepEqual(
    errors.map((error) => error.message),
    [],
  );
});
