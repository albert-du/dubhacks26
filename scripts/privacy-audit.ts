/**
 * Deterministic privacy guardrails, run in CI on every PR alongside the VEYZL review.
 * Each check maps to a rule in VEYZL.md. Exit code 1 on any violation.
 *
 *   npm run audit:privacy
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { TTL_OPTIONS } from "../lib/config";
import { DUMPSTER_ID_ALPHABET, DUMPSTER_ID_LENGTH } from "../lib/dumpsters";
import { EPHEMERAL_COLLECTIONS } from "../lib/mongo";

const root = path.resolve(__dirname, "..");
const failures: string[] = [];
const fail = (rule: string, msg: string) => failures.push(`[${rule}] ${msg}`);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", ".data", "services", "scripts"].includes(name)) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}
const files = walk(root).map((p) => ({ p: path.relative(root, p).replaceAll("\\", "/"), src: readFileSync(p, "utf8") }));

// R1: retention is bounded to 24/48/72h.
if (JSON.stringify([...TTL_OPTIONS]) !== "[24,48,72]") fail("R1", `TTL_OPTIONS changed to ${JSON.stringify(TTL_OPTIONS)}`);

// R2: every Mongo collection the code touches has a TTL index.
const used = new Set<string>();
for (const f of files) for (const m of f.src.matchAll(/collection<\w+>\("(\w+)"\)|\.collection\("(\w+)"\)/g)) used.add(m[1] ?? m[2]);
for (const c of used) if (!(c in EPHEMERAL_COLLECTIONS)) fail("R2", `collection "${c}" has no TTL index in EPHEMERAL_COLLECTIONS`);

// R3: face embeddings never leave the server. Client code and serializers must not reference them.
for (const f of files) {
  const client = f.src.includes('"use client"');
  // Allowed mentions: Mongo projections that EXCLUDE the field, and Omit<> types that drop it.
  const stripped = f.src.replace(/"faces\.embedding": 0|centroid: 0|Omit<Cluster, "centroid">/g, "");
  if ((client || f.p === "lib/serialize.ts") && /\b(embedding|centroid)\b/.test(stripped)) {
    fail("R3", `${f.p} references face vectors`);
  }
}

// R4: the file route only serves public renders of live dumpsters.
const filesRoute = files.find((f) => f.p === "app/api/files/[...key]/route.ts");
if (!filesRoute?.src.includes("isPublicKey(key)") || !filesRoute.src.includes("getLiveDumpster")) {
  fail("R4", "file route must gate on isPublicKey() and getLiveDumpster()");
}

// R5: anonymity. Dumpsters and media carry no creator/uploader/host identity, and no request IPs are read.
const types = files.find((f) => f.p === "lib/types.ts")?.src ?? "";
for (const iface of ["Dumpster", "Media"]) {
  const body = types.match(new RegExp(String.raw`export interface ${iface} \{([\s\S]*?)\n\}`))?.[1];
  if (body === undefined) {
    fail("R5", `interface ${iface} not found in lib/types.ts`);
    continue;
  }
  const field = body.match(/^\s*(\w*(uploader|creator|host|owner|phone|viewer)\w*|ip)\??:/im);
  if (field) fail("R5", `${iface}.${field[1]} stores identity`);
}
for (const f of files) {
  // The diff reviewer names these headers so it can flag them. It does not read them.
  if (f.p === "lib/veyzl.ts") continue;
  if (/x-forwarded-for|x-real-ip|\breq\.ip\b|x-host-token/i.test(f.src)) fail("R5", `${f.p} reads client identity (IP/host token)`);
}

// R6: dumpster URLs are unguessable and malformed ids are rejected before any lookup.
const bits = DUMPSTER_ID_LENGTH * Math.log2(DUMPSTER_ID_ALPHABET.length);
if (bits < 122) fail("R6", `dumpster ids carry only ${bits.toFixed(0)} bits of entropy`);
const dumpsters = files.find((f) => f.p === "lib/dumpsters.ts")?.src ?? "";
if (!dumpsters.includes("if (!isDumpsterId(id)) return null")) fail("R6", "getLiveDumpster must validate the id format");

// R7: selfies are never persisted.
const enroll = files.find((f) => f.p === "lib/enroll.ts")?.src ?? "";
if (/storage\.put/.test(enroll)) fail("R7", "enroll.ts must not write selfies to storage");

// R8: purge deletes every ephemeral collection.
const cleanup = files.find((f) => f.p === "lib/cleanup.ts")?.src ?? "";
for (const c of Object.keys(EPHEMERAL_COLLECTIONS)) {
  if (!new RegExp(`c\\.${c}\\.delete(Many|One)`).test(cleanup)) fail("R8", `purgeDumpster does not delete "${c}"`);
}
if (!cleanup.includes("storage.deletePrefix")) fail("R8", "purgeDumpster must delete the storage prefix");
if (!cleanup.includes("forgetDumpster(")) fail("R8", "purgeDumpster must delete the Backboard assistant");
const backboardSrc = files.find((f) => f.p === "lib/backboard.ts")?.src ?? "";
if (!backboardSrc.includes("/memories") || !backboardSrc.includes("/assistants/")) {
  fail("R8", "Backboard forget must delete memories and the assistant");
}
const texts = files.find((f) => f.p === "lib/texts.ts")?.src ?? "";
if (!texts.includes("ephemeralAssistantId") || !texts.includes("forgetOne(")) {
  fail("R8", "free-text Photon turns must delete their Backboard assistant");
}

// R9: no raw phone numbers in logs.
for (const f of files) {
  f.src.split("\n").forEach((line, i) => {
    if (/console\.(log|warn|error|info)/.test(line) && /phone|\$\{to\}/i.test(line) && !line.includes("maskPhone")) {
      fail("R9", `${f.p}:${i + 1} may log a phone number; use maskPhone()`);
    }
  });
}

if (failures.length) {
  console.error(`Privacy audit FAILED (${failures.length}):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`Privacy audit passed: ${files.length} files, ${used.size} collections, 9 rules.`);
