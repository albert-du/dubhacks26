import { NextResponse } from "next/server";
import { parseCommand } from "@/lib/commands";
import { config } from "@/lib/config";
import { createDumpster, roomUrl } from "@/lib/dumpsters";
import { authorizeWebhook, parseInbound, photon } from "@/lib/photon";

const HELP = `DUMP 🗑️ commands:
• create dumpster "Mt. Si Hike" 48h  (24, 48 or 72h)
• help`;

/**
 * Inbound Photon 2.0 `message.received` events (Standard Webhooks),
 * and the local `{from, text}` simulator.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!authorizeWebhook({ headers: req.headers, rawBody, secret: config.photon.webhookSecret, nodeEnv: process.env.NODE_ENV })) {
    return new Response("unauthorized", { status: 401 });
  }
  const body = parseJson(rawBody);
  const inbound = parseInbound(body);
  if (inbound.kind === "ignore") return NextResponse.json({ ok: true, ignored: true });
  if (inbound.kind === "invalid") return NextResponse.json({ error: inbound.error }, { status: 400 });

  const { from, text, spaceId, agentUserId, messageId } = inbound.message;
  const cmd = parseCommand(text);
  let reply: string;
  if (cmd.type === "create") {
    const { dumpster } = await createDumpster({ name: cmd.name, ttlHours: cmd.ttlHours, hostPhone: from });
    const url = roomUrl(dumpster._id);
    reply = [
      `🗑️ Dumpster "${dumpster.name}" is open for ${cmd.ttlHours}h.`,
      `Share: ${url}`,
      `QR for the venue: ${url}/stage`,
      `Everything self-destructs ${dumpster.expiresAt.toUTCString()}.`,
    ].join("\n");
  } else {
    reply = HELP;
  }
  await photon.reply({
    to: from,
    text: reply,
    spaceId,
    senderId: agentUserId,
    parentMessageId: messageId,
    idempotencyKey: messageId ? `reply:${messageId}` : undefined,
  });
  return NextResponse.json({ ok: true, reply });
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}
