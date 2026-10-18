import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { authorizeWebhook, parseInbound, photon } from "@/lib/photon";
import { answerText, HELP } from "@/lib/texts";
import { connectFromMessage } from "@/lib/notifications";

/**
 * Inbound Photon 2.0 `message.received` events (Standard Webhooks),
 * and the local `{from, text}` simulator.
 * The sender's number is used for this one reply and never stored.
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
  let reply = await connectFromMessage(inbound.message);
  if (reply === null) {
    try {
      reply = await answerText(text);
    } catch (e) {
      console.warn("[backboard]", (e as Error).message);
      reply = HELP;
    }
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
