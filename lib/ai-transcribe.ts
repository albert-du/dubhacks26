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
    const body = (await res.json()) as { text?: string };
    return body.text?.trim() ?? "";
  },
};

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
