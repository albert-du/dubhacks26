import { STICKER_FILE_NAME } from "./sticker";

/**
 * iPhone sticker library handoff.
 *
 * A page cannot insert into the system sticker drawer. Messages keeps a
 * sticker someone sends alone: one PNG, no title and no caption, under
 * 500KB. Several files become a collage, and Save to Stickers never shows.
 * Save to Stickers on that conversation writes the library Messages uses.
 */

/** Messages refuses a sticker at or above this size. Same cap as imaging.ts. */
export const STICKER_LIBRARY_MAX_BYTES = 500 * 1024;

export const STICKER_LIBRARY_INTRO =
  "Share this cutout, then save it into the iPhone sticker library. The same share sheet still sends the PNG to WhatsApp.";

export const STICKER_LIBRARY_STEPS = [
  "Tap Share sticker, then tap Messages.",
  "Send it with the text field empty so Messages keeps it a sticker.",
  "Touch and hold the sticker in the conversation and tap Save to Stickers.",
  "In Messages, tap +, then Stickers. The cutout is in that library.",
] as const;

export const STICKER_LIBRARY_HOLD =
  "Touch and hold the picture above and tap Add Sticker when that choice is in the menu.";

export const STICKER_LIBRARY_SENT = "In Messages, touch and hold the sticker and tap Save to Stickers.";

export const STICKER_LIBRARY_FILES =
  "Saved sticker.png. Open it in Files, touch and hold the person, and tap Add Sticker.";

export const STICKER_LIBRARY_TOO_BIG = "This cutout is too big for the iPhone sticker library.";

export interface StickerFileLike {
  name: string;
  type: string;
  size: number;
}

/**
 * One sticker file, and nothing else. A title or text makes Messages send the
 * file name. More than one file becomes a stack, which is not a sticker.
 */
export function stickerLibraryShare<T extends StickerFileLike>(files: readonly T[]): { files: [T] } | null {
  if (files.length !== 1) return null;
  const file = files[0];
  if (file.name !== STICKER_FILE_NAME || file.type !== "image/png") return null;
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size >= STICKER_LIBRARY_MAX_BYTES) return null;
  return { files: [file] };
}

export async function shareStickerLibrary<T extends StickerFileLike>(
  file: T,
  share: (data: { files: [T] }) => Promise<void>,
  canShare: (data: { files: [T] }) => boolean,
): Promise<"shared" | "aborted" | "unavailable" | "rejected"> {
  const payload = stickerLibraryShare([file]);
  if (!payload) return "rejected";
  try {
    if (!canShare(payload)) return "unavailable";
  } catch {
    return "unavailable";
  }
  try {
    await share(payload);
    return "shared";
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return "aborted";
    return "unavailable";
  }
}
