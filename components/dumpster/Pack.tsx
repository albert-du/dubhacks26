"use client";

import { useEffect, useState } from "react";
import { previewUrl } from "@/lib/preview";
import { isPng, STICKER_FILE_NAME } from "@/lib/sticker";
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
  return (
    <section>
      <div className="border-b-3 border-ink px-4 pt-5 pb-4">
        <h2 className="display text-[clamp(2.5rem,12vw,4rem)]">
          Sticker
          <br />
          pack
        </h2>
        <p className="mt-3 text-sm leading-snug">
          Open a photo, tap <b>Sticker</b>, and pick a person. dump cuts them out of the shot. <b>Add to phone</b> opens the
          share sheet with a PNG sticker, so Messages on an iPhone receives the sticker itself. Press and hold a sticker to save it too.
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
          {stickers.map((s) => (
            <StickerCard key={s.id} sticker={s} onRetry={onRetry} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StickerCard({
  sticker,
  onRetry,
  onDelete,
}: {
  sticker: PublicSticker;
  onRetry: (mediaId: string, target: StickerTarget) => Promise<boolean>;
  onDelete: (stickerId: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
          <StickerImage url={sticker.url} alt={sticker.label} />
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
          <button className="btn btn-green w-full !px-1 !py-2 !text-sm" disabled={busy} onClick={addToPhone}>
            Add to phone
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
    </li>
  );
}

/**
 * Paint the small preview immediately, then swap in the full PNG once it has
 * loaded so a long-press still saves the sticker.
 */
function StickerImage({ url, alt }: { url: string; alt: string }) {
  const preview = previewUrl(url);
  const [src, setSrc] = useState(preview);
  useEffect(() => {
    let gone = false;
    const full = new Image();
    full.decoding = "async";
    full.onload = () => {
      if (!gone) setSrc(url);
    };
    full.src = url;
    return () => {
      gone = true;
    };
  }, [url, preview]);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      draggable
      decoding="async"
      className="block w-full"
      onError={() => setSrc((cur) => (cur === url ? cur : url))}
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
