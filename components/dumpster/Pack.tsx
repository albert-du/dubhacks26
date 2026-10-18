"use client";

import { useEffect, useState } from "react";
import { stickerFilename } from "@/lib/sticker";
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
          Open a photo, tap <b>Sticker</b>, and pick a person. Dump cuts them out of the shot. <b>Add to phone</b> opens the
          share sheet so you can keep it or send it to Messages, WhatsApp, or Instagram. Press and hold a sticker to save it too.
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
  const file = useStickerFile(sticker.status === "ready" ? sticker.url : undefined, sticker.label);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addToPhone = async () => {
    if (!file) {
      setNote(sticker.url ? "Still fetching the cutout…" : "Not ready yet");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      if (canShareFile(file)) {
        try {
          await navigator.share({ files: [file], title: file.name });
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
          <img src={sticker.url} alt={sticker.label} draggable className="block w-full" />
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
            onClick={() => {
              if (file) saveFile(file);
              else setNote("Still fetching the cutout…");
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

function useStickerFile(url: string | undefined, label: string) {
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    if (!url) return;
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}download=1`, { signal: ac.signal });
        if (!res.ok) return;
        const blob = await res.blob();
        if (ac.signal.aborted) return;
        const type = blob.type || "image/png";
        const name = type === "image/webp" ? stickerFilename(label).replace(/\.png$/, ".webp") : stickerFilename(label);
        setFile(new File([blob], name, { type }));
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    })();
    return () => ac.abort();
  }, [url, label]);
  return file;
}

function canShareFile(file: File) {
  try {
    return !!navigator.canShare?.({ files: [file] });
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
