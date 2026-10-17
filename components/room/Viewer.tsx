"use client";

import { useEffect, useRef, useState } from "react";
import { ReactionBar } from "@/components/Reactions";
import { frameNo } from "@/components/ui";
import type { ReactionKey } from "@/lib/reactions";
import type { Box, PublicCluster, PublicMedia } from "@/lib/types";

export function Viewer(props: {
  list: PublicMedia[];
  index: number;
  frames: Map<string, number>;
  clusters: PublicCluster[];
  onIndex: (i: number) => void;
  onClose: () => void;
  onReact: (id: string, key: ReactionKey) => void;
  onDelete: (id: string) => Promise<boolean>;
  onSticker: (id: string, subject: number) => Promise<boolean>;
}) {
  const { list, index, onIndex, onClose } = props;
  const m = list[index];
  const [boxes, setBoxes] = useState(false);
  const [cutMenu, setCutMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const touchX = useRef<number | null>(null);
  const names = new Map(props.clusters.map((c) => [c.id, c.name]));

  const prev = () => index > 0 && onIndex(index - 1);
  const next = () => index < list.length - 1 && onIndex(index + 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  });

  useEffect(() => setCutMenu(false), [m?.id]);

  if (!m) return null;

  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 2200);
  };
  const cut = async (subject: number) => {
    setCutMenu(false);
    flash((await props.onSticker(m.id, subject)) ? "Cutting sticker → Pack" : "Couldn’t cut that one");
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink text-paper" role="dialog" aria-modal aria-label="Photo">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-paper/30 px-3">
        <span className="label">
          {frameNo(props.frames.get(m.id) ?? 0)} · {index + 1}/{list.length}
        </span>
        <span className="label">{new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        <button onClick={onClose} className="display -mr-2 px-2 text-2xl" aria-label="Close">
          ✕
        </button>
      </div>

      <div
        className="relative grid min-h-0 flex-1 place-items-center p-2"
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (dx > 50) prev();
          if (dx < -50) next();
          touchX.current = null;
        }}
      >
        <div className="relative inline-block">
          {m.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={m.id} src={m.url} alt={m.caption ?? ""} className="block max-h-[calc(100dvh-300px)] max-w-full animate-drop" />
          ) : (
            <video key={m.id} src={m.url} controls playsInline autoPlay className="block max-h-[calc(100dvh-300px)] max-w-full" />
          )}
          {boxes && m.kind === "image" && (
            <div className="pointer-events-none absolute inset-0">
              {m.faces.map((f, i) => (
                <Overlay
                  key={`f${i}`}
                  box={f.box}
                  tone="green"
                  label={(f.clusterId && names.get(f.clusterId)) || "Person"}
                />
              ))}
              {m.text.map((t, i) => (
                <Overlay key={`t${i}`} box={t.box} tone="paper" label={t.text} />
              ))}
              {m.subjects.map((s, i) => (
                <Overlay key={`s${i}`} box={s.box} tone="dotted" label={s.label} />
              ))}
            </div>
          )}
        </div>
        {toast && <p className="display absolute bottom-4 left-1/2 -translate-x-1/2 bg-green px-3 py-2 text-ink">{toast}</p>}
      </div>

      <div className="shrink-0 space-y-3 border-t-3 border-paper p-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        {m.caption && <p className="display text-xl leading-tight">{m.caption}</p>}
        <div className="flex flex-wrap gap-1">
          {m.venue && <span className="label bg-paper px-1.5 py-0.5 text-ink">@ {m.venue}</span>}
          {m.tags.map((t) => (
            <span key={t} className="label border border-paper px-1.5 py-0.5">
              {t}
            </span>
          ))}
        </div>
        {m.transcript && (
          <p className="max-h-20 overflow-auto border-l-4 border-green pl-2 text-sm">
            “{m.transcript}”
            {m.mentions.length > 0 && <span className="label mt-1 block text-green">Mentions: {m.mentions.join(", ")}</span>}
          </p>
        )}

        {cutMenu && (
          <div className="flex flex-wrap gap-2">
            <span className="label self-center">Cut:</span>
            {m.subjects.map((s, i) => (
              <button key={i} className="btn btn-green !px-3 !py-2 !text-sm" onClick={() => cut(i)}>
                {s.label}
              </button>
            ))}
            <button className="btn btn-ghost !px-3 !py-2 !text-sm" onClick={() => cut(-1)}>
              Whole frame
            </button>
          </div>
        )}

        <ReactionBar m={m} onReact={(k) => props.onReact(m.id, k)} tone="dark" />

        <div className="grid grid-cols-4 gap-2">
          {m.kind === "image" ? (
            <button onClick={() => setBoxes((v) => !v)} className={`btn !px-1 !text-sm ${boxes ? "btn-green" : "btn-ghost"}`} aria-pressed={boxes}>
              Tags
            </button>
          ) : (
            <span />
          )}
          {m.kind === "image" ? (
            <button className="btn btn-ghost !px-1 !text-sm" onClick={() => (m.subjects.length ? setCutMenu((v) => !v) : cut(-1))}>
              Sticker
            </button>
          ) : (
            <span />
          )}
          <a className="btn btn-ghost !px-1 !text-sm" href={m.url} download>
            Save
          </a>
          <button
            className="btn btn-ghost !px-1 !text-sm"
            onClick={async () => {
              if (!confirm("Take this out of the Dumpster? It’s gone for everyone.")) return;
              if (await props.onDelete(m.id)) {
                if (list.length <= 1) onClose();
                else if (index >= list.length - 1) onIndex(index - 1);
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function Overlay({ box, tone, label }: { box: Box; tone: "green" | "fire" | "paper" | "dotted"; label: string }) {
  const [x1, y1, x2, y2] = box;
  const border = {
    green: "border-2 border-green",
    fire: "border-2 border-dashed border-fire",
    paper: "border border-paper",
    dotted: "border-2 border-dotted border-paper",
  }[tone];
  const chip = { green: "bg-green text-ink", fire: "bg-fire text-ink", paper: "bg-paper text-ink", dotted: "bg-ink text-paper" }[tone];
  return (
    <div
      className={`absolute ${border}`}
      style={{ left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` }}
    >
      <span className={`label absolute -top-[15px] left-[-2px] max-w-[160px] truncate px-1 !text-[9px] whitespace-nowrap ${chip}`}>
        {label}
      </span>
    </div>
  );
}
