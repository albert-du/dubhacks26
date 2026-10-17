/**
 * Reactions. Only "fire" (the flaming-dumpster reaction) puts a shot on the Dumpster Fire
 * leaderboard; the rest are expression only and act as a tiebreak ("engagement").
 * Ranking is purely people's reactions — no automated scoring of any kind.
 * Shared by server and client, so keep this file dependency-free.
 */
export const REACTIONS = [
  { key: "fire", label: "Dumpster fire" },
  { key: "love", label: "Love", emoji: "❤️" },
  { key: "lol", label: "Laughing", emoji: "😂" },
  { key: "wow", label: "Wow", emoji: "😮" },
  { key: "cry", label: "Crying", emoji: "😭" },
  { key: "clap", label: "Applause", emoji: "👏" },
] as const;

export type ReactionKey = (typeof REACTIONS)[number]["key"];
export type ReactionCounts = Record<ReactionKey, number>;

export const REACTION_KEYS = REACTIONS.map((r) => r.key) as ReactionKey[];
export const isReactionKey = (k: unknown): k is ReactionKey => REACTION_KEYS.includes(k as ReactionKey);

export const emptyReactions = (): ReactionCounts =>
  Object.fromEntries(REACTION_KEYS.map((k) => [k, 0])) as ReactionCounts;

/** Every non-fire reaction: the engagement signal used to break fire ties. */
export const engagement = (r: ReactionCounts) => REACTION_KEYS.reduce((s, k) => (k === "fire" ? s : s + (r[k] ?? 0)), 0);

/**
 * Dumpster Fire leaderboard: anything with at least one fire, ordered by fire count,
 * then engagement, then whoever got there first.
 */
export function fireRank<T extends { reactions: ReactionCounts; createdAt: string | Date }>(items: T[]): T[] {
  const t = (d: string | Date) => (typeof d === "string" ? Date.parse(d) : d.getTime());
  return items
    .filter((m) => (m.reactions.fire ?? 0) > 0)
    .sort(
      (a, b) =>
        b.reactions.fire - a.reactions.fire || engagement(b.reactions) - engagement(a.reactions) || t(a.createdAt) - t(b.createdAt),
    );
}
