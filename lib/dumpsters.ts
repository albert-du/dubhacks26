import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { customAlphabet } from "nanoid";
import { config, type TtlHours } from "./config";
import { cols } from "./mongo";
import { tiger } from "./tiger";
import type { Dumpster, DumpsterSettings } from "./types";

const suffix = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 5);

/** Top-level paths that must never be used as an event id. */
const RESERVED = new Set(["api", "stage", "_next", "manifest", "sw", "icon", "favicon", "new"]);

export function slugify(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 24)
    .replace(/-$/, "");
  return `${base && !RESERVED.has(base) ? base : "dump"}-${suffix()}`;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createDumpster(input: {
  name: string;
  ttlHours: TtlHours;
  hostPhone?: string;
  settings?: Partial<DumpsterSettings>;
}) {
  const { dumpsters } = await cols();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.ttlHours * 3600_000);
  const hostToken = randomBytes(24).toString("base64url");
  const doc: Dumpster = {
    _id: slugify(input.name),
    name: input.name.trim().slice(0, 60),
    ttlHours: input.ttlHours,
    createdAt: now,
    expiresAt,
    hardDeleteAt: new Date(expiresAt.getTime() + config.hardDeleteGraceMs),
    hostTokenHash: hash(hostToken),
    hostPhone: input.hostPhone,
    // Privacy-protective defaults; hosts can only relax them explicitly.
    settings: { blurNonConsented: true, redactSensitiveText: true, allowVideo: true, ...input.settings },
  };
  await dumpsters.insertOne(doc);
  await tiger.scheduleCleanup(doc._id, expiresAt);
  return { dumpster: doc, hostToken };
}

/** Returns the dumpster only while it's alive. Expired rooms are treated as gone everywhere. */
export async function getLiveDumpster(id: string): Promise<Dumpster | null> {
  const { dumpsters } = await cols();
  const d = await dumpsters.findOne({ _id: id });
  if (!d || d.expiresAt.getTime() <= Date.now()) return null;
  return d;
}

export function isHost(d: Dumpster, token: string | null | undefined) {
  if (!token) return false;
  const a = Buffer.from(hash(token));
  const b = Buffer.from(d.hostTokenHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function roomUrl(id: string) {
  return `${config.appUrl.replace(/\/$/, "")}/${id}`;
}
