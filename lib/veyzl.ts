/**
 * Diff review for VEYZL.md. The mechanical rules live in scripts/privacy-audit.ts.
 * This pass only looks at added lines and reports what those rules cannot prove:
 * a new third-party host, a new identity field, or a phone or secret written to a log.
 * New logs and new stores are medium and do not fail the check when fail-on is high.
 */
export type Severity = "high" | "medium";

export interface Finding {
  severity: Severity;
  rule: string;
  file: string;
  line: number;
  message: string;
}

const RANK: Record<Severity, number> = { medium: 1, high: 2 };

/** Exact DNS names of services on our private Compose network. */
const INTERNAL_HOSTS = new Set(["face-embed", "whisper"]);

/** Hosts dump already calls, plus docs, loopback, and RFC example domains. */
const ALLOWED_SUFFIXES = [
  "photon.codes",
  "perceptron.inc",
  "backboard.io",
  "w3.org",
  "github.com",
  "githubusercontent.com",
  "dumpster.photo",
  "openfreemap.org",
  "example.com",
  "example.org",
  "example.net",
];

const URL_RE = /\b(?:https?|wss?):\/\/[^\s"'`<>)\\]+/gi;

export function reviewFailed(findings: Finding[], failOn: Severity = "high"): boolean {
  const threshold = RANK[failOn];
  return findings.some((f) => RANK[f.severity] >= threshold);
}

export function reviewDiff(diff: string): Finding[] {
  const findings: Finding[] = [];
  let file = "";
  let newLine = 0;
  let skip = false;

  for (const raw of diff.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("diff --git ")) {
      file = "";
      skip = false;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim();
      if (path === "/dev/null") {
        file = "";
        skip = true;
      } else {
        file = path.replace(/^b\//, "").replaceAll("\\", "/");
        skip = skipFile(file);
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith("+")) {
      if (!skip && file) findings.push(...reviewLine(file, newLine, line.slice(1)));
      newLine++;
      continue;
    }
    if (line.startsWith("-") || line.startsWith("\\")) continue;
    if (file) newLine++;
  }
  return findings;
}

function skipFile(file: string): boolean {
  if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) return true;
  if (file.endsWith(".md")) return true;
  if (file.startsWith("scripts/")) return true;
  if (file === "lib/veyzl.ts") return true;
  if (file === "package-lock.json" || file.endsWith(".lock")) return true;
  return false;
}

function reviewLine(file: string, line: number, text: string): Finding[] {
  if (isComment(text)) return [];
  const high: Finding[] = [];

  for (const url of urlsIn(text)) {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    if (!hostAllowed(host)) {
      high.push(finding("high", "third-party", file, line, `new call to ${host}`));
    }
  }

  const uses = /^\s*-?\s*uses:\s*(\S+)/.exec(text);
  if (uses && (file.endsWith(".yml") || file.endsWith(".yaml"))) {
    const action = uses[1];
    const owner = action.split("/")[0] ?? "";
    const local = action.startsWith("./") || action.startsWith("docker://");
    if (!local && owner !== "actions" && owner !== "github") {
      high.push(finding("high", "third-party", file, line, `new third-party action ${action}`));
    }
  }

  if (/x-forwarded-for|x-real-ip|\breq\.ip\b/i.test(text)) {
    high.push(finding("high", "identity", file, line, "reads a client IP"));
  }
  if (/\b(uploader|creator|hostPhone|hostId|ownerId|clientIp|ipAddress|viewerIp)\b/.test(text) || /\bowner\s*\??\s*:/.test(text)) {
    high.push(finding("high", "identity", file, line, "adds an identity field"));
  }

  const isLog = /console\.(log|warn|error|info|debug)\s*\(/.test(text);
  if (isLog && /\bphone\b|\$\{to\}/i.test(text) && !text.includes("maskPhone")) {
    high.push(finding("high", "redaction", file, line, "logs a phone number without maskPhone()"));
  }
  if (isLog && /api[_-]?key|webhookSecret|signingSecret|process\.env\.\w*(KEY|SECRET|TOKEN)/i.test(text) && !/mask|redact/i.test(text)) {
    high.push(finding("high", "redaction", file, line, "logs a secret"));
  }

  if (high.length) return high;

  const medium: Finding[] = [];
  if (isLog) medium.push(finding("medium", "log", file, line, "new log line"));
  if (/\.collection\s*\(\s*["'`]|\bstorage\.put\s*\(|\binsert(?:One|Many)\s*\(/.test(text)) {
    medium.push(finding("medium", "store", file, line, "new data store write"));
  }
  return medium;
}

function finding(severity: Severity, rule: string, file: string, line: number, message: string): Finding {
  return { severity, rule, file, line, message };
}

function isComment(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("#") || trimmed.startsWith("<!--");
}

function urlsIn(text: string): string[] {
  return [...text.matchAll(URL_RE)].map((match) => match[0].replace(/[.,;:]+$/, ""));
}

function hostAllowed(host: string): boolean {
  const name = host.toLowerCase().replace(/^\.+|\.+$/g, "");
  if (INTERNAL_HOSTS.has(name)) return true;
  if (name === "localhost" || name === "127.0.0.1" || name === "::1" || name === "0.0.0.0") return true;
  return ALLOWED_SUFFIXES.some((suffix) => name === suffix || name.endsWith(`.${suffix}`));
}
