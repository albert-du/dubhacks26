import { config } from "./config";

/** Any OpenAI-compatible /audio/transcriptions endpoint (e.g. faster-whisper served on Vultr). */
export const transcriber = {
  enabled: () => !!config.transcribe.url,

  async transcribe(file: Buffer, filename: string, mime: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(file)], { type: mime }), filename);
    form.append("model", config.transcribe.model);
    form.append("response_format", "json");
    const res = await fetch(`${config.transcribe.url}/audio/transcriptions`, {
      method: "POST",
      headers: config.transcribe.apiKey ? { authorization: `Bearer ${config.transcribe.apiKey}` } : {},
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`transcribe ${res.status}`);
    const raw = await res.text();
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // response_format text is a plain body, not JSON.
    }
    return readTranscript(parsed, raw);
  },
};

/**
 * Words from an OpenAI-compatible transcription. Some servers put the line in
 * `text`, some only in `segments`, and a text response is the body itself.
 * An empty result is "" so the caller can try another file.
 */
export function readTranscript(body: unknown, raw = ""): string {
  if (typeof body === "string") {
    const plain = body.trim();
    if (plain && !plain.startsWith("{") && !plain.startsWith("[")) return plain;
  }
  if (body && typeof body === "object") {
    const record = body as { text?: unknown; segments?: { text?: unknown }[] };
    if (typeof record.text === "string" && record.text.trim()) return record.text.trim();
    if (Array.isArray(record.segments)) {
      const text = record.segments
        .map((segment) => (typeof segment?.text === "string" ? segment.text.trim() : ""))
        .filter(Boolean)
        .join(" ");
      if (text) return text;
    }
  }
  const plain = raw.trim();
  if (plain && !plain.startsWith("{") && !plain.startsWith("[")) return plain;
  return "";
}

/**
 * Fields written when a video is ready. Omit an absent transcript or duplicate id:
 * the driver rejects `undefined`, and a failed transcription must still publish the clip.
 */
export function readyVideoFields(
  base: { publicKey: string; mentions: string[]; updatedAt: Date },
  transcript: string | undefined,
  duplicateOf: string | undefined,
) {
  return {
    status: "ready" as const,
    claimedAt: null as null,
    publicKey: base.publicKey,
    mentions: base.mentions,
    updatedAt: base.updatedAt,
    ...(transcript ? { transcript } : {}),
    ...(duplicateOf ? { duplicateOf } : {}),
  };
}

/** Guest names (whole-word, case-insensitive) mentioned in a transcript. */
export function findMentions(transcript: string, names: string[]): string[] {
  const hits = new Set<string>();
  for (const name of names) {
    const first = name.trim().split(/\s+/)[0];
    if (!first || first.length < 2) continue;
    const re = new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(transcript)) hits.add(name);
  }
  return [...hits];
}
