export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Index of the most similar centroid at or above `threshold`, or -1. */
export function nearest(centroids: number[][], v: number[], threshold: number): number {
  let best = -1;
  let bestSim = threshold;
  centroids.forEach((c, i) => {
    const s = cosine(c, v);
    if (s >= bestSim) {
      best = i;
      bestSim = s;
    }
  });
  return best;
}

/** Running mean, re-normalized so cosine stays meaningful. */
export function updateCentroid(centroid: number[], n: number, v: number[]): number[] {
  const out = centroid.map((c, i) => (c * n + v[i]) / (n + 1));
  const norm = Math.sqrt(out.reduce((s, x) => s + x * x, 0)) || 1;
  return out.map((x) => x / norm);
}

/* ---------- Multi-exemplar identities ----------
 * One centroid per person is too blunt: a profile or a tilted head can land below the
 * threshold and spawn a "new" person. Each person also keeps a few exemplar vectors
 * from different angles, and a face matches on its best similarity to any of them.
 */

export const MAX_EXEMPLARS = 12;
/** A new face only becomes an exemplar if it adds a new angle. */
const EXEMPLAR_NOVELTY = 0.85;

export interface Identity {
  centroid: number[];
  exemplars?: number[][];
}

/** Best similarity between a face and an identity (centroid or any exemplar). */
export function identityScore(id: Identity, v: number[]): number {
  let best = cosine(id.centroid, v);
  for (const e of id.exemplars ?? []) best = Math.max(best, cosine(e, v));
  return best;
}

/** Index of the best-matching identity at or above `threshold`, or -1. */
export function bestIdentity(ids: Identity[], v: number[], threshold: number): number {
  let best = -1;
  let bestScore = threshold;
  ids.forEach((id, i) => {
    const s = identityScore(id, v);
    if (s >= bestScore) {
      best = i;
      bestScore = s;
    }
  });
  return best;
}

/** Adds `v` as an exemplar when it's a genuinely new angle and there's room. */
export function withExemplar(exemplars: number[][] | undefined, v: number[]): number[][] {
  const list = exemplars ?? [];
  if (list.length >= MAX_EXEMPLARS) return list;
  if (list.some((e) => cosine(e, v) >= EXEMPLAR_NOVELTY)) return list;
  return [...list, v];
}

/** Strongest link between two identities: any vector of one against any vector of the other. */
export function linkScore(a: Identity, b: Identity): number {
  const av = [a.centroid, ...(a.exemplars ?? [])];
  let best = -1;
  for (const v of av) best = Math.max(best, identityScore(b, v));
  return best;
}

/**
 * Groups identities that are the same person (single-link at `threshold`), never
 * joining two that belong to different signed-in guests. Returns groups of indexes
 * with more than one member.
 */
export function mergeGroups(ids: (Identity & { guestId?: string })[], threshold: number): number[][] {
  const parent = ids.map((_, i) => i);
  const guestOf = ids.map((x) => x.guestId);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const pairs: [number, number, number][] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const s = linkScore(ids[i], ids[j]);
      if (s >= threshold) pairs.push([s, i, j]);
    }
  // Strongest links first, so a guest conflict blocks only the weakest joins.
  pairs.sort((a, b) => b[0] - a[0]);
  for (const [, i, j] of pairs) {
    const ri = find(i);
    const rj = find(j);
    if (ri === rj) continue;
    if (guestOf[ri] && guestOf[rj] && guestOf[ri] !== guestOf[rj]) continue;
    parent[rj] = ri;
    guestOf[ri] = guestOf[ri] ?? guestOf[rj];
  }
  const groups = new Map<number, number[]>();
  ids.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  return [...groups.values()].filter((g) => g.length > 1);
}

/** A photo is a better gallery picture than a frame grabbed from a clip. */
export function nextCover<T extends { mediaId: string; stillKey?: string }>(existing: T | undefined, incoming: T): T {
  if (!existing) return incoming;
  if (existing.stillKey && !incoming.stillKey) return incoming;
  return existing;
}

/** When two face groups merge, prefer a photo cover over a clip still. */
export function bestCover<T extends { mediaId: string; stillKey?: string }>(covers: (T | undefined)[]): T | undefined {
  return covers.find((c) => c && !c.stillKey) ?? covers.find((c): c is T => !!c);
}
