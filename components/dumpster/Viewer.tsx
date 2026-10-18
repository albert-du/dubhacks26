"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ReactionBar } from "@/components/Reactions";
import { frameNo } from "@/components/ui";
import type { ReactionKey } from "@/lib/reactions";
import type { Box, PublicMedia } from "@/lib/types";

type Mark = { box: Box; label: string; tone: "person" | "thing" | "text" };

export function Viewer(props: {
  list: PublicMedia[];
  index: number;
  frames: Map<string, number>;
  names: Map<string, string>;
  byId: Map<string, PublicMedia>;
  onIndex: (i: number) => void;
  onClose: () => void;
  onReact: (id: string, key: ReactionKey) => void;
  onDelete: (id: string) => Promise<boolean>;
  onSticker: (id: string, object: number) => Promise<boolean>;
}) {
  const { list, index, onIndex, onClose } = props;
  const m = list[index];
  const [marks, setMarks] = useState(false);
  const [cutMenu, setCutMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const touchX = useRef<number | null>(null);

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
  const cut = async (object: number) => {
    setCutMenu(false);
    flash((await props.onSticker(m.id, object)) ? "Cutting it out → Pack" : "Couldn’t cut that one");
  };

  const original = m.duplicateOf ? props.byId.get(m.duplicateOf) : undefined;
  const people = m.faces.map((f) => (f.clusterId ? props.names.get(f.clusterId) : undefined)).filter(Boolean) as string[];
  const things = [...new Set(m.objects.map((o) => o.label).filter((l) => l !== "person"))];
  const overlay: Mark[] = [
    ...m.faces.map((f) => ({ box: f.box, label: (f.clusterId && props.names.get(f.clusterId)) || "person", tone: "person" as const })),
    ...m.objects.filter((o) => o.label !== "person").map((o) => ({ box: o.box, label: o.label, tone: "thing" as const })),
    ...m.text.map((t) => ({ box: t.box, label: t.text, tone: "text" as const })),
  ];

  return (
    <div className="fixed inset-0 z-dialog flex flex-col bg-ink text-paper" role="dialog" aria-modal aria-label="Photo">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-paper/30 px-3">
        <span className="label">
          {frameNo(props.frames.get(m.id) ?? 0)} · {index + 1}/{list.length}
        </span>
        <span className="label">
          {new Date(m.takenAt ?? m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
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
            <img key={m.id} src={m.url} alt={m.caption ?? ""} className="z-media relative block max-h-[calc(100dvh-330px)] max-w-full animate-drop" />
          ) : (
            <video key={m.id} src={m.url} controls playsInline autoPlay className="z-media relative block max-h-[calc(100dvh-330px)] max-w-full" />
          )}
          {marks && m.kind === "image" && <Marks marks={overlay} />}
        </div>
        {toast && (
          <p className="display z-toast absolute bottom-4 left-1/2 -translate-x-1/2 bg-green px-3 py-2 whitespace-nowrap text-ink">{toast}</p>
        )}
      </div>

      <div className="no-scrollbar max-h-[46dvh] shrink-0 space-y-3 overflow-y-auto border-t-3 border-paper p-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        {original && (
          <button
            className="label block w-full bg-paper px-2 py-1 text-left text-ink"
            onClick={() => {
              const i = list.findIndex((x) => x.id === original.id);
              if (i >= 0) onIndex(i);
            }}
          >
            Looks like a repeat of {frameNo(props.frames.get(original.id) ?? 0)}
          </button>
        )}
        {m.caption && <p className="display text-xl leading-tight">{m.caption}</p>}

        <dl className="space-y-1.5 text-sm">
          {people.length > 0 && <Row k="Who">{[...new Set(people)].join(", ")}</Row>}
          {things.length > 0 && <Row k="What">{things.join(", ")}</Row>}
          {m.venue && <Row k="Where">{m.venue}</Row>}
          {m.text.length > 0 && <Row k="Says">“{m.text.map((t) => t.text).join(" · ")}”</Row>}
          {m.transcript && (
            <Row k="Heard">
              “{m.transcript}”{m.mentions.length > 0 && <span className="text-green"> · names {m.mentions.join(", ")}</span>}
            </Row>
          )}
        </dl>

        {cutMenu && (
          <div className="flex flex-wrap gap-2">
            <span className="label self-center">Cut out:</span>
            {m.objects.map((o, i) => (
              <button key={i} className="btn btn-green !px-3 !py-2 !text-sm" onClick={() => cut(i)}>
                {o.label}
              </button>
            ))}
            <button className="btn btn-ghost !px-3 !py-2 !text-sm" onClick={() => cut(-1)}>
              Whole shot
            </button>
          </div>
        )}

        <ReactionBar m={m} onReact={(k) => props.onReact(m.id, k)} tone="dark" />

        <div className="grid grid-cols-4 gap-2">
          {m.kind === "image" ? (
            <button onClick={() => setMarks((v) => !v)} className={`btn !px-1 !text-sm ${marks ? "btn-green" : "btn-ghost"}`} aria-pressed={marks}>
              Tags
            </button>
          ) : (
            <span />
          )}
          {m.kind === "image" ? (
            <button className="btn btn-ghost !px-1 !text-sm" onClick={() => (m.objects.length ? setCutMenu((v) => !v) : cut(-1))}>
              Sticker
            </button>
          ) : (
            <span />
          )}
          <a className="btn btn-ghost !px-1 !text-sm" href={`${m.url}${m.url.includes("?") ? "&" : "?"}download=1`} download>
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

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[3.5rem_1fr] gap-2">
      <dt className="label pt-0.5 text-paper/60">{k}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

const TONE = {
  person: { line: "border-green", chip: "bg-green text-ink" },
  thing: { line: "border-paper border-dashed", chip: "bg-paper text-ink" },
  text: { line: "border-fire", chip: "bg-fire text-ink" },
};

/**
 * Two stacked layers: all outlines first (z-boxes), then all labels (z-labels).
 * Rendering them separately guarantees no outline ever crosses over a label.
 * Labels sit on the box's top edge, anchor to the right edge near the right side,
 * and get nudged down when they'd collide with a label already placed.
 */
function Marks({ marks }: { marks: Mark[] }) {
  const labels = useRef<HTMLDivElement>(null);
  const pct = (b: Box) => ({ left: `${b[0] * 100}%`, top: `${b[1] * 100}%`, width: `${(b[2] - b[0]) * 100}%`, height: `${(b[3] - b[1]) * 100}%` });

  useLayoutEffect(() => {
    const els = [...(labels.current?.children ?? [])] as HTMLElement[];
    els.forEach((el) => (el.style.transform = ""));
    const placed: DOMRect[] = [];
    for (const el of els) {
      let r = el.getBoundingClientRect();
      for (let tries = 0; tries < 12 && placed.some((p) => r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top); tries++) {
        el.style.transform = `translateY(${(tries + 1) * (r.height + 1)}px)`;
        r = el.getBoundingClientRect();
      }
      placed.push(r);
    }
  }, [marks]);

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-boxes" aria-hidden>
        {marks.map((mk, i) => (
          <div key={i} className={`absolute border-2 ${TONE[mk.tone].line}`} style={pct(mk.box)} />
        ))}
      </div>
      <div ref={labels} className="pointer-events-none absolute inset-0 z-labels">
        {marks.map((mk, i) => {
          const right = mk.box[0] > 0.55;
          return (
            <span
              key={i}
              className={`label absolute max-w-[45%] truncate px-1 !text-[9px] whitespace-nowrap ${TONE[mk.tone].chip}`}
              style={{
                top: `${mk.box[1] * 100}%`,
                ...(right ? { right: `${(1 - mk.box[2]) * 100}%` } : { left: `${mk.box[0] * 100}%` }),
              }}
            >
              {mk.label}
            </span>
          );
        })}
      </div>
    </>
  );
}
