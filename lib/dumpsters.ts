import { customAlphabet } from "nanoid";
import { config, type TtlHours } from "./config";
import { cols } from "./mongo";
import { tiger } from "./tiger";
import type { Dumpster, DumpsterSettings } from "./types";

/**
 * Room ids are the only key to a room, so they must be unguessable:
 * 25 chars from a 32-symbol alphabet = 125 bits from a CSPRNG (nanoid uses crypto.getRandomValues).
 * Lowercase and no look-alike characters so it survives being read aloud or typed from a poster.
 */
export const ROOM_ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";
export const ROOM_ID_LENGTH = 25;
const roomId = customAlphabet(ROOM_ID_ALPHABET, ROOM_ID_LENGTH);
const ROOM_ID_RE = new RegExp(`^[${ROOM_ID_ALPHABET}]{${ROOM_ID_LENGTH}}$`);

export const isRoomId = (id: string) => ROOM_ID_RE.test(id);

export async function createDumpster(input: { name: string; ttlHours: TtlHours; settings?: Partial<DumpsterSettings> }) {
  const { dumpsters } = await cols();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.ttlHours * 3600_000);
  const doc: Dumpster = {
    _id: roomId(),
    name: input.name.trim().slice(0, 60),
    ttlHours: input.ttlHours,
    createdAt: now,
    expiresAt,
    hardDeleteAt: new Date(expiresAt.getTime() + config.hardDeleteGraceMs),
    settings: { allowVideo: true, ...input.settings },
  };
  await dumpsters.insertOne(doc);
  await tiger.scheduleCleanup(doc._id, expiresAt);
  return doc;
}

/** Returns the dumpster only while it's alive. Expired rooms are treated as gone everywhere. */
export async function getLiveDumpster(id: string): Promise<Dumpster | null> {
  if (!isRoomId(id)) return null; // cheap reject for malformed/guessed ids, no DB hit
  const { dumpsters } = await cols();
  const d = await dumpsters.findOne({ _id: id });
  if (!d || d.expiresAt.getTime() <= Date.now()) return null;
  return d;
}

export function roomUrl(id: string) {
  return `${config.appUrl.replace(/\/$/, "")}/${id}`;
}
