/**
 * Review the PR or push diff against VEYZL.md. Exit 1 when a finding
 * meets VEYZL_FAIL_ON (default high).
 *
 *   npm run audit:veyzl
 *
 * In Actions, VEYZL_BASE is the pull request base (three-dot) or the previous
 * push SHA (two-dot). Locally, the range is origin/main...HEAD plus uncommitted edits.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { reviewDiff, reviewFailed, type Finding, type Severity } from "../lib/veyzl";

const root = path.resolve(__dirname, "..");

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function failOn(): Severity {
  const value = (process.env.VEYZL_FAIL_ON ?? "high").trim();
  if (value !== "high" && value !== "medium") {
    console.error("VEYZL review FAILED: VEYZL_FAIL_ON must be high or medium");
    process.exit(1);
  }
  return value;
}

function diffRange(): string {
  const base = (process.env.VEYZL_BASE ?? "").trim();
  const head = (process.env.VEYZL_HEAD ?? "HEAD").trim() || "HEAD";
  const event = process.env.GITHUB_EVENT_NAME ?? "";

  if (/^0+$/.test(base)) {
    console.log("VEYZL review passed: no parent commit to diff.");
    process.exit(0);
  }
  if (base) {
    const spec = event === "push" ? [base, head] : [`${base}...${head}`];
    return git(["diff", "--unified=0", ...spec]);
  }
  if (process.env.GITHUB_ACTIONS === "true") {
    console.error("VEYZL review FAILED: VEYZL_BASE is not set");
    process.exit(1);
  }

  let diff = "";
  try {
    git(["rev-parse", "--verify", "--quiet", "origin/main"]);
    diff += git(["diff", "--unified=0", "origin/main...HEAD"]);
  } catch {
    // No origin/main yet: review uncommitted edits only.
  }
  diff += git(["diff", "--unified=0", "HEAD"]);
  return diff;
}

function report(findings: Finding[], threshold: Severity): void {
  const high = findings.filter((f) => f.severity === "high").length;
  const medium = findings.length - high;
  const lines = findings.map((f) => `[${f.severity}] ${f.rule} ${f.file}:${f.line} ${f.message}`);
  if (reviewFailed(findings, threshold)) {
    console.error(`VEYZL review FAILED (${high} high, ${medium} medium):\n  ${lines.join("\n  ")}`);
    process.exit(1);
  }
  if (!findings.length) {
    console.log("VEYZL review passed: no findings.");
    return;
  }
  console.log(`VEYZL review passed (${high} high, ${medium} medium):\n  ${lines.join("\n  ")}`);
}

report(reviewDiff(diffRange()), failOn());
