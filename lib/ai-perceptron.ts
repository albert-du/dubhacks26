import OpenAI from "openai";
import { config } from "./config";
import type { Box, DetectedObject } from "./types";

/**
 * Perceptron Mk1.5 vision adapter. One chat completion per image returns
 * objects, people, faces, OCR lines, a caption, scene tags, and venue text.
 *
 * Checked against https://docs.perceptron.inc/perceptron-mk1.5 (2026-10-17):
 * POST /v1/chat/completions is the OpenAI-compatible API, and an image_url
 * part accepts a base64 data URL. Grounded boxes are <point_box> markup in
 * choices[0].message.content on a 0–1000 grid (top-left, then bottom-right),
 * requested with vision_config.annotation_format "box". isaac-0.1 returns
 * 404 model_not_found. /v1/detect returns pixel coordinates and is not used.
 * JSON schema responses do not carry those boxes, so caption fields stay in
 * a JSON object beside the markup. Coordinates outside 0–1000 are dropped.
 */

export interface VisionResult {
  caption?: string;
  tags: string[];
  venue?: string;
  faces: { box: Box }[];
  text: { text: string; box: Box }[];
  objects: DetectedObject[];
}

// Keep the examples abstract: a concrete example noun (it used to be "cake") gets copied
// into photos that don't contain it.
const PROMPT = `Label this photo. Reply with a JSON object first, then flat point_box annotations. Do not use collections, tracks, points, or polygons.

{"caption":"one short playful sentence about what is actually happening","tags":["up to 8 lowercase scene or activity tags"],"venue":"venue, landmark, or event signage name visible in the image, or null"}

Only label what you can clearly see in this image. Never guess, never infer things from the setting, and leave out anything you are unsure of. An empty list is fine.

After the JSON, emit one <point_box> per item. Quote mention, set asset_idx="0", and use a normalized 0-1000 grid: top-left corner, then bottom-right.
- Every human face, including people in the background: mention="face"
- Every clearly visible primary object and every person, most prominent first, at most 20. People are mention="object:person". Other objects are mention="object:<lowercase noun>".
- Every legible line of text on a sign, shirt, banner, or label: mention="text:<exact text as written>". Skip text that is too small or obscured to read.

Format only (the words in angle brackets are placeholders, not content):
<point_box mention="face" asset_idx="0"> (x1,y1) (x2,y2) </point_box>
<point_box mention="object:<noun>" asset_idx="0"> (x1,y1) (x2,y2) </point_box>
<point_box mention="text:<exact text>" asset_idx="0"> (x1,y1) (x2,y2) </point_box>`;

export const perceptron = {
  enabled: () => !!config.perceptron.apiKey,

  async analyze(jpeg: Buffer): Promise<VisionResult> {
    if (!config.perceptron.apiKey) throw new Error("perceptron is not configured");
    // The OpenAI SDK is a client for Perceptron's compatible API, not OpenAI hosting.
    const client = new OpenAI({
      apiKey: config.perceptron.apiKey,
      baseURL: config.perceptron.baseUrl,
      timeout: 60_000,
      maxRetries: 0,
    });
    const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
      vision_config: { annotation_format: "box" };
    } = {
      model: config.perceptron.model,
      temperature: 0,
      reasoning_effort: "high",
      max_completion_tokens: 8192,
      vision_config: { annotation_format: "box" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    };
    const completion = await client.chat.completions.create(request).catch((error: unknown) => {
      if (error instanceof OpenAI.APIError) throw new Error(`perceptron ${error.status ?? "request failed"}`);
      throw error;
    });
    return parseVision(visionContent(completion));
  },
};

/** Final answer only. Reasoning stays in message.reasoning_content and is ignored. */
export function visionContent(body: unknown): string {
  const root = record(body);
  const choices = Array.isArray(root?.choices) ? root.choices : [];
  const first = record(choices[0]);
  const message = record(first?.message);
  const calledTool = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
  if (first?.finish_reason !== "stop" || calledTool) {
    const label = calledTool ? "tool_calls" : typeof first?.finish_reason === "string" ? first.finish_reason : "none";
    throw new Error(`perceptron: incomplete response (${label})`);
  }
  return typeof message?.content === "string" ? message.content : "";
}

export function parseVision(content: string): VisionResult {
  const { boxes, prose } = extractPointBoxes(content);
  const raw = parseJsonObject(prose);
  const meta = {
    caption: str(raw?.caption),
    tags: Array.isArray(raw?.tags) ? raw.tags.filter((t: unknown) => typeof t === "string").slice(0, 8) : [],
    venue: str(raw?.venue),
  };
  if (boxes.length) return { ...meta, ...fromMarkup(boxes) };
  if (!raw) throw new Error("perceptron: no JSON or point_box annotations in response");
  return {
    ...meta,
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

interface ParsedBox {
  mention?: string;
  box: Box;
}

function extractPointBoxes(content: string): { boxes: ParsedBox[]; prose: string } {
  const boxes: ParsedBox[] = [];
  const kept: string[] = [];
  const lower = content.toLowerCase();
  let i = 0;
  while (i < content.length) {
    const start = lower.indexOf("<point_box", i);
    if (start < 0) {
      kept.push(content.slice(i));
      break;
    }
    const afterName = start + "<point_box".length;
    const boundary = content[afterName];
    if (boundary !== undefined && boundary !== ">" && boundary !== "/" && !/\s/.test(boundary)) {
      kept.push(content.slice(i, afterName));
      i = afterName;
      continue;
    }
    const tagEnd = scanTagEnd(content, afterName);
    if (tagEnd < 0) {
      kept.push(content.slice(i));
      break;
    }
    const attrs = content.slice(afterName, tagEnd);
    if (attrs.trimEnd().endsWith("/")) {
      kept.push(content.slice(i, tagEnd + 1));
      i = tagEnd + 1;
      continue;
    }
    const close = lower.indexOf("</point_box>", tagEnd + 1);
    if (close < 0) {
      kept.push(content.slice(i));
      break;
    }
    kept.push(content.slice(i, start));
    const box = boxFromGrid(content.slice(tagEnd + 1, close));
    const assetIdx = readAttr(attrs, "asset_idx");
    if (box && (assetIdx === undefined || assetIdx === "0")) {
      boxes.push({ mention: readAttr(attrs, "mention"), box });
    }
    i = close + "</point_box>".length;
  }
  return { boxes, prose: kept.join("") };
}

function scanTagEnd(content: string, from: number): number {
  let quote: string | null = null;
  for (let j = from; j < content.length; j++) {
    const c = content[j];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === ">") return j;
  }
  return -1;
}

function readAttr(raw: string, name: string): string | undefined {
  const quoted = raw.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  if (quoted) return quoted[1] ?? quoted[2] ?? "";
  const bare = raw.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*([^\\s"'=<>]+)`, "i"));
  return bare?.[1];
}

/** Markup coordinates are always the 0–1000 grid, even when both corners are below 1. */
function boxFromGrid(body: string): Box | null {
  const pairs = [...body.matchAll(/\(\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*\)/g)];
  if (pairs.length !== 2) return null;
  const nums = pairs.flatMap((pair) => [Number(pair[1]), Number(pair[2])]);
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 1000)) return null;
  const [x1, y1, x2, y2] = nums;
  if (!(x2 > x1 && y2 > y1)) return null;
  return [x1 / 1000, y1 / 1000, x2 / 1000, y2 / 1000];
}

/** The prompt's format template leaking back as content ("<noun>", "<exact text>"). */
const isPlaceholder = (s: string) => /^<[^<>]*>$/.test(s.trim()) || /^(noun|lowercase noun|exact text)$/i.test(s.trim());

function fromMarkup(boxes: ParsedBox[]): Pick<VisionResult, "faces" | "text" | "objects"> {
  const faces: VisionResult["faces"] = [];
  const text: VisionResult["text"] = [];
  const objects: VisionResult["objects"] = [];
  for (const { mention, box } of boxes) {
    if (!mention?.trim()) continue;
    const raw = mention.trim();
    const lower = raw.toLowerCase();
    if (lower === "face") {
      faces.push({ box });
      continue;
    }
    if (lower.startsWith("text:")) {
      const line = raw.slice(lower.indexOf(":") + 1).trim();
      if (line && !isPlaceholder(line)) text.push({ text: line, box });
      continue;
    }
    const label = (lower.startsWith("object:") ? raw.slice(lower.indexOf(":") + 1) : raw).trim().toLowerCase();
    if (label && !isPlaceholder(label)) objects.push({ label, box });
  }
  return { faces, text: text.slice(0, 60), objects: objects.slice(0, 20) };
}

function parseJsonObject(content: string): Record<string, any> | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const raw = JSON.parse(content.slice(start, end + 1).replace(/\/\/[^\n"]*$/gm, ""));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

function toBox(v: unknown): Box | null {
  if (!Array.isArray(v) || v.length !== 4 || v.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  const scale = v.some((n) => n > 1) ? 1000 : 1;
  const [x1, y1, x2, y2] = v.map((n) => clamp(n / scale, 0, 1));
  if (x2 <= x1 || y2 <= y1) return null;
  return [x1, y1, x2, y2];
}

const str = (v: unknown) => (typeof v === "string" && v && v !== "null" ? v : undefined);
const record = (v: unknown) => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
