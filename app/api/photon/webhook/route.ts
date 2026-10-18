import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { parseCommand } from "@/lib/commands";
import { config } from "@/lib/config";
import { createDumpster, dumpsterUrl } from "@/lib/dumpsters";
import { normalizePhone, photon } from "@/lib/photon";

const HELP = `DUMP 🗑️ commands:
• create dumpster "Mt. Si Hike" 48h  (24, 48 or 72h)
• help`;

function authorized(req: Request) {
  const secret = config.photon.webhookSecret;
  const got = req.headers.get("x-photon-secret") ?? "";
  if (!secret) return process.env.NODE_ENV !== "production";
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Photon 2.0 inbound messages: text-to-create.
 * Accepts {from, text} (or {sender, message}); VERIFY field names against Photon's webhook payload.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const body = await req.json().catch(() => ({}));
  const from = normalizePhone(String(body.from ?? body.sender ?? ""));
  const text = String(body.text ?? body.message ?? body.body ?? "");
  if (!from) return NextResponse.json({ error: "missing sender" }, { status: 400 });

  const cmd = parseCommand(text);
  let reply: string;
  if (cmd.type === "create") {
    // The sender's number is used for this one reply and never stored with the dumpster.
    const dumpster = await createDumpster({ name: cmd.name, ttlHours: cmd.ttlHours });
    const url = dumpsterUrl(dumpster._id);
    reply = [
      `🗑️ Dumpster "${dumpster.name}" is open for ${cmd.ttlHours}h.`,
      `Share: ${url}`,
      `QR for the venue: ${url}/stage`,
      `Everything self-destructs ${dumpster.expiresAt.toUTCString()}.`,
    ].join("\n");
  } else {
    reply = HELP;
  }
  await photon.send(from, reply);
  return NextResponse.json({ ok: true, reply });
}
