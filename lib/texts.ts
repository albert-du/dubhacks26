import { backboard, textAssistantName, type ToolDef, type ToolHandler } from "./ai-backboard";
import { clampTtl, parseCommand } from "./commands";
import { createDumpster, dumpsterIdFrom, dumpsterUrl, getLiveDumpster } from "./dumpsters";
import { cols } from "./mongo";
import { fireRank } from "./reactions";

/**
 * Photon texts that aren't the fixed "create dumpster …" command.
 * Each turn creates an assistant and deletes it before returning, so the
 * message, the thread, and any memories do not outlive the reply.
 * The sender's number never enters this module.
 */

export const HELP = `DUMP 🗑️ commands:
• create dumpster "Mt. Si Hike" 48h  (24, 48 or 72h)
• help
• or just say what you want, like "open one for the hike, two days"`;

const TEXT_PROMPT = `You turn a text message into a dumpster action.
Use create_dumpster to open one, or dumpster_status when the message has a dumpster link or id.
Reply in under 320 characters of plain text and include the link the tool returned.
If you can't tell what they want, tell them they can create a dumpster or paste its link.
Hours are only 24, 48, or 72. Never ask for or repeat a phone number.`;

const TEXT_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "create_dumpster",
      description: "Open a new anonymous dumpster. Hours must be 24, 48, or 72; anything else becomes 24.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short name of the event." },
          hours: { type: "integer", description: "24, 48, or 72." },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dumpster_status",
      description: "Look up a live dumpster from its link or id. Returns counts and the link, nothing about people.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "A dumpster link or id." },
        },
        required: ["ref"],
      },
    },
  },
];

export function formatCreated(input: { name: string; ttlHours: number; id: string; expiresAt: Date }) {
  const url = dumpsterUrl(input.id);
  return [
    `🗑️ Dumpster "${input.name}" is open for ${input.ttlHours}h.`,
    `Share: ${url}`,
    `QR for the venue: ${url}/stage`,
    `Everything self-destructs ${input.expiresAt.toUTCString()}.`,
  ].join("\n");
}

export async function answerText(text: string): Promise<string> {
  const cmd = parseCommand(text);
  if (cmd.type === "create") {
    const dumpster = await createDumpster({ name: cmd.name, ttlHours: cmd.ttlHours });
    return formatCreated({ name: dumpster.name, ttlHours: cmd.ttlHours, id: dumpster._id, expiresAt: dumpster.expiresAt });
  }
  if (cmd.type === "help" || !backboard.enabled()) return HELP;

  const assistant = await backboard.createAssistant({
    name: textAssistantName(),
    systemPrompt: TEXT_PROMPT,
    tools: TEXT_TOOLS,
  });
  const session = textSession();
  try {
    const thread = await backboard.createThread(assistant.assistantId);
    const turn = await backboard.run({
      content: text.slice(0, 500),
      tools: TEXT_TOOLS,
      dispatch: session.dispatch,
      assistantId: assistant.assistantId,
      threadId: thread.threadId,
      systemPrompt: TEXT_PROMPT,
      memory: "off",
      ephemeralAssistantId: assistant.assistantId,
    });
    let reply = (turn.content || HELP).slice(0, 600);
    for (const url of session.links) if (!reply.includes(url)) reply = `${reply}\n${url}`.slice(0, 700);
    return reply;
  } finally {
    await backboard.forgetOne(assistant.assistantId);
  }
}

function textSession() {
  const links: string[] = [];
  const dispatch: ToolHandler = async (name, args) => {
    if (name === "create_dumpster") {
      const rawName = String(args.name ?? "").trim();
      if (!rawName) return { error: "name is required" };
      const ttlHours = clampTtl(Number(args.hours ?? 24));
      const dumpster = await createDumpster({ name: rawName, ttlHours });
      const url = dumpsterUrl(dumpster._id);
      links.push(url);
      return { name: dumpster.name, hours: ttlHours, url, stage: `${url}/stage`, burnsAt: dumpster.expiresAt.toISOString() };
    }
    if (name === "dumpster_status") {
      const status = await dumpsterStatus(String(args.ref ?? ""));
      if ("url" in status && status.url) links.push(status.url);
      return status;
    }
    return { error: `unknown tool ${name}` };
  };
  return { dispatch, links };
}

async function dumpsterStatus(ref: string) {
  const id = dumpsterIdFrom(ref);
  if (!id) return { error: "no dumpster id in that message" };
  const d = await getLiveDumpster(id);
  if (!d) return { error: "that dumpster has burned or never existed" };
  const { media } = await cols();
  const shots = await media
    .find({ dumpsterId: id, status: "ready" }, { projection: { reactions: 1, createdAt: 1 } })
    .limit(500)
    .toArray();
  const top = fireRank(shots.map((m) => ({ reactions: m.reactions, createdAt: m.createdAt })))[0];
  return {
    name: d.name,
    photos: shots.length,
    topFire: top?.reactions.fire ?? 0,
    burnsAt: d.expiresAt.toISOString(),
    url: dumpsterUrl(d._id),
  };
}
