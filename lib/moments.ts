/**
 * Moments: photos and videos captured close together in time AND place are grouped
 * into one event cluster ("the toast", "the summit", "the 2am pizza run").
 * Pure and dependency-free so the browser can regroup live as uploads land.
 */

export interface MomentItem {
  id: string;
  /** Capture time (EXIF), falling back to upload time. ms since epoch. */
  t: number;
  gps?: { lat: number; lng: number };
  venue?: string;
  tags: string[];
}

export interface Moment {
  id: string;
  start: number;
  end: number;
  ids: string[];
  center?: { lat: number; lng: number };
  label?: string;
}

/** A new moment starts after this much quiet… */
export const MOMENT_GAP_MS = 20 * 60_000;
/** …or when a shot is this far from where the moment is happening. */
export const MOMENT_RADIUS_M = 250;

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function mostCommon(values: (string | undefined)[]) {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Chronological moments. Items without GPS join on time alone. */
export function groupMoments(items: MomentItem[], gapMs = MOMENT_GAP_MS, radiusM = MOMENT_RADIUS_M): Moment[] {
  const sorted = [...items].sort((a, b) => a.t - b.t);
  const groups: { items: MomentItem[]; end: number; center?: { lat: number; lng: number }; n: number }[] = [];

  for (const it of sorted) {
    const g = groups.at(-1);
    const near = !it.gps || !g?.center || distanceM(it.gps, g.center) <= radiusM;
    if (g && it.t - g.end <= gapMs && near) {
      g.items.push(it);
      g.end = it.t;
      if (it.gps) {
        g.center = g.center
          ? { lat: (g.center.lat * g.n + it.gps.lat) / (g.n + 1), lng: (g.center.lng * g.n + it.gps.lng) / (g.n + 1) }
          : it.gps;
        g.n++;
      }
    } else {
      groups.push({ items: [it], end: it.t, center: it.gps, n: it.gps ? 1 : 0 });
    }
  }

  return groups.map((g) => ({
    id: g.items[0].id,
    start: g.items[0].t,
    end: g.end,
    ids: g.items.map((i) => i.id),
    center: g.center,
    label: mostCommon(g.items.map((i) => i.venue)) ?? mostCommon(g.items.flatMap((i) => i.tags)),
  }));
}
