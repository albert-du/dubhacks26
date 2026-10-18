import type { TtlHours } from "./config";
import type { ReactionCounts, ReactionKey } from "./reactions";

/** Normalized box [x1, y1, x2, y2], each 0..1, relative to the oriented image. */
export type Box = [number, number, number, number];

export interface DumpsterSettings {
  allowVideo: boolean;
}

export interface Dumpster {
  _id: string;
  name: string;
  ttlHours: TtlHours;
  createdAt: Date;
  expiresAt: Date;
  /** Mongo TTL backstop — the worker normally purges before this. */
  hardDeleteAt: Date;
  // Deliberately no creator field: dumpsters are anonymous and nobody owns them.
  settings: DumpsterSettings;
  /**
   * Ask-the-dump assistant. Created on the first question and deleted, with its
   * thread and memories, when the dumpster is purged.
   */
  backboard?: { assistantId: string; threadId: string };
}

export interface Guest {
  _id: string;
  dumpsterId: string;
  /** Every browser signed in as this guest. Typing the name again adds another. */
  viewerIds: string[];
  /** What they signed in to this dumpster as. Also names their face. */
  name: string;
  /** `name` folded for lookup; unique within a dumpster, so the name alone gets you back in. */
  nameKey: string;
  phone?: string;
  /** Verified routing for this guest only; never sent to another browser. */
  notification?: {
    spaceId: string;
    agentUserId: string;
    recipientUserId: string;
    verifiedAt: Date;
    connectedMessageId: string;
  };
  notificationPending?: {
    codeHash: string;
    phone: string;
    agentNumber: string;
    expiresAt: Date;
  };
  notificationRequestedAt?: Date;
  expiryWarningSentAt?: Date;
  /** Frozen retry payload, removed once the provider accepts it. */
  expiryWarningText?: string;
  /** Face vector from the enrollment selfie. The selfie image itself is never stored. */
  embedding?: number[];
  pendingPhotoAlerts: number;
  pendingMentionAlerts: number;
  /** Opened when the current unsent photo or mention batch starts. The text waits two minutes from here. */
  alertBatchStartedAt?: Date;
  lastAlertAt?: Date;
  createdAt: Date;
  expiresAt: Date;
}

export interface FaceHit {
  box: Box;
  embedding?: number[];
  clusterId?: string;
  /** Its face group was hidden (a stranger). Kept so unhiding puts the box back. */
  hidden?: boolean;
}

export interface TextHit {
  text: string;
  box: Box;
}

export interface DetectedObject {
  label: string;
  box: Box;
}

export type MediaStatus = "pending" | "ready" | "failed" | "deleted";

export interface Media {
  _id: string;
  dumpsterId: string;
  // Deliberately no uploader field: uploads are anonymous.
  kind: "image" | "video";
  mime: string;
  bytes: number;
  originalKey: string;
  publicKey?: string;
  /** Exact byte hash of the upload. */
  sha256: string;
  /** 64-bit pixel hash (images only), for near-duplicate detection. */
  phash?: string;
  /** Set when this is a duplicate of an earlier upload in the same dumpster. */
  duplicateOf?: string;
  width?: number;
  height?: number;
  gps?: { lat: number; lng: number };
  takenAt?: Date;
  status: MediaStatus;
  attempts: number;
  claimedAt?: Date | null;
  faces: FaceHit[];
  text: TextHit[];
  objects: DetectedObject[];
  caption?: string;
  tags: string[];
  venue?: string;
  /** Aggregated counts; the per-person rows live in the `reactions` collection. */
  reactions: ReactionCounts;
  transcript?: string;
  mentions: string[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface Cluster {
  _id: string;
  dumpsterId: string;
  centroid: number[];
  n: number;
  guestId?: string;
  /** A few face vectors from different angles, so one person stays one face. */
  exemplars?: number[][];
  /** Added by anyone in the dumpster from the face gallery. */
  name?: string;
  /**
   * Someone said this face doesn't matter (a stranger in the background). It leaves the
   * gallery and the shots, and new shots of it stay hidden too.
   */
  hidden?: boolean;
  cover?: { mediaId: string; box: Box };
  expiresAt: Date;
  updatedAt: Date;
}

export type StickerTarget =
  | { kind: "frame" }
  | { kind: "object"; index: number }
  | { kind: "face"; index: number };

export interface Sticker {
  _id: string;
  dumpsterId: string;
  mediaId: string;
  label: string;
  box: Box;
  /** What the guest picked. Missing on stickers cut before person mattes. */
  target?: StickerTarget;
  publicKey?: string;
  /** "deleted": someone took it out of the pack; kept until burn so other phones hear about it. */
  status: "pending" | "ready" | "failed" | "deleted";
  claimedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

/** One person's reaction; exists only so a tap toggles instead of stacking. */
export interface Reaction {
  _id: string; // `${mediaId}:${viewerId}:${key}`
  dumpsterId: string;
  mediaId: string;
  viewerId: string;
  key: ReactionKey;
  expiresAt: Date;
}

/* ---------- Shapes sent to browsers. Never include face vectors or phone numbers. ---------- */

export interface PublicMedia {
  id: string;
  kind: "image" | "video";
  url: string;
  width?: number;
  height?: number;
  gps?: { lat: number; lng: number };
  venue?: string;
  caption?: string;
  tags: string[];
  reactions: ReactionCounts;
  /** Which reactions this browser has given. */
  myReactions: ReactionKey[];
  /** Hidden faces stay in the list (so face indexes line up for stickers); pages skip them. */
  faces: { box: Box; clusterId?: string; hidden?: true }[];
  text: { box: Box; text: string }[];
  objects: DetectedObject[];
  transcript?: string;
  mentions: string[];
  duplicateOf?: string;
  status: MediaStatus;
  /** Capture time from the camera, when known. */
  takenAt?: string;
  createdAt: string;
}

export interface PublicCluster {
  id: string;
  name?: string;
  count: number;
  /** Someone signed in has said this face is them. Unclaimed faces offer "That's me". */
  claimed: boolean;
  cover?: { url: string; box: Box; w: number; h: number };
}

export interface PublicSticker {
  id: string;
  mediaId: string;
  label: string;
  url?: string;
  status: Sticker["status"];
  target: StickerTarget;
}

export interface PublicDumpster {
  id: string;
  name: string;
  ttlHours: number;
  createdAt: string;
  expiresAt: string;
  settings: DumpsterSettings;
}

export interface DumpsterState {
  dumpster: PublicDumpster;
  media: PublicMedia[];
  clusters: PublicCluster[];
  stickers: PublicSticker[];
  /** Faces someone hid, so they can be unhidden. */
  hiddenFaces: PublicCluster[];
  /** This browser's sign-up, if any. Only the last 4 digits of a verified number are sent back. */
  /** This browser's sign-in for this dumpster. Absent = not signed in yet. */
  me?: { guestId: string; name: string; phoneLast4?: string; clusterIds: string[]; notifications?: NotificationStatus };
  /** True when BACKBOARD_API_KEY is set. The browser never receives the key. */
  canAsk: boolean;
  cursor: string;
}

/** Someone here already goes by this name: who, so the page can ask "same person?". */
export interface SameName {
  /** The name as they spell it. */
  name: string;
  /** Faces already called that. */
  faceIds: string[];
  /** A guest signed in with that name. */
  signedIn: boolean;
}

/** Connection state only. Private routing and guest numbers stay on the server. */
export type NotificationStatus = { state: "disconnected" | "connected" } | { state: "pending"; expiresAt: string };
