"use client";

/**
 * Offline-first upload queue. Every dropped file is written to IndexedDB *before*
 * any network call, so a dead venue connection, a locked phone, or a reload never
 * loses a photo. The uploader drains it whenever the browser is online.
 */

export interface QueuedUpload {
  id: string;
  dumpsterId: string;
  blob: Blob;
  name: string;
  type: string;
  lat?: number;
  lng?: number;
  takenAt?: number;
  addedAt: number;
}

const DB = "dump";
const STORE = "uploads";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const uploadQueue = {
  add: (u: QueuedUpload) => tx("readwrite", (s) => s.put(u)),
  remove: (id: string) => tx("readwrite", (s) => s.delete(id)),
  async list(dumpsterId: string): Promise<QueuedUpload[]> {
    const all = await tx<QueuedUpload[]>("readonly", (s) => s.getAll());
    return all.filter((u) => u.dumpsterId === dumpsterId).sort((a, b) => a.addedAt - b.addedAt);
  },
};

/** Pull GPS + capture time before compression strips EXIF, then shrink big photos for weak signal. */
export async function prepareFile(file: File): Promise<Omit<QueuedUpload, "id" | "dumpsterId" | "addedAt">> {
  const base = { blob: file as Blob, name: file.name, type: file.type };
  if (!file.type.startsWith("image/") || file.type === "image/gif") return base;

  let lat: number | undefined;
  let lng: number | undefined;
  let takenAt: number | undefined;
  try {
    const exifr = (await import("exifr")).default;
    const gps = await exifr.gps(file);
    if (gps) ({ latitude: lat, longitude: lng } = gps);
    const meta = await exifr.parse(file, ["DateTimeOriginal"]);
    if (meta?.DateTimeOriginal instanceof Date) takenAt = meta.DateTimeOriginal.getTime();
  } catch {}

  const heic = /heic|heif/.test(file.type);
  if (!heic && file.size < 1.5 * 1024 * 1024) return { ...base, lat, lng, takenAt };
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.86));
    if (blob) return { blob, name: file.name.replace(/\.\w+$/, ".jpg"), type: "image/jpeg", lat, lng, takenAt };
  } catch {}
  return { ...base, lat, lng, takenAt };
}
