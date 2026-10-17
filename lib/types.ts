import type { TtlHours } from "./config";

/** Normalized box [x1, y1, x2, y2], each 0..1, relative to the oriented image. */
export type Box = [number, number, number, number];

export interface DumpsterSettings {
  /** Blur every face that doesn't belong to a guest who enrolled (consented) with a selfie. */
  blurNonConsented: boolean;
  /** Blur OCR text that looks like IDs, plates, card numbers, etc. */
  redactSensitiveText: boolean;
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
  hostTokenHash: string;
  hostPhone?: string;
  settings: DumpsterSettings;
  warningSent?: boolean;
}

export interface Guest {
  _id: string;
  dumpsterId: string;
  viewerId: string;
  name: string;
  phone?: string;
  /** Face vector from the enrollment selfie. The selfie image itself is never stored. */
  embedding?: number[];
  pendingPhotoAlerts: number;
  pendingMentionAlerts: number;
  lastAlertAt?: Date;
  createdAt: Date;
  expiresAt: Date;
}

export interface FaceHit {
  box: Box;
  embedding?: number[];
  clusterId?: string;
  consented: boolean;
  redacted: boolean;
}

export interface TextHit {
  text: string;
  box: Box;
  sensitive: boolean;
  reason?: string;
  redacted: boolean;
}

export interface Subject {
  label: string;
  box: Box;
}

export type MediaStatus = "pending" | "rerender" | "ready" | "failed" | "deleted";

export interface Media {
  _id: string;
  dumpsterId: string;
  uploaderId: string;
  kind: "image" | "video";
  mime: string;
  bytes: number;
  originalKey: string;
  publicKey?: string;
  width?: number;
  height?: number;
  gps?: { lat: number; lng: number };
  takenAt?: Date;
  status: MediaStatus;
  attempts: number;
  claimedAt?: Date | null;
  /** False when no face/text scanner was available (dev only). */
  scanned: boolean;
  faces: FaceHit[];
  text: TextHit[];
  subjects: Subject[];
  caption?: string;
  tags: string[];
  venue?: string;
  aiFire: number;
  fireReason?: string;
  votes: number;
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
  cover?: { mediaId: string; box: Box };
  expiresAt: Date;
  updatedAt: Date;
}

export interface Sticker {
  _id: string;
  dumpsterId: string;
  mediaId: string;
  label: string;
  box: Box;
  publicKey?: string;
  status: "pending" | "ready" | "failed";
  claimedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface Vote {
  _id: string; // `${mediaId}:${viewerId}`
  dumpsterId: string;
  mediaId: string;
  viewerId: string;
  expiresAt: Date;
}

/* ---------- Shapes sent to browsers. Never include embeddings, phones, or unredacted sensitive text. ---------- */

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
  aiFire: number;
  fireReason?: string;
  votes: number;
  voted: boolean;
  scanned: boolean;
  faces: { box: Box; clusterId?: string; redacted: boolean }[];
  text: { box: Box; text?: string; redacted: boolean }[];
  subjects: Subject[];
  transcript?: string;
  mentions: string[];
  mine: boolean;
  status: MediaStatus;
  createdAt: string;
}

export interface PublicCluster {
  id: string;
  name?: string;
  count: number;
  cover?: { url: string; box: Box; w: number; h: number };
}

export interface PublicSticker {
  id: string;
  mediaId: string;
  label: string;
  url?: string;
  status: Sticker["status"];
}

export interface PublicDumpster {
  id: string;
  name: string;
  ttlHours: number;
  createdAt: string;
  expiresAt: string;
  settings: DumpsterSettings;
}

export interface RoomState {
  dumpster: PublicDumpster;
  media: PublicMedia[];
  clusters: PublicCluster[];
  stickers: PublicSticker[];
  me?: { guestId: string; name: string; clusterIds: string[] };
  cursor: string;
}
