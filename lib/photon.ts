import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { HttpError } from "./http";

/**
 * Photon 2.0 (Beta) messaging.
 * https://api.photon.codes/v1 — Users, Spaces, then Messages.
 * A send is accepted with HTTP 202; that does not confirm handset delivery.
 * Without a project id, API key, and agent user id, texts are logged.
 */

const PLATFORMS = ["imessage", "sms", "whatsapp", "whatsapp_business", "telegram", "email"] as const;
export type PhotonPlatform = (typeof PLATFORMS)[number];

const WEBHOOK_TOLERANCE_SEC = 5 * 60;

export type SendOptions = {
  idempotencyKey?: string;
  parentMessageId?: string;
};

export type InboundText = {
  from: string;
  text: string;
  spaceId?: string;
  agentUserId?: string;
  messageId?: string;
  platform?: string;
  spaceKind?: string;
  agentHandle?: string;
  senderUserId?: string;
};

export type InboundParse = { kind: "text"; message: InboundText } | { kind: "ignore" } | { kind: "invalid"; error: string };

type CachedSpace = { userId: string; spaceId: string };
const spaceByHandle = new Map<string, CachedSpace>();

export const photon = {
  configured: () => !!(config.photon.apiKey && config.photon.projectId),
  enabled: () => {
    const p = config.photon;
    return !!(p.apiKey && p.projectId && p.agentUserId);
  },

  /** Read the manually provisioned roster. This never allocates a shared-line slot. */
  async imessageAssignment(handle: string): Promise<string | null> {
    const { apiKey, projectId, baseUrl } = config.photon;
    if (!photon.configured()) throw new Error("Photon is not configured");
    const res = await fetch(`${baseUrl}/projects/${projectId}/platforms/imessage/assignments?pageSize=200`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Photon assignment lookup failed (${res.status})`);
    const body = await res.json() as { assignments?: { handle: string; assignedPhoneNumber: string }[] };
    const assignment = body.assignments?.find((a) => normalizePhone(a.handle) === handle);
    return assignment ? normalizePhone(assignment.assignedPhoneNumber) : null;
  },

  /** Reuse a seat or register this number; Photon enforces the project's seat cap atomically. */
  async ensureImessageAssignment(handle: string): Promise<string> {
    const existing = await photon.imessageAssignment(handle);
    if (existing) return existing;
    const { apiKey, projectId, baseUrl } = config.photon;
    const res = await fetch(`${baseUrl}/projects/${projectId}/platforms/imessage/assignments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`, "content-type": "application/json",
        "idempotency-key": `demo-register-${createHmac("sha256", apiKey!).update(`${projectId}:${handle}`).digest("hex")}`,
      },
      body: JSON.stringify({ handle }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json() as { assignedPhoneNumber?: string; code?: string };
    if (res.ok) {
      const number = body.assignedPhoneNumber && normalizePhone(body.assignedPhoneNumber);
      if (number) return number;
      throw new HttpError(502, "Your number is being registered. Please try again shortly.");
    }
    if (body.code === "ASSIGNMENT_EXISTS") {
      const number = await photon.imessageAssignment(handle);
      if (number) return number;
    }
    if (body.code === "SHARED_LINE_CAP_EXCEEDED") {
      throw new HttpError(409, "All demo iMessage slots are in use. You can still join a Dumpster with its link or QR code.");
    }
    if (res.status === 429) throw new HttpError(429, "Too many requests. Please wait a moment and try again.");
    if (res.status === 422) throw new HttpError(422, "Photon couldn’t register this number. Check the number and country code.");
    throw new HttpError(503, "iMessage registration isn’t available right now. Please try again shortly.");
  },

  /** Open or reuse a DM, then send plain text from the configured agent. */
  async send(to: string, text: string, options: SendOptions = {}): Promise<void> {
    const body = text.trim();
    if (!body) return;
    if (!photon.enabled()) {
      console.log(`[photon:dev] -> ${maskPhone(to)}: ${body}`);
      return;
    }
    const handle = recipientHandle(to);
    const platform = photonPlatform();
    const agentId = config.photon.agentUserId!;
    const cached = await directSpace(platform, handle, agentId);
    await postMessage({
      spaceId: cached.spaceId,
      senderId: agentId,
      text: body,
      parentMessageId: options.parentMessageId,
      idempotencyKey: options.idempotencyKey,
    });
  },

  /** Reply in a space Photon already delivered, or open one when the event has no space. */
  async reply(input: SendOptions & { text: string; to?: string; spaceId?: string; senderId?: string }): Promise<void> {
    const body = input.text.trim();
    if (!body) return;
    if (!photon.configured() || !(input.senderId || config.photon.agentUserId)) {
      console.log(`[photon:dev] -> ${maskPhone(input.to ?? input.spaceId ?? "unknown")}: ${body}`);
      return;
    }
    if (input.spaceId) {
      const senderId = input.senderId || config.photon.agentUserId;
      if (!senderId) throw new Error("photon agent user id is not set");
      await postMessage({
        spaceId: input.spaceId,
        senderId,
        text: body,
        parentMessageId: input.parentMessageId,
        idempotencyKey: input.idempotencyKey,
      });
      return;
    }
    if (!input.to) throw new Error("photon reply needs a recipient");
    await photon.send(input.to, body, input);
  },
};

async function directSpace(platform: PhotonPlatform, handle: string, agentId: string): Promise<CachedSpace> {
  const key = `${config.photon.projectId}:${platform}:${handle}`;
  const hit = spaceByHandle.get(key);
  if (hit) return hit;
  const user = await post("/users", { platform, handle }, `user:${platform}:${handle}`);
  const userId = resourceId(user, "user");
  if (userId === agentId) throw new Error("photon recipient resolved to the agent user");
  const space = await post(
    "/spaces",
    { platform, participantIds: [agentId, userId] },
    `space:${platform}:${agentId}:${userId}`,
  );
  const created = { userId, spaceId: resourceId(space, "space") };
  spaceByHandle.set(key, created);
  return created;
}

/** Photon message ids. A parent that is not one of these is omitted so the send still goes out. */
const PHOTON_MESSAGE_ID = /^pho_msg_[0-7][0-9a-hjkmnp-tv-z]{25}$/;

async function postMessage(input: {
  spaceId: string;
  senderId: string;
  text: string;
  parentMessageId?: string;
  idempotencyKey?: string;
}) {
  // A shared iMessage line delivers to someone who already texted it. Replying to
  // that inbound message is what reaches the phone. Some lines reject the thread
  // with 409; the same text is then sent in the Space without a parent.
  const parentMessageId = input.parentMessageId && PHOTON_MESSAGE_ID.test(input.parentMessageId)
    ? input.parentMessageId
    : undefined;
  const content = { type: "text" as const, format: "plain" as const, text: input.text };
  const key = input.idempotencyKey ?? randomUUID();
  const body = {
    spaceId: input.spaceId,
    senderId: input.senderId,
    ...(parentMessageId ? { parentMessageId } : {}),
    content,
  };
  try {
    await post("/messages", body, key);
  } catch (error) {
    if (!parentMessageId || !threadedReplyRejected(error)) throw error;
    await post("/messages", { spaceId: input.spaceId, senderId: input.senderId, content }, directKey(key));
  }
}

function threadedReplyRejected(error: unknown) {
  return error instanceof Error && error.message.startsWith("photon 409:");
}

function directKey(key: string) {
  const suffix = ":direct";
  return (key.length + suffix.length <= 255 ? key : key.slice(0, 255 - suffix.length)) + suffix;
}

async function post(path: string, body: unknown, idempotencyKey: string): Promise<unknown> {
  const { apiKey, projectId, baseUrl } = config.photon;
  const res = await fetch(`${baseUrl}/projects/${projectId}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": asciiKey(idempotencyKey),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`photon ${res.status}: ${raw.slice(0, 200)}`);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

function resourceId(value: unknown, what: string): string {
  if (isRecord(value) && typeof value.id === "string" && value.id) return value.id;
  throw new Error(`photon ${what} response missing id`);
}

function photonPlatform(): PhotonPlatform {
  const platform = config.photon.platform;
  if ((PLATFORMS as readonly string[]).includes(platform)) return platform as PhotonPlatform;
  throw new Error(`photon platform ${platform} is not supported`);
}

function asciiKey(raw: string): string {
  const clean = raw.replace(/[^\x21-\x7e]/g, "").slice(0, 255);
  return clean || randomUUID();
}

/** Never log full phone numbers. */
export function maskPhone(p: string) {
  return p.length > 4 ? `${"*".repeat(p.length - 4)}${p.slice(-4)}` : "****";
}

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  const d = digits.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

export function recipientHandle(input: string): string {
  const handle = asHandle(input);
  if (!handle) throw new Error("photon recipient is not a phone number or email");
  return handle;
}

function asHandle(input: string): string | null {
  const phone = normalizePhone(input);
  if (phone) return phone;
  const email = input.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
  return null;
}

/**
 * Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`),
 * or the local `x-photon-secret` simulator. No secret allows non-production only.
 */
export function authorizeWebhook(input: { headers: Headers; rawBody: string; secret: string | undefined; nodeEnv: string | undefined }): boolean {
  const signature = input.headers.get("webhook-signature");
  if (signature) return !!input.secret && verifyStandardWebhook(input.rawBody, input.headers, input.secret);
  const got = input.headers.get("x-photon-secret") ?? "";
  if (!input.secret) return input.nodeEnv !== "production";
  return safeEqual(got, input.secret);
}

export function verifyStandardWebhook(rawBody: string, headers: Headers, secret: string): boolean {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signature = headers.get("webhook-signature");
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > WEBHOOK_TOLERANCE_SEC) return false;
  const key = webhookKey(secret);
  if (!key) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signature.split(" ").some((part) => {
    const trimmed = part.trim();
    if (!trimmed.startsWith("v1,")) return false;
    const got = Buffer.from(trimmed.slice(3), "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

function webhookKey(secret: string): Buffer | null {
  if (secret.startsWith("whsec_")) {
    const decoded = Buffer.from(secret.slice("whsec_".length), "base64");
    return decoded.length ? decoded : null;
  }
  return Buffer.from(secret);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Photon `message.received` events, plus the `{from, text}` local simulator. */
export function parseInbound(body: unknown): InboundParse {
  if (!isRecord(body)) return { kind: "invalid", error: "missing sender" };
  if (typeof body.type === "string") return parseEvent(body);
  return parseSimple(body);
}

function parseEvent(body: Record<string, unknown>): InboundParse {
  if (body.type !== "message.received") return { kind: "ignore" };
  const data = isRecord(body.data) ? body.data : undefined;
  const object = data && isRecord(data.object) ? data.object : undefined;
  if (!object) return { kind: "invalid", error: "missing message" };
  const sentBy = isRecord(object.sentBy) ? object.sentBy : undefined;
  if (sentBy?.kind === "agent") return { kind: "ignore" };
  if (sentBy?.id && sentBy.id === config.photon.agentUserId) return { kind: "ignore" };
  const text = textFromContent(object.content);
  if (!text) return { kind: "ignore" };
  const from = typeof sentBy?.handle === "string" ? asHandle(sentBy.handle) : null;
  if (!from) return { kind: "invalid", error: "missing sender" };
  const space = isRecord(object.space) ? object.space : undefined;
  const receivedBy = isRecord(object.receivedBy) ? object.receivedBy : undefined;
  return {
    kind: "text",
    message: {
      from,
      text,
      spaceId: typeof space?.id === "string" ? space.id : undefined,
      agentUserId: typeof receivedBy?.id === "string" ? receivedBy.id : undefined,
      messageId: typeof object.id === "string" ? object.id : undefined,
      platform: typeof object.platform === "string" ? object.platform : typeof body.source === "string" ? body.source.split(".")[0] : undefined,
      spaceKind: typeof space?.kind === "string" ? space.kind : undefined,
      agentHandle: typeof receivedBy?.handle === "string" ? asHandle(receivedBy.handle) ?? undefined : undefined,
      senderUserId: typeof sentBy?.id === "string" ? sentBy.id : undefined,
    },
  };
}

function parseSimple(body: Record<string, unknown>): InboundParse {
  const raw = body.from ?? body.sender ?? "";
  const from = asHandle(String(raw));
  if (!from) return { kind: "invalid", error: "missing sender" };
  const text = String(body.text ?? body.message ?? body.body ?? "");
  return { kind: "text", message: { from, text } };
}

function textFromContent(content: unknown): string | null {
  if (!isRecord(content)) return null;
  if (content.type === "text" && typeof content.text === "string") return content.text;
  if (content.type === "group" && Array.isArray(content.parts)) {
    const parts = content.parts
      .filter((part) => isRecord(part) && part.type === "text" && part.format === "plain" && typeof part.text === "string")
      .map((part) => (part as { text: string }).text);
    if (parts.length) return parts.join("\n");
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
