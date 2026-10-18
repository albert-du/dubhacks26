import { config } from "./config";
import type { Box, DetectedObject } from "./types";

/**
 * Perceptron vision adapter (Isaac / Mk1). One grounded call per image returns
 * every readable piece of text (OCR) with boxes, face boxes, every primary object and person
 * with a label and box, a caption, scene tags and venue/landmark text.
 *
 * Uses an OpenAI-compatible chat-completions request with an inline image.
 * VERIFY against Perceptron's current API docs: base URL, model id, and whether
 * boxes come back in 0..1000 space (we assume so, and normalize to 0..1).
 */

export interface VisionResult {
  caption?: string;
  tags: string[];
  venue?: string;
  faces: { box: Box }[];
  text: { text: string; box: Box }[];
  objects: DetectedObject[];
}

const PROMPT = `You are the vision system for a party photo-sharing app. Analyze the image and reply with ONLY a JSON object:
{
  "caption": "one short, playful sentence",
  "tags": ["up to 8 lowercase scene/activity tags"],
  "venue": "venue, landmark, or event signage name visible in the image, or null",
  "faces": [{"box": [x1,y1,x2,y2]}],
  "objects": [{"label": "lowercase noun, e.g. person, dog, cake, guitar", "box": [x1,y1,x2,y2]}],
  "text": [{"text": "exact text as written", "box": [x1,y1,x2,y2]}]
}
Rules:
- faces: every human face, including people in the background.
- objects: every primary object and every person in the photo (label people "person"), most prominent first, max 20.
- text: every legible word, sign, shirt print, banner or label, one entry per line of text.
Boxes are integer pixel coordinates normalized to a 0-1000 grid.`;

export const perceptron = {
  enabled: () => !!config.perceptron.apiKey,

  async analyze(jpeg: Buffer): Promise<VisionResult> {
    const res = await fetch(`${config.perceptron.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.perceptron.apiKey}` },
      body: JSON.stringify({
        model: config.perceptron.model,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`perceptron ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = await res.json();
    const content: string = body.choices?.[0]?.message?.content ?? "";
    return parseVision(content);
  },
};

export function parseVision(content: string): VisionResult {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("perceptron: no JSON in response");
  // Strip // comments the model may echo back from the prompt.
  const raw = JSON.parse(content.slice(start, end + 1).replace(/\/\/[^\n"]*$/gm, ""));
  const str = (v: unknown) => (typeof v === "string" && v && v !== "null" ? v : undefined);
  return {
    caption: str(raw.caption),
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t: unknown) => typeof t === "string").slice(0, 8) : [],
    venue: str(raw.venue),
    faces: (raw.faces ?? []).map((f: { box: unknown }) => ({ box: toBox(f.box) })).filter((f: { box: Box | null }) => f.box),
    text: (raw.text ?? [])
      .map((t: { text: unknown; box: unknown }) => ({ text: String(t.text ?? "").trim(), box: toBox(t.box) }))
      .filter((t: { box: Box | null; text: string }) => t.box && t.text)
      .slice(0, 60),
    objects: (raw.objects ?? [])
      .map((s: { label: unknown; box: unknown }) => ({ label: String(s.label ?? "thing").toLowerCase().trim(), box: toBox(s.box) }))
      .filter((s: { box: Box | null; label: string }) => s.box && s.label)
      .slice(0, 20),
  };
}

function toBox(v: unknown): Box | null {
  if (!Array.isArray(v) || v.length !== 4 || v.some((n) => typeof n !== "number")) return null;
  const scale = v.some((n) => n > 1) ? 1000 : 1;
  const [x1, y1, x2, y2] = v.map((n) => clamp(n / scale, 0, 1));
  if (x2 <= x1 || y2 <= y1) return null;
  return [x1, y1, x2, y2];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
