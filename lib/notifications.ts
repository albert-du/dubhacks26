import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { config } from "./config";
import { HttpError } from "./http";
import { cols } from "./mongo";
import { normalizePhone, photon, type InboundText } from "./photon";
import type { Dumpster, Guest, NotificationStatus } from "./types";

const CODE_LIFETIME_MS = 10 * 60_000;
const REQUEST_COOLDOWN_MS = 30_000;
const CONNECTED = "iMessage alerts connected. Go back to Me in your Dumpster to see the status.";
const INVALID_CODE = "That connection code is invalid or expired. In Me, request a new message and send it from the number you entered.";

export function hashConnectionCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export function notificationStatus(guest: Guest, now = new Date()): NotificationStatus {
  if (guest.notification && guest.expiresAt > now) return { state: "connected" };
  if (guest.notificationPending && guest.notificationPending.expiresAt > now && guest.expiresAt > now) {
    return { state: "pending", expiresAt: guest.notificationPending.expiresAt.toISOString() };
  }
  return { state: "disconnected" };
}

export function imessageAvailable() {
  return photon.configured() && config.photon.platform === "imessage";
}

async function ownGuest(d: Dumpster, viewer: string) {
  const { guests } = await cols();
  const guest = await guests.findOne({ dumpsterId: d._id, viewerId: viewer, expiresAt: { $gt: new Date() } });
  if (!guest) throw new HttpError(400, "Save your name in Me before connecting alerts.");
  return guest;
}

export async function getNotificationStatus(d: Dumpster, viewer: string) {
  return { ...notificationStatus(await ownGuest(d, viewer)), available: imessageAvailable() };
}

export async function requestNotificationConnection(d: Dumpster, viewer: string, input: string, now = new Date()) {
  const guest = await ownGuest(d, viewer);
  if (!imessageAvailable()) throw new HttpError(503, "iMessage alerts aren’t available right now.");
  const phone = normalizePhone(input);
  if (!phone) throw new HttpError(400, "Enter your phone number, including its country code.");
  const cutoff = new Date(now.getTime() - REQUEST_COOLDOWN_MS);
  if (guest.notificationRequestedAt && guest.notificationRequestedAt > cutoff) {
    throw new HttpError(429, "Wait 30 seconds before requesting another connection message.");
  }
  const agentNumber = await photon.imessageAssignment(phone);
  if (!agentNumber) throw new HttpError(422, "iMessage alerts are available to registered demo participants. You can still use everything on the website.");
  const code = nanoid(16);
  const expiresAt = new Date(Math.min(now.getTime() + CODE_LIFETIME_MS, d.expiresAt.getTime()));
  const { guests } = await cols();
  const result = await guests.updateOne({
    _id: guest._id,
    viewerId: viewer,
    expiresAt: { $gt: now },
    $or: [{ notificationRequestedAt: { $exists: false } }, { notificationRequestedAt: { $lte: cutoff } }],
  }, {
    $set: { notificationPending: { codeHash: hashConnectionCode(code), phone, agentNumber, expiresAt }, notificationRequestedAt: now },
    $unset: { notification: "", phone: "", expiryWarningSentAt: "", expiryWarningText: "" },
  });
  if (!result.modifiedCount) throw new HttpError(429, "Wait 30 seconds before requesting another connection message.");
  return { state: "pending" as const, expiresAt: expiresAt.toISOString(), agentNumber, message: `connect ${code}` };
}

export async function disconnectNotifications(d: Dumpster, viewer: string) {
  const guest = await ownGuest(d, viewer);
  const { guests } = await cols();
  await guests.updateOne({ _id: guest._id, viewerId: viewer }, {
    $unset: { notification: "", notificationPending: "", phone: "", expiryWarningSentAt: "", expiryWarningText: "" },
  });
  return { state: "disconnected" as const };
}

/** Called only after webhook signature verification. Null leaves ordinary commands unchanged. */
export async function connectFromMessage(message: InboundText, now = new Date()): Promise<string | null> {
  if (!/^connect\b/i.test(message.text.trim())) return null;
  const match = /^connect\s+([A-Za-z0-9_-]{16})$/i.exec(message.text.trim());
  if (!match || message.platform !== "imessage" || message.spaceKind !== "direct" ||
      !message.spaceId || !message.agentUserId || !message.senderUserId || !message.agentHandle || !message.messageId) return INVALID_CODE;
  const phone = normalizePhone(message.from);
  if (!phone) return INVALID_CODE;
  const { guests } = await cols();
  // A repeated webhook returns the same confirmation without consuming the code twice.
  const repeated = await guests.findOne({
    phone, "notification.spaceId": message.spaceId, "notification.connectedMessageId": message.messageId, expiresAt: { $gt: now },
  });
  if (repeated) return CONNECTED;
  const guest = await guests.findOneAndUpdate({
    "notificationPending.codeHash": hashConnectionCode(match[1]),
    "notificationPending.phone": phone,
    "notificationPending.agentNumber": message.agentHandle,
    "notificationPending.expiresAt": { $gt: now },
    expiresAt: { $gt: now },
  }, {
    $set: { phone, notification: {
      spaceId: message.spaceId, agentUserId: message.agentUserId, recipientUserId: message.senderUserId,
      verifiedAt: now, connectedMessageId: message.messageId,
    } },
    $unset: { notificationPending: "", expiryWarningSentAt: "", expiryWarningText: "" },
  }, { returnDocument: "after" });
  return guest ? CONNECTED : INVALID_CODE;
}

/** A provider failure must leave counters pending; missing configuration is not a successful send. */
export async function sendGuestNotification(guest: Guest, text: string, idempotencyKey: string) {
  if (!guest.notification || guest.expiresAt <= new Date()) return false;
  if (!imessageAvailable()) throw new Error("iMessage alerts aren’t configured");
  await photon.reply({ spaceId: guest.notification.spaceId, senderId: guest.notification.agentUserId, text, idempotencyKey });
  return true;
}
