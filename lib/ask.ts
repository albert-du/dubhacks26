import { backboard, dumpsterAssistantName, type ToolDef, type ToolHandler } from "./ai-backboard";
import { cols } from "./mongo";
import { matchFields, tokenize, type MatchSource } from "./search";
import type { Dumpster, Media } from "./types";

/**
 * Ask the dump: one Backboard assistant per dumpster, with tools that search
 * captions, objects, writing, speech, names and places. The model only sees
 * those fields. Face vectors, phones and files stay in Mongo.
 */

const ASK_PROMPT = `You answer questions about one dumpster's photos and videos.
Call search_dump with the words that must all appear somewhere in a shot (objects, writing, speech, names, places, tags).
Then call show with the matching ids and one short sentence.
Use only ids search_dump returned. If nothing matches, call show with an empty ids list and say so.
Do not invent shots. Do not ask for phone numbers, faces, or exact locations.`;

export type ShotCard = {
  id: string;
  caption?: string;
  tags: string[];
  venue?: string;
  objects: string[];
  text: string[];
  speech?: string;
  people: string[];
  mentions: string[];
  fire: number;
};

const searchTool: ToolDef = {
  type: "function",
  function: {
    name: "search_dump",
    description: "Find shots where every word appears in the caption, objects, writing, speech, names, place, or tags.",
    parameters: {
      type: "object",
      properties: {
        words: { type: "array", items: { type: "string" }, description: "Words that must all match. One word per entry." },
      },
      required: ["words"],
    },
  },
};

const showTool: ToolDef = {
  type: "function",
  function: {
    name: "show",
    description: "Finish the question. ids are the shots to show. answer is one sentence for the person asking.",
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Shot ids from search_dump." },
        answer: { type: "string", description: "One short sentence." },
      },
      required: ["ids", "answer"],
    },
  },
};

export const ASK_TOOLS: ToolDef[] = [searchTool, showTool];

export function shotFromMedia(m: Media, names: Map<string, string>): ShotCard {
  const people = [...new Set(m.faces.map((f) => (f.clusterId ? names.get(f.clusterId) : undefined)).filter((n): n is string => !!n))];
  return {
    id: m._id,
    caption: m.caption,
    tags: m.tags ?? [],
    venue: m.venue,
    objects: (m.objects ?? []).map((o) => o.label),
    text: (m.text ?? []).map((t) => t.text),
    speech: m.transcript,
    people,
    mentions: m.mentions ?? [],
    fire: m.reactions?.fire ?? 0,
  };
}

function shotFields(c: ShotCard): Record<MatchSource, string> {
  return {
    objects: c.objects.join(" "),
    text: c.text.join(" "),
    speech: c.speech ?? "",
    people: [...c.people, ...c.mentions].join(" "),
    place: c.venue ?? "",
    tags: [c.caption ?? "", ...c.tags].join(" "),
  };
}

function clip(value: string | undefined, max: number) {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** AND-match across a shot, same rules as the on-screen word search. */
export function searchShots(cards: ShotCard[], words: unknown, limit = 12) {
  const list = Array.isArray(words) ? words.map((w) => String(w)) : [];
  const query = list.join(" ");
  if (!tokenize(query).length) return [];
  const hits = [];
  for (const card of cards) {
    const where = matchFields(shotFields(card), query);
    if (!where?.length) continue;
    hits.push({
      id: card.id,
      where,
      caption: clip(card.caption, 140),
      venue: card.venue,
      fire: card.fire,
      objects: card.objects.slice(0, 8),
      text: clip(card.text.join(" "), 180),
      speech: clip(card.speech, 180),
      people: [...card.people, ...card.mentions].slice(0, 8),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

export type DumpSession = {
  tools: ToolDef[];
  dispatch: ToolHandler;
  shown: () => { ids: string[]; answer: string } | null;
  lastIds: () => string[];
};

export function createDumpSession(cards: ShotCard[]): DumpSession {
  const allowed = new Set(cards.map((c) => c.id));
  let shown: { ids: string[]; answer: string } | null = null;
  let lastIds: string[] = [];
  const dispatch: ToolHandler = (name, args) => {
    if (name === "search_dump") {
      const hits = searchShots(cards, args.words);
      lastIds = hits.map((h) => h.id);
      return { hits };
    }
    if (name === "show") {
      const ids = [...new Set((Array.isArray(args.ids) ? args.ids : []).map((id) => String(id)).filter((id) => allowed.has(id)))].slice(0, 40);
      shown = { ids, answer: String(args.answer ?? "").slice(0, 400) };
      return { shown: ids.length };
    }
    return { error: `unknown tool ${name}` };
  };
  return { tools: ASK_TOOLS, dispatch, shown: () => shown, lastIds: () => lastIds };
}

export async function askDumpster(d: Dumpster, question: string): Promise<{ answer: string; ids: string[] }> {
  const cards = await loadShots(d._id);
  const session = createDumpSession(cards);
  const link = await ensureLink(d);
  const turn = await backboard.run({
    content: `Dumpster: ${d.name}\nShots: ${cards.length}\nQuestion: ${question}`,
    tools: session.tools,
    dispatch: session.dispatch,
    assistantId: link.assistantId,
    threadId: link.threadId,
    systemPrompt: ASK_PROMPT,
    memory: "off",
  });
  const picked = session.shown();
  const ids = picked?.ids ?? session.lastIds();
  const answer = (picked?.answer || turn.content || "Nothing in the dump matched.").slice(0, 400);
  return { answer, ids };
}

async function loadShots(dumpsterId: string): Promise<ShotCard[]> {
  const { media, clusters } = await cols();
  const [list, clusterList] = await Promise.all([
    media.find({ dumpsterId, status: "ready" }, { projection: { "faces.embedding": 0 } }).sort({ createdAt: -1 }).limit(500).toArray(),
    clusters.find({ dumpsterId }, { projection: { centroid: 0, exemplars: 0 } }).toArray(),
  ]);
  const names = new Map<string, string>();
  for (const c of clusterList) if (c.name) names.set(c._id, c.name);
  return list.map((m) => shotFromMedia(m, names));
}

async function ensureLink(d: Dumpster): Promise<{ assistantId: string; threadId: string }> {
  if (d.backboard?.assistantId && d.backboard.threadId) return d.backboard;
  const { dumpsters } = await cols();
  const created = await backboard.createAssistant({
    name: dumpsterAssistantName(d._id),
    systemPrompt: ASK_PROMPT,
    tools: ASK_TOOLS,
  });
  let stored = false;
  try {
    const thread = await backboard.createThread(created.assistantId);
    const link = { assistantId: created.assistantId, threadId: thread.threadId };
    const saved = await dumpsters.updateOne({ _id: d._id, backboard: { $exists: false } }, { $set: { backboard: link } });
    if (saved.modifiedCount) {
      stored = true;
      return link;
    }
    const winner = await dumpsters.findOne({ _id: d._id }, { projection: { backboard: 1 } });
    if (winner?.backboard?.assistantId && winner.backboard.threadId) return winner.backboard;
    throw new Error("dumpster is gone");
  } finally {
    if (!stored) await backboard.forgetOne(created.assistantId);
  }
}
