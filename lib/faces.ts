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
