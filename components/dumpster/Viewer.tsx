"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { downloadUrl, MediaStage } from "@/components/MediaStage";
import { ReactionBar } from "@/components/Reactions";
import { frameNo } from "@/components/ui";
import type { ReactionKey } from "@/lib/reactions";
import { faceOverlapping } from "@/lib/sticker";
import type { Box, PublicMedia, StickerTarget } from "@/lib/types";

type Mark = { box: Box; label: string; tone: "person" | "text" };

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
  onSticker: (id: string, target: StickerTarget) => Promise<boolean>;
  /** Tap a name under Who: show that person's shots. */
  onPerson: (clusterId: string, name: string) => void;
}) {
  const { list, index, onIndex, onClose } = props;
  const m = list[index];
  const [marks, setMarks] = useState(false);
  const [cutMenu, setCutMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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
  const cut = async (target: StickerTarget) => {
    setCutMenu(false);
    flash((await props.onSticker(m.id, target)) ? "Cutting them out → Pack" : "Couldn’t cut that one");
  };

  const personObjects = m.objects.map((o, index) => ({ o, index })).filter((x) => x.o.label.toLowerCase() === "person");
  const cuts: { key: string; label: string; target: StickerTarget }[] = [];
  if (personObjects.length) {
    personObjects.forEach(({ o, index }, n) => {
      const face = faceOverlapping(m.faces, o.box);
      const name = face?.clusterId ? props.names.get(face.clusterId) : undefined;
      cuts.push({ key: `object-${index}`, label: name || (personObjects.length > 1 ? `Person ${n + 1}` : "Person"), target: { kind: "object", index } });
    });
  } else {
    m.faces.forEach((f, index) => {
      const name = f.clusterId ? props.names.get(f.clusterId) : undefined;
      cuts.push({ key: `face-${index}`, label: name || (m.faces.length > 1 ? `Person ${index + 1}` : "Person"), target: { kind: "face", index } });
    });
  }
  m.objects.forEach((o, index) => {
    if (o.label.toLowerCase() === "person") return;
    cuts.push({ key: `object-${index}`, label: o.label, target: { kind: "object", index } });
  });
  cuts.push({ key: "frame", label: "Everyone", target: { kind: "frame" } });

  const original = m.duplicateOf ? props.byId.get(m.duplicateOf) : undefined;
  // Named people in this shot, once each. Object labels stay internal (search only).
  const people = [
    ...new Map(
      m.faces.filter((f) => f.clusterId && props.names.get(f.clusterId)).map((f) => [f.clusterId!, props.names.get(f.clusterId!)!]),
    ).entries(),
  ];
  // Only people are tagged on the shot. Captions, writing, objects and speech stay behind the search box.
  const overlay: Mark[] = m.faces.map((f) => ({ box: f.box, label: (f.clusterId && props.names.get(f.clusterId)) || "person", tone: "person" as const }));

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

      <div className="relative flex min-h-0 flex-1 flex-col">
        <MediaStage
          m={m}
          prev={list[index - 1]}
          next={list[index + 1]}
          onPrev={prev}
          onNext={next}
          overlay={marks && m.kind === "image" ? <Marks marks={overlay} /> : null}
        />
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

        <dl className="space-y-1.5 text-sm">
          {people.length > 0 && (
            <Row k="Who">
              <span className="flex flex-wrap gap-1.5">
                {people.map(([id, name]) => (
                  <button key={id} onClick={() => props.onPerson(id, name)} className="border border-green px-1.5 text-green underline-offset-2 hover:underline">
                    {name} →
                  </button>
                ))}
              </span>
            </Row>
          )}
        </dl>

        {cutMenu && (
          <div className="flex flex-wrap gap-2">
            <span className="label self-center">Cut out:</span>
            {cuts.map((choice) => (
              <button
                key={choice.key}
                className={`btn !px-3 !py-2 !text-sm ${choice.target.kind === "frame" ? "btn-ghost" : "btn-green"}`}
                onClick={() => cut(choice.target)}
              >
                {choice.label}
              </button>
            ))}
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
            <button className="btn btn-ghost !px-1 !text-sm" aria-expanded={cutMenu} onClick={() => setCutMenu((v) => !v)}>
              Sticker
            </button>
          ) : (
            <span />
          )}
          <a className="btn btn-ghost !px-1 !text-sm" href={downloadUrl(m.url)} download>
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
