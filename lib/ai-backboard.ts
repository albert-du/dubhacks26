import { nanoid } from "nanoid";
import { config } from "./config";

/**
 * Backboard (https://app.backboard.io/api) is the language layer.
 * Ask-the-dump keeps one assistant per dumpster. A text that isn't a fixed
 * command gets a throwaway assistant. Live photo updates stay on the SSE feed.
 *
 * Auth is the X-API-Key header. Threads persist until deleted, so every path
 * that stores a conversation also has a delete.
 */

const TEXT_ASSISTANT_PREFIX = "dump-text-";
const TEXT_ASSISTANT_MAX_AGE_MS = 10 * 60_000;
const MAX_TOOL_ROUNDS = 4;

export type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description?: string; items?: { type: string } }>;
      required?: string[];
    };
  };
};

export type ToolHandler = (name: string, args: Record<string, unknown>) => Promise<unknown> | unknown;

type Turn = {
  status?: string;
  thread_id?: string;
  assistant_id?: string;
  content?: string | null;
  tool_calls?: { id?: string; function?: { name?: string; arguments?: string | Record<string, unknown> } }[];
};

export function backboardEnabled() {
  return !!config.backboard.apiKey;
}

export function dumpsterAssistantName(dumpsterId: string) {
  return `dumpster-${dumpsterId}`;
}

/** Throwaway text assistants older than this are safe to delete. */
export function isStaleTextAssistant(name: string, createdAt: string, now = Date.now()) {
  if (!name.startsWith(TEXT_ASSISTANT_PREFIX)) return false;
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && now - created > TEXT_ASSISTANT_MAX_AGE_MS;
}

export const backboard = {
  enabled: backboardEnabled,

  async createAssistant(input: { name: string; systemPrompt: string; tools: ToolDef[] }) {
    const data = await call("POST", "/assistants", {
      name: input.name.slice(0, 255),
      system_prompt: input.systemPrompt,
      tools: input.tools,
    });
    const assistantId = str(data, "assistant_id");
    if (!assistantId) throw new Error("backboard create assistant returned no id");
    return { assistantId };
  },

  async createThread(assistantId: string) {
    const data = await call("POST", `/assistants/${assistantId}/threads`, {});
    const threadId = str(data, "thread_id");
    if (!threadId) throw new Error("backboard create thread returned no id");
    return { threadId };
  },

  /**
   * Send one message and fulfill tool calls until the model replies.
   * `ephemeralAssistantId` is an assistant this process just created; it is
   * deleted, with its memories and threads, when the turn finishes.
   */
  async run(input: {
    content: string;
    tools: ToolDef[];
    dispatch: ToolHandler;
    assistantId?: string;
    threadId?: string;
    systemPrompt?: string;
    memory?: "off";
    ephemeralAssistantId?: string;
  }): Promise<{ content: string; assistantId?: string; threadId?: string }> {
    try {
      let turn = (await call("POST", "/threads/messages", {
        content: input.content,
        tools: input.tools,
        stream: false,
        memory: input.memory ?? "off",
        ...(input.assistantId ? { assistant_id: input.assistantId } : {}),
        ...(input.threadId ? { thread_id: input.threadId } : {}),
        ...(input.systemPrompt ? { system_prompt: input.systemPrompt } : {}),
      })) as Turn;

      for (let round = 0; round < MAX_TOOL_ROUNDS && needsAction(turn); round++) {
        const outputs = [];
        for (const tc of turn.tool_calls ?? []) {
          const name = tc.function?.name ?? "";
          let output: unknown;
          try {
            output = await input.dispatch(name, parseArgs(tc.function?.arguments));
          } catch (e) {
            output = { error: (e as Error).message.slice(0, 200) };
          }
          outputs.push({ tool_call_id: tc.id, output: JSON.stringify(output).slice(0, 12_000) });
        }
        if (!turn.thread_id) break;
        turn = (await call("POST", "/threads/tool-outputs", {
          thread_id: turn.thread_id,
          tool_outputs: outputs,
          stream: false,
        })) as Turn;
      }

      return {
        content: (turn.content ?? "").trim(),
        assistantId: turn.assistant_id ?? input.assistantId,
        threadId: turn.thread_id ?? input.threadId,
      };
    } finally {
      if (input.ephemeralAssistantId) await forgetAssistant(input.ephemeralAssistantId);
    }
  },

  /** Delete one assistant, its memories, and (by Backboard's rules) its threads. */
  async forgetOne(assistantId: string) {
    await forgetAssistant(assistantId);
  },

  /** Delete one dumpster's assistant, wherever it was recorded, plus any aged text assistants. */
  async forgetDumpster(dumpsterId: string, saved?: { assistantId: string } | null) {
    if (!backboardEnabled()) return;
    const ids = new Set<string>();
    if (saved?.assistantId) ids.add(saved.assistantId);
    const want = dumpsterAssistantName(dumpsterId);
    for (const row of await listAssistants()) {
      if (row.name === want && row.assistantId) ids.add(row.assistantId);
    }
    for (const id of ids) await forgetAssistant(id);
    await this.sweepTextAssistants();
  },

  async sweepTextAssistants(now = Date.now()) {
    if (!backboardEnabled()) return;
    for (const row of await listAssistants()) {
      if (row.assistantId && isStaleTextAssistant(row.name, row.createdAt, now)) await forgetAssistant(row.assistantId);
    }
  },
};

export function textAssistantName() {
  return `${TEXT_ASSISTANT_PREFIX}${nanoid(10)}`;
}

async function forgetAssistant(assistantId: string) {
  await callQuiet("DELETE", `/assistants/${assistantId}/memories`);
  await callQuiet("DELETE", `/assistants/${assistantId}`);
}

async function listAssistants(): Promise<{ assistantId: string; name: string; createdAt: string }[]> {
  const out: { assistantId: string; name: string; createdAt: string }[] = [];
  try {
    for (let skip = 0; skip < 500; skip += 100) {
      const data = await call("GET", `/assistants?skip=${skip}&limit=100`);
      const rows = unwrapList(data);
      if (!rows.length) break;
      for (const row of rows) {
        const assistantId = str(row, "assistant_id");
        if (assistantId) out.push({ assistantId, name: str(row, "name") ?? "", createdAt: str(row, "created_at") ?? "" });
      }
      if (rows.length < 100) break;
    }
  } catch (e) {
    console.warn("[backboard] list assistants:", (e as Error).message);
  }
  return out;
}

async function call(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const key = config.backboard.apiKey;
  if (!key) throw new Error("backboard is not configured");
  const res = await fetch(`${config.backboard.url}${path}`, {
    method,
    headers: { "content-type": "application/json", "X-API-Key": key },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`backboard ${method} ${path} -> ${res.status}`);
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

async function callQuiet(method: string, path: string) {
  try {
    await call(method, path);
  } catch (e) {
    const msg = (e as Error).message;
    if (!msg.endsWith("404")) console.warn("[backboard]", msg);
  }
}

function needsAction(turn: Turn) {
  return String(turn.status ?? "").toUpperCase() === "REQUIRES_ACTION" && !!turn.tool_calls?.length;
}

function parseArgs(raw: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(row: Record<string, unknown> | unknown, key: string) {
  if (!row || typeof row !== "object") return undefined;
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : undefined;
}

function unwrapList(data: Record<string, unknown>): Record<string, unknown>[] {
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data.assistants)
      ? data.assistants
      : Array.isArray(data.data)
        ? data.data
        : [];
  return rows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
}
