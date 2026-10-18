"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MediaStage } from "@/components/MediaStage";
import { ReactionBar } from "@/components/Reactions";
import { frameNo } from "@/components/ui";
import { useSaveShots } from "@/lib/client/useSaveShots";
import type { ReactionKey } from "@/lib/reactions";
import { attachmentUrl } from "@/lib/saveToPhotos";
import { namedFirst } from "@/lib/peopleOrder";
import { faceOverlapping } from "@/lib/sticker";
import type { Box, PublicCluster, PublicMedia, StickerTarget } from "@/lib/types";

type Mark = { box: Box; label: string; tone: "person" | "focus" };

export function Viewer(props: {
  list: PublicMedia[];
  index: number;
  frames: Map<string, number>;
  names: Map<string, string>;
  clusters: PublicCluster[];
  /** Faces that are the signed-in guest. */
  myClusterIds: string[];
  byId: Map<string, PublicMedia>;
  onIndex: (i: number) => void;
  onClose: () => void;
  onReact: (id: string, key: ReactionKey) => void;
  onDelete: (id: string) => Promise<boolean>;
  onSticker: (id: string, target: StickerTarget) => Promise<boolean>;
  /** Tap a name under Who: show that person's shots. */
  onPerson: (clusterId: string, name: string) => void;
  /** "That's me" on an unclaimed face. Resolves to an error message, or null. */
  onClaim: (clusterId: string) => Promise<string | null>;
  /** Hide an unclaimed face (a stranger in the background) for everyone. */
  onHideFace: (clusterId: string) => Promise<string | null>;
}) {
  const { list, index, onIndex, onClose } = props;
  const m = list[index];
  const camera = useSaveShots(m ? [{ id: m.id, url: m.url, kind: m.kind }] : [], (shots) => {
    const url = shots[0]?.url;
    if (url) window.location.href = attachmentUrl(url);
  });
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

  /** The face tag that was tapped: its box is outlined so two unnamed people can be told apart. */
  const [focus, setFocus] = useState<number | null>(null);
  const [claiming, setClaiming] = useState(false);
  useEffect(() => {
    setCutMenu(false);
    setFocus(null);
  }, [m?.id]);

  if (!m) return null;

  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 2200);
  };
  const cut = async (target: StickerTarget) => {
    setCutMenu(false);
    flash((await props.onSticker(m.id, target)) ? "Cutting them out → Pack" : "Couldn’t cut that one");
  };

  // Hidden faces (strangers) keep their place in the list so sticker indexes line up, but never show.
  const shown = m.faces.filter((f) => !f.hidden);
  const personObjects = m.objects.map((o, index) => ({ o, index })).filter((x) => x.o.label.toLowerCase() === "person");
  const cuts: { key: string; label: string; target: StickerTarget }[] = [];
  if (personObjects.length) {
    personObjects.forEach(({ o, index }, n) => {
      const face = faceOverlapping(shown, o.box);
      const name = face?.clusterId ? props.names.get(face.clusterId) : undefined;
      cuts.push({ key: `object-${index}`, label: name || (personObjects.length > 1 ? `Person ${n + 1}` : "Person"), target: { kind: "object", index } });
    });
  } else {
    let n = 0;
    m.faces.forEach((f, index) => {
      if (f.hidden) return;
      const name = f.clusterId ? props.names.get(f.clusterId) : undefined;
      n++;
      cuts.push({ key: `face-${index}`, label: name || (shown.length > 1 ? `Person ${n}` : "Person"), target: { kind: "face", index } });
    });
  }
  m.objects.forEach((o, index) => {
    if (o.label.toLowerCase() === "person") return;
    cuts.push({ key: `object-${index}`, label: o.label, target: { kind: "object", index } });
  });
  cuts.push({ key: "frame", label: "Everyone", target: { kind: "frame" } });

  const original = m.duplicateOf ? props.byId.get(m.duplicateOf) : undefined;
  // Every face in this shot, once per person. Unnamed ones are numbered in face order so their boxes match the tags.
  // The Who row shows named people first. Only people are tagged on the shot. Captions, writing, objects and speech stay behind the search box.
  const claimed = new Set(props.clusters.filter((c) => c.claimed).map((c) => c.id));
  const mine = new Set(props.myClusterIds);
  const labelOf: string[] = [];
  const tags: { face: number; clusterId?: string; name?: string; label: string }[] = [];
  m.faces.forEach((f, i) => {
    if (f.hidden) return;
    const same = f.clusterId ? tags.find((t) => t.clusterId === f.clusterId) : undefined;
    if (same) return void (labelOf[i] = same.label);
    const name = f.clusterId ? props.names.get(f.clusterId) : undefined;
    const label = name ?? `Person ${tags.filter((t) => !t.name).length + 1}`;
    labelOf[i] = label;
    tags.push({ face: i, clusterId: f.clusterId, name, label });
  });
  const people = namedFirst(tags);
  const focused = focus === null ? undefined : tags.find((t) => t.face === focus);
  const focusedCluster = focused?.clusterId;
  const canClaim = !!focusedCluster && !claimed.has(focusedCluster) && !mine.has(focusedCluster);
  const overlay: Mark[] = m.faces.flatMap((f, i) =>
    f.hidden
      ? []
      : [{
          box: f.box,
          label: labelOf[i],
          tone: focused && (i === focused.face || (!!focusedCluster && f.clusterId === focusedCluster)) ? ("focus" as const) : ("person" as const),
        }],
  );
  const claim = async () => {
    if (!focusedCluster) return;
    setClaiming(true);
    const error = await props.onClaim(focusedCluster);
    setClaiming(false);
    if (error) return flash(error);
    setFocus(null);
    flash("That’s you now. New shots of you go to Me.");
  };

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
          overlay={(marks || focused) && m.kind === "image" ? <Marks marks={overlay} /> : null}
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

        {/* One line, on every shot. Wrapping names, or hiding this row when nobody is tagged, changes how tall the photo above it is. */}
        <dl className="text-sm">
          <Row k="Who">
            <div className="no-scrollbar flex h-8 items-center gap-1.5 overflow-x-auto">
              {people.length === 0 ? (
                <span className="shrink-0 text-paper/60">No one in this shot</span>
              ) : (
                people.map((t) =>
                  t.name && t.clusterId ? (
                    <button
                      key={t.clusterId}
                      onClick={() => props.onPerson(t.clusterId!, t.name!)}
                      className="shrink-0 border border-green px-1.5 whitespace-nowrap text-green underline-offset-2 hover:underline"
                    >
                      {t.name} →
                    </button>
                  ) : (
                    <button
                      key={t.clusterId ?? `face-${t.face}`}
                      onClick={() => setFocus(focus === t.face ? null : t.face)}
                      aria-pressed={focus === t.face}
                      className={`shrink-0 border border-dashed px-1.5 whitespace-nowrap ${focus === t.face ? "border-fire bg-fire text-ink" : "border-paper/60"}`}
                    >
                      Unnamed · {t.label}
                    </button>
                  ),
                )
              )}
            </div>
          </Row>
        </dl>

        {focused && (
          <div className="space-y-2 border-2 border-fire p-2">
            <p className="text-sm">
              {m.kind === "image" ? <>The orange box is <b>{focused.label}</b>. </> : <><b>{focused.label}</b> is in this clip. </>}
              {canClaim ? "Is that you?" : focusedCluster ? "Someone already said this is them." : "We couldn’t match this face, so it can’t be claimed."}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {canClaim && (
                <button className="btn btn-green !py-2 !text-sm" disabled={claiming} onClick={() => void claim()}>
                  {claiming ? "Claiming…" : "That’s me"}
                </button>
              )}
              {focusedCluster && (
                <button className="btn btn-ghost !py-2 !text-sm" onClick={() => props.onPerson(focusedCluster, focused.label)}>
                  Their shots
                </button>
              )}
              {canClaim && (
                <button
                  className="btn btn-ghost col-span-2 !py-2 !text-sm"
                  disabled={claiming}
                  onClick={async () => {
                    if (!confirm("Hide this face for everyone? It comes off the face row and the shots, and new shots of it stay hidden.")) return;
                    const error = await props.onHideFace(focusedCluster!);
                    if (error) return flash(error);
                    setFocus(null);
                    flash("Hidden. That face won’t be tagged again.");
                  }}
                >
                  Nobody we know · Hide face
                </button>
              )}
            </div>
          </div>
        )}

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
          <button className="btn btn-ghost !px-1 !text-sm" disabled={camera.busy} onClick={camera.save}>
            {camera.label}
          </button>
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
          {camera.note && <p className="col-span-4 text-center text-xs leading-snug">{camera.note}</p>}
        </div>
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[3.5rem_1fr] items-center gap-2">
      <dt className="label text-paper/60">{k}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

const TONE = {
  person: { line: "border-green", chip: "bg-green text-ink" },
  focus: { line: "border-fire", chip: "bg-fire text-ink" },
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
          <div key={i} className={`absolute ${mk.tone === "focus" ? "border-4" : "border-2"} ${TONE[mk.tone].line}`} style={pct(mk.box)} />
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
