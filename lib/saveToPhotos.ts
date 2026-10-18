/**
 * iPhone Safari will not write a downloaded file into Photos. A normal save
 * lands in Files, and several shots are zipped, which Photos cannot import.
 * The share sheet can. Hand it image or video files and Save Image / Save Video
 * puts them in the camera roll. iOS chokes on a very large share, so batches
 * stay small.
 */

export const SHARE_BATCH_LIMIT = 25;

export interface SaveShot {
  id: string;
  url: string;
  kind: "image" | "video";
}

export interface LoadedShot {
  shot: SaveShot;
  file: File;
}

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/** iPhone, iPod, and iPad, including iPadOS desktop-class user agents. */
export function isIosDevice(ua: string, platform = "", maxTouchPoints = 0) {
  return /iPhone|iPad|iPod/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
}

/** `?download=1` makes the file route return a photo-app file (JPEG or PNG). */
export function attachmentUrl(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

export function filenameFromDisposition(header: string | null, fallback: string) {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*[^']*''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // Use the plain filename when the encoding is bad.
    }
  }
  const quoted = /filename\s*=\s*"([^"]+)"/i.exec(header);
  if (quoted) return quoted[1];
  const plain = /filename\s*=\s*([^;]+)/i.exec(header);
  if (plain) return plain[1].trim().replace(/^"|"$/g, "");
  return fallback;
}

/** Drop path pieces and characters that do not belong in a share-sheet name. */
export function sanitizeFilename(name: string) {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const clean = base.replace(/[^\w.-]+/g, "").replace(/^\.+/, "").slice(0, 80);
  return clean || "photo";
}

export function mimeFromName(name: string) {
  switch (name.split(".").pop()?.toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

export function namedDownload(blob: Blob, header: string | null, fallback: string) {
  let name = sanitizeFilename(filenameFromDisposition(header, fallback));
  let type = blob.type.split(";")[0].trim().toLowerCase();
  if (!type || type === "application/octet-stream") type = mimeFromName(name);
  if (!/\.[a-z0-9]+$/i.test(name)) {
    const ext = MIME_EXT[type];
    if (ext) name = `${name}.${ext}`;
  }
  return { name, type };
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export async function loadShot(shot: SaveShot, fetchImpl: FetchLike = fetch, signal?: AbortSignal): Promise<LoadedShot> {
  const res = await fetchImpl(attachmentUrl(shot.url), { signal });
  if (!res.ok) throw new Error(`save fetch ${res.status}`);
  const blob = await res.blob();
  if (!blob.size) throw new Error("save fetch empty");
  const fallback = shot.kind === "video" ? `${shot.id}.mp4` : `${shot.id}.jpg`;
  const named = namedDownload(blob, res.headers.get("content-disposition"), fallback);
  return { shot, file: new File([blob], named.name, { type: named.type }) };
}

export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 0), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function loadShots(shots: SaveShot[], fetchImpl: FetchLike, limit = 3) {
  const rows = await mapPool(shots, limit, async (shot) => {
    try {
      return { ok: true as const, value: await loadShot(shot, fetchImpl) };
    } catch {
      return { ok: false as const, shot };
    }
  });
  const loaded: LoadedShot[] = [];
  const failed: SaveShot[] = [];
  for (const row of rows) {
    if (row.ok) loaded.push(row.value);
    else failed.push(row.shot);
  }
  return { loaded, failed };
}

export function canShareFiles(files: File[], canShare: (data: { files: File[] }) => boolean | undefined) {
  if (!files.length) return false;
  try {
    return !!canShare({ files });
  } catch {
    return false;
  }
}

function allows<T>(items: T[], canShare: (items: T[]) => boolean) {
  if (!items.length) return false;
  try {
    return canShare(items);
  } catch {
    return false;
  }
}

/**
 * Largest group the platform will share, images first when a mix is rejected.
 * Anything past the batch limit, or held back, stays in `rest` in original order.
 */
export function chooseBatch<T>(items: T[], typeOf: (item: T) => string, canShare: (items: T[]) => boolean) {
  if (!items.length) return { batch: [] as T[], rest: [] as T[] };
  const capped = items.slice(0, SHARE_BATCH_LIMIT);
  const overflow = items.slice(SHARE_BATCH_LIMIT);
  const batch = largestShareable(capped, typeOf, canShare);
  if (!batch.length) return { batch, rest: items };
  const chosen = new Set(batch);
  return { batch, rest: capped.filter((item) => !chosen.has(item)).concat(overflow) };
}

function largestShareable<T>(items: T[], typeOf: (item: T) => string, canShare: (items: T[]) => boolean) {
  if (allows(items, canShare)) return items;
  const images = items.filter((item) => typeOf(item).startsWith("image/"));
  const videos = items.filter((item) => typeOf(item).startsWith("video/"));
  if (images.length && images.length < items.length && allows(images, canShare)) return images;
  if (videos.length && videos.length < items.length && allows(videos, canShare)) return videos;
  for (let n = items.length - 1; n >= 1; n--) {
    const slice = items.slice(0, n);
    if (allows(slice, canShare)) return slice;
  }
  return [];
}
