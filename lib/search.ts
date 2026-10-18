/**
 * Global search across everything we know about a shot: objects and people in it,
 * text written in it (signs, shirts, cakes), words spoken in videos, captions, tags,
 * place, and names. Every query word must match somewhere (AND); we report where.
 * Pure and dependency-free — runs in the browser over the live dump.
 */
import type { PublicMedia } from "./types";

export type MatchSource = "objects" | "text" | "speech" | "people" | "place" | "tags";

export const SOURCE_LABEL: Record<MatchSource, string> = {
  objects: "in the photo",
  text: "written",
  speech: "said",
  people: "people",
  place: "place",
  tags: "tags",
};

function fields(m: PublicMedia, names: Map<string, string>): Record<MatchSource, string> {
  const people = m.faces.map((f) => (f.clusterId ? names.get(f.clusterId) : undefined)).filter(Boolean);
  return {
    objects: m.objects.map((o) => o.label).join(" "),
    text: m.text.map((t) => t.text).join(" "),
    speech: m.transcript ?? "",
    people: [...people, ...m.mentions].join(" "),
    place: m.venue ?? "",
    tags: [m.caption, ...m.tags].join(" "),
  };
}

export function tokenize(q: string) {
  return q.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, "")).filter(Boolean);
}

/** null = no match; otherwise the sources that matched (empty query matches everything). */
export function matchFields(sourceText: Record<MatchSource, string>, query: string): MatchSource[] | null {
  const words = tokenize(query);
  if (!words.length) return [];
  const f = (Object.keys(sourceText) as MatchSource[]).map((k) => [k, sourceText[k].toLowerCase()] as const);
  const hit = new Set<MatchSource>();
  for (const w of words) {
    const where = f.filter(([, v]) => v.includes(w)).map(([k]) => k);
    if (!where.length) return null;
    where.forEach((k) => hit.add(k));
  }
  return [...hit];
}

export function matchSources(m: PublicMedia, query: string, names: Map<string, string>): MatchSource[] | null {
  return matchFields(fields(m, names), query);
}
