/**
 * Deterministic privacy guardrails, run in CI on every PR alongside the VEYZL review.
 * Each check maps to a rule in VEYZL.md. Exit code 1 on any violation.
 *
 *   npm run audit:privacy
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { TTL_OPTIONS } from "../lib/config";
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

// R4: the file route only serves public renders of live rooms.
const filesRoute = files.find((f) => f.p === "app/api/files/[...key]/route.ts");
if (!filesRoute?.src.includes("isPublicKey(key)") || !filesRoute.src.includes("getLiveDumpster")) {
  fail("R4", "file route must gate on isPublicKey() and getLiveDumpster()");
}

// R5: privacy-protective defaults.
const dumpsters = files.find((f) => f.p === "lib/dumpsters.ts")?.src ?? "";
if (!/blurNonConsented: true/.test(dumpsters) || !/redactSensitiveText: true/.test(dumpsters)) {
  fail("R5", "blurNonConsented and redactSensitiveText must default to true");
}

// R6: fail-closed publishing.
const pipeline = files.find((f) => f.p === "lib/pipeline.ts")?.src ?? "";
if (!pipeline.includes("refusing to publish unscanned image")) fail("R6", "pipeline must refuse to publish unscanned images");

// R7: selfies are never persisted.
const enroll = files.find((f) => f.p === "lib/enroll.ts")?.src ?? "";
if (/storage\.put/.test(enroll)) fail("R7", "enroll.ts must not write selfies to storage");

// R8: purge deletes every ephemeral collection.
const cleanup = files.find((f) => f.p === "lib/cleanup.ts")?.src ?? "";
for (const c of Object.keys(EPHEMERAL_COLLECTIONS)) {
  if (!new RegExp(`c\\.${c}\\.delete(Many|One)`).test(cleanup)) fail("R8", `purgeDumpster does not delete "${c}"`);
}
if (!cleanup.includes("storage.deletePrefix")) fail("R8", "purgeDumpster must delete the storage prefix");

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
