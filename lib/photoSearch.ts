import { config } from "./config";
import { identityScore } from "./faces";
import { faceEmbed } from "./ai-face-embed";
import { HttpError } from "./http";
import { normalizeImage } from "./imaging";
import { cols } from "./mongo";
import { perceptron } from "./ai-perceptron";
import type { Dumpster } from "./types";

export interface PhotoSearchResult {
  ids: string[];
  /** What the photo matched on, for the results banner. */
  people: string[];
  things: string[];
}

const IGNORED = new Set(["person", "people", "man", "woman", "face"]);

/** Pure ranking step: shots whose objects/tags share labels with the query, most overlap first. */
export function rankByLabels(
  shots: { _id: string; labels: string[] }[],
  query: string[],
): string[] {
  const want = new Set(query.map((l) => l.toLowerCase()).filter((l) => l && !IGNORED.has(l)));
  if (!want.size) return [];
  return shots
    .map((s) => ({ id: s._id, score: [...new Set(s.labels.map((l) => l.toLowerCase()))].filter((l) => want.has(l)).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.id);
}

/**
 * Search the dumpster with a photo instead of words. If the photo has a face we know,
 * return every shot of that person; otherwise match on the things in it.
 * The query photo is analyzed in memory and never stored.
 */
export async function searchByPhoto(d: Dumpster, image: Buffer): Promise<PhotoSearchResult> {
  if (!faceEmbed.enabled() && !perceptron.enabled()) throw new HttpError(503, "Photo search isn’t available right now.");
  const { jpeg } = await normalizeImage(image);
  const [faces, vision] = await Promise.all([
    faceEmbed.enabled() ? faceEmbed.detect(jpeg).catch(() => []) : Promise.resolve([]),
    perceptron.enabled() ? perceptron.analyze(jpeg).catch(() => null) : Promise.resolve(null),
  ]);

  const { clusters, media } = await cols();

  // People: match each face in the query to the closest known face.
  if (faces.length) {
    const known = await clusters.find({ dumpsterId: d._id }, { projection: { centroid: 1, exemplars: 1, name: 1 } }).toArray();
    const matched = new Map<string, string | undefined>();
    for (const f of faces) {
      let best: { id: string; name?: string; sim: number } | null = null;
      for (const c of known) {
        const sim = identityScore(c, f.embedding);
        if (sim >= config.faceMatchThreshold && (!best || sim > best.sim)) best = { id: c._id, name: c.name, sim };
      }
      if (best) matched.set(best.id, best.name);
    }
    if (matched.size) {
      const hits = await media
        .find({ dumpsterId: d._id, status: "ready", "faces.clusterId": { $in: [...matched.keys()] } }, { projection: { _id: 1 } })
        .sort({ createdAt: -1 })
        .toArray();
      return { ids: hits.map((h) => h._id), people: [...matched.values()].map((n) => n ?? "this person"), things: [] };
    }
  }

  // Things: match on object labels and tags.
  const labels = [...new Set([...(vision?.objects ?? []).map((o) => o.label), ...(vision?.tags ?? [])])];
  const shots = await media
    .find({ dumpsterId: d._id, status: "ready" }, { projection: { objects: 1, tags: 1 } })
    .toArray();
  const ids = rankByLabels(
    shots.map((s) => ({ _id: s._id, labels: [...(s.objects ?? []).map((o) => o.label), ...(s.tags ?? [])] })),
    labels,
  );
  return { ids, people: [], things: labels.filter((l) => !IGNORED.has(l.toLowerCase())).slice(0, 4) };
}
