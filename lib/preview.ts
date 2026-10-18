/** Longest edges for on-screen previews. Grids, pins, and stickers use 320; heroes and face crops use 960. */
export const PREVIEW_EDGES = [320, 960] as const;
export type PreviewEdge = (typeof PREVIEW_EDGES)[number];

const PREVIEW_NAME = /\.t(?:320|960)\.webp$/i;

export function previewEdge(value: string | null): PreviewEdge | null {
  const n = Number(value);
  return (PREVIEW_EDGES as readonly number[]).includes(n) ? (n as PreviewEdge) : null;
}

/** `{id}.webp` → `{id}.t320.webp`, still under the dumpster's public prefix. */
export function previewKey(publicKey: string, edge: PreviewEdge) {
  return publicKey.replace(/\.[a-z0-9]+$/i, `.t${edge}.webp`);
}

export function isPreviewKey(key: string) {
  return PREVIEW_NAME.test(key.split("/").pop() ?? "");
}

/**
 * Same picture, sized for a tile. The version query is kept, so a replaced file
 * still busts the cache. Videos, downloads, and empty urls are left alone.
 */
export function previewUrl(url: string, edge: PreviewEdge = 320) {
  if (!url || /^(data|blob):/.test(url)) return url;
  const hashAt = url.indexOf("#");
  const withoutHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const parsed = new URL(withoutHash, "http://local");
  if (parsed.searchParams.get("download") === "1") return url;
  parsed.searchParams.set("s", String(edge));
  const query = parsed.searchParams.toString();
  return `${parsed.pathname}${query ? `?${query}` : ""}`;
}
