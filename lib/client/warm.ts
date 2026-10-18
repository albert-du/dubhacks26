"use client";

import { MAP_TILES } from "@/lib/mapStyle";

/** Start MapLibre and the tile source before the map tab is opened. */
export function warmMap() {
  void import("maplibre-gl");
  void fetch(MAP_TILES, { mode: "cors", credentials: "omit", cache: "force-cache" }).catch(() => {});
}
