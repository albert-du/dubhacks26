"use client";

import { MAP_TILES } from "@/lib/mapStyle";
import { previewUrl, type PreviewEdge } from "@/lib/preview";

/** Start MapLibre and the tile source before the map tab is opened. */
export function warmMap() {
  void import("maplibre-gl");
  void fetch(MAP_TILES, { mode: "cors", credentials: "omit", cache: "force-cache" }).catch(() => {});
}

/** Pull small previews into the HTTP cache so the next screen can paint from memory. */
export function warmPreviews(urls: string[], edge: PreviewEdge = 320) {
  for (const url of urls) {
    if (!url) continue;
    const img = new Image();
    img.decoding = "async";
    img.src = previewUrl(url, edge);
  }
}
