import { TTL_OPTIONS, type TtlHours } from "./config";

export type Command =
  | { type: "create"; name: string; ttlHours: TtlHours }
  | { type: "help" }
  | { type: "unknown" };

/** Parses texts sent to the Photon agent, e.g. `Create dumpster "Mt. Si Hike" 48h`. */
export function parseCommand(input: string): Command {
  const t = input.trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const m = t.match(
    /^(?:create|new|open|start)\s+(?:a\s+)?dumpster\s+(?:"([^"]+)"|'([^']+)'|(.+?))(?:\s+(\d+)\s*(?:h|hr|hrs|hours?)?)?\s*$/i,
  );
  if (m) {
    const name = (m[1] ?? m[2] ?? m[3] ?? "").trim().slice(0, 60);
    const hours = Number(m[4] ?? 24);
    if (!name) return { type: "unknown" };
    const ttlHours = (TTL_OPTIONS as readonly number[]).includes(hours) ? (hours as TtlHours) : 24;
    return { type: "create", name, ttlHours };
  }
  if (/^(help|\?|commands)\b/i.test(t)) return { type: "help" };
  return { type: "unknown" };
}
