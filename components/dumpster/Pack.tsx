"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRevealedImage } from "@/components/ui";
import { previewUrl } from "@/lib/preview";
import { isIosDevice } from "@/lib/saveToPhotos";
import { isPng, STICKER_FILE_NAME } from "@/lib/sticker";
import {
  STICKER_LIBRARY_FILES,
  STICKER_LIBRARY_HOLD,
  STICKER_LIBRARY_INTRO,
  STICKER_LIBRARY_SENT,
  STICKER_LIBRARY_STEPS,
  STICKER_LIBRARY_TOO_BIG,
  shareStickerLibrary,
} from "@/lib/stickerLibrary";
import type { PublicSticker, StickerTarget } from "@/lib/types";
import type { Tab } from "./DumpsterView";

const tilt = (id: string) => ((id.split("").reduce((s, c) => s + c.charCodeAt(0), 0) % 9) - 4) * 1.1;

const checker =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='8' height='8' fill='%23e3dece'/%3E%3Crect x='8' width='8' height='8' fill='%23f1eee4'/%3E%3Crect y='8' width='8' height='8' fill='%23f1eee4'/%3E%3Crect x='8' y='8' width='8' height='8' fill='%23e3dece'/%3E%3C/svg%3E\")";

export function Pack({
  stickers,
  goTo,
  onRetry,
  onDelete,
}: {
  stickers: PublicSticker[];
  goTo: (t: Tab) => void;
  onRetry: (mediaId: string, target: StickerTarget) => Promise<boolean>;
  /** Take a sticker out of the pack for everyone. */
  onDelete: (stickerId: string) => Promise<boolean>;
}) {
  const [iphone, setIphone] = useState(false);
  useEffect(() => {
    setIphone(isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints));
  }, []);

  return (
    <section>
      <div className="border-b-3 border-ink px-4 pt-5 pb-4">
        <h2 className="display text-[clamp(2.5rem,12vw,4rem)]">
          Sticker
          <br />
          pack
        </h2>
        <p className="mt-3 text-sm leading-snug">
          Open a photo, tap <b>Sticker</b>, and pick a person. dump cuts them out of the shot. On an iPhone,{" "}
          <b>Add to Stickers</b> shares that cutout with Messages. Send it alone, then touch and hold it and tap{" "}
          <b>Save to Stickers</b>. It stays in the sticker library. <b>Download</b> saves the PNG. Press and hold a sticker
          here to save it too.
        </p>
      </div>

      {stickers.length === 0 ? (
        <div className="px-4 py-10">
          <p className="display text-3xl">Pack’s empty.</p>
          <button className="btn mt-4" onClick={() => goTo("dump")}>
            Pick a photo →
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-8 bg-bone p-4">
          {stickers.map((s, i) => (
            <StickerCard key={s.id} sticker={s} order={i} iphone={iphone} onRetry={onRetry} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StickerCard({
  sticker,
  order,
  iphone,
  onRetry,
  onDelete,
}: {
  sticker: PublicSticker;
  order: number;
  iphone: boolean;
  onRetry: (mediaId: string, target: StickerTarget) => Promise<boolean>;
  onDelete: (stickerId: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const closeLibrary = useCallback(() => setLibraryOpen(false), []);

  const addToPhone = async () => {
    setBusy(true);
    setNote(null);
    try {
      const file = await stickerFile(sticker.url);
      if (!file) {
        setNote(sticker.url ? "Couldn’t fetch the cutout. Try again." : "Not ready yet");
        return;
      }
      // A title makes iOS send the file name, or fail the share on some iPhones.
      const payload = { files: [file] };
      if (canShare(payload)) {
        try {
          await navigator.share(payload);
          return;
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
        }
      }
      saveFile(file);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col">
      {sticker.status === "ready" && sticker.url ? (
        <div className="border-3 border-ink" style={{ transform: `rotate(${tilt(sticker.id)}deg)`, backgroundImage: checker }}>
          {/* The image is not a link, so a long-press can save it to the camera roll. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <StickerImage url={sticker.url} alt={sticker.label} order={order} />
        </div>
      ) : sticker.status === "failed" ? (
        <div className="grid aspect-square w-full place-items-center border-3 border-ink bg-paper px-3 text-center">
          <div>
            <p className="text-sm leading-snug">Couldn’t cut that one.</p>
            <button className="btn mt-3 !px-2 !py-2 !text-sm" onClick={() => onRetry(sticker.mediaId, sticker.target)}>
              Retry
            </button>
          </div>
        </div>
      ) : (
        <div className="grid aspect-square w-full place-items-center border-3 border-dashed border-ink">
          <span className="label animate-blink">Cutting…</span>
        </div>
      )}
      <span className="label mt-2 self-center bg-ink px-1.5 text-paper">{sticker.label}</span>
      {sticker.status === "ready" && sticker.url && (
        <div className="mt-2 flex flex-col gap-2">
          <button
            className="btn btn-green w-full !min-w-0 !whitespace-normal !px-1 !py-2 !text-sm !leading-tight"
            disabled={busy}
            onClick={() => {
              if (iphone && sticker.url) setLibraryOpen(true);
              else void addToPhone();
            }}
          >
            {iphone ? "Add to Stickers" : "Add to phone"}
          </button>
          <button
            className="btn btn-ghost w-full !px-1 !py-2 !text-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setNote(null);
              try {
                const file = await stickerFile(sticker.url);
                if (!file) {
                  setNote("Couldn’t fetch the cutout. Try again.");
                  return;
                }
                saveFile(file);
              } finally {
                setBusy(false);
              }
            }}
          >
            Download
          </button>
        </div>
      )}
      <button
        className="label mt-2 self-center underline disabled:opacity-40"
        disabled={busy}
        onClick={async () => {
          if (!confirm(`Delete the ${sticker.label} sticker? It’s gone from everyone’s pack.`)) return;
          setBusy(true);
          if (!(await onDelete(sticker.id))) {
            setBusy(false);
            setNote("Couldn’t delete it. Try again.");
          }
        }}
      >
        Delete
      </button>
      {note && <p className="mt-1 text-center text-xs">{note}</p>}
      {libraryOpen && sticker.url && <StickerLibrarySheet url={sticker.url} label={sticker.label} onClose={closeLibrary} />}
    </li>
  );
}

/**
 * Messages writes the sticker library only after Save to Stickers. The sheet
 * shares one untitled PNG, which is the file Messages will keep as a sticker.
 */
function StickerLibrarySheet({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    let gone = false;
    let objectUrl: string | null = null;
    stickerFile(url).then((next) => {
      if (!next) {
        if (!gone) setFailed(true);
        return;
      }
      const made = URL.createObjectURL(next);
      if (gone) {
        URL.revokeObjectURL(made);
        return;
      }
      objectUrl = made;
      setFile(next);
      setPreview(made);
    });
    return () => {
      gone = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  const share = async () => {
    if (!file) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await shareStickerLibrary(
        file,
        (data) => navigator.share(data),
        (data) => !!navigator.canShare?.(data),
      );
      if (result === "shared") setNote(STICKER_LIBRARY_SENT);
      else if (result === "aborted") return;
      else if (result === "rejected") setNote(STICKER_LIBRARY_TOO_BIG);
      else {
        saveFile(file);
        setNote(STICKER_LIBRARY_FILES);
      }
    } finally {
      setBusy(false);
    }
  };

  const sheet = (
    <div
      className="fixed inset-0 z-dialog flex flex-col bg-paper pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-ink"
      role="dialog"
      aria-modal
      aria-label="Add to Stickers"
    >
      <div className="flex items-center justify-between border-b-3 border-ink px-4 py-3">
        <h3 className="display text-2xl">Add to Stickers</h3>
        <button className="btn btn-ghost !px-3 !py-2" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain px-4 py-4">
        <p className="text-sm leading-snug">{STICKER_LIBRARY_INTRO}</p>
        <div className="mx-auto w-full max-w-[280px] border-3 border-ink bg-bone">
          {preview ? (
            // The blob is the PNG Messages receives, so a long-press is that cutout.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt={label} draggable className="block w-full" />
          ) : (
            <div className="grid aspect-square w-full place-items-center">
              <span className="label animate-blink">{failed ? "Couldn’t fetch the cutout." : "Getting the sticker…"}</span>
            </div>
          )}
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-snug">
          {STICKER_LIBRARY_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="text-sm leading-snug">{STICKER_LIBRARY_HOLD}</p>
        <button className="btn btn-green w-full" disabled={busy || !file} onClick={() => void share()}>
          {busy ? "Opening share sheet…" : "Share sticker"}
        </button>
        {note && <p className="text-center text-sm">{note}</p>}
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}

/**
 * Paint one row of previews at a time, then swap in the full PNG so a
 * long-press still saves the sticker. The PNG waits until that row is visible.
 */
function StickerImage({ url, alt, order }: { url: string; alt: string; order: number }) {
  const revealed = useRevealedImage({
    preview: previewUrl(url),
    fallback: url,
    group: "pack",
    order,
    row: 2,
    upgrade: url,
  });
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={revealed.ref}
      src={revealed.src}
      alt={alt}
      draggable
      decoding="async"
      className="block w-full"
      style={{ opacity: revealed.hidden ? 0 : 1, transition: "opacity 120ms linear" }}
      onLoad={revealed.onLoad}
      onError={revealed.onError}
    />
  );
}

/** The share file is fetched on tap. Loading it for every sticker up front blocked the pack. */
async function stickerFile(url: string | undefined) {
  if (!url) return null;
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}download=1`);
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!isPng(bytes)) return null;
  return new File([bytes], STICKER_FILE_NAME, { type: "image/png" });
}

function canShare(data: ShareData) {
  try {
    return !!navigator.canShare?.(data);
  } catch {
    return false;
  }
}

function saveFile(file: File) {
  const href = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = href;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(href);
}
