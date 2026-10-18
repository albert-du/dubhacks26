/**
 * What an upload is, from the browser's MIME type or, when the phone leaves that blank, the filename.
 * iOS often sends a .mov with an empty type or application/octet-stream.
 */

const BY_TYPE: Record<string, { ext: string; kind: "image" | "video" }> = {
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "image/heic": { ext: "heic", kind: "image" },
  "image/heif": { ext: "heif", kind: "image" },
  "image/gif": { ext: "gif", kind: "image" },
  "video/mp4": { ext: "mp4", kind: "video" },
  "video/quicktime": { ext: "mov", kind: "video" },
  "video/webm": { ext: "webm", kind: "video" },
};

const BY_EXT: Record<string, { ext: string; mime: string; kind: "image" | "video" }> = {
  jpg: { ext: "jpg", mime: "image/jpeg", kind: "image" },
  jpeg: { ext: "jpg", mime: "image/jpeg", kind: "image" },
  png: { ext: "png", mime: "image/png", kind: "image" },
  webp: { ext: "webp", mime: "image/webp", kind: "image" },
  heic: { ext: "heic", mime: "image/heic", kind: "image" },
  heif: { ext: "heif", mime: "image/heif", kind: "image" },
  gif: { ext: "gif", mime: "image/gif", kind: "image" },
  mp4: { ext: "mp4", mime: "video/mp4", kind: "video" },
  m4v: { ext: "mp4", mime: "video/mp4", kind: "video" },
  mov: { ext: "mov", mime: "video/quicktime", kind: "video" },
  webm: { ext: "webm", mime: "video/webm", kind: "video" },
};

export interface UploadKind {
  ext: string;
  mime: string;
  kind: "image" | "video";
}

export function classifyUpload(type: string, name: string): UploadKind | null {
  const known = BY_TYPE[type];
  if (known) return { ...known, mime: type };
  // A real but unsupported type (text/plain, application/pdf) stays rejected.
  if (type && type !== "application/octet-stream") return null;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXT[ext] ?? null;
}

/**
 * Photo/video POST. middleware.ts must keep this path out of its matcher.
 * Next clones every body that runs through middleware; a video clone is cut off
 * or still copying when the route parses it, the route 500s, and the phone
 * shows "No signal" and retries on a perfectly good connection.
 */
export const MEDIA_UPLOAD_PATH = /^\/api\/dumpsters\/[^/]+\/media$/;
