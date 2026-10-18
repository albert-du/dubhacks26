"use client";

import { useEffect, useState } from "react";
import { FireIcon } from "@/components/Brand";
import { Burned } from "@/components/Burned";
import { MediaStage } from "@/components/MediaStage";
import { ReactionBar } from "@/components/Reactions";
import { Countdown, ShotImage, useNow } from "@/components/ui";
import { useDumpster } from "@/lib/client/useDumpster";
import { useSaveShots } from "@/lib/client/useSaveShots";
import { fireRank, REACTIONS, type ReactionKey } from "@/lib/reactions";
import { attachmentUrl } from "@/lib/saveToPhotos";
import type { DumpsterState, PublicMedia } from "@/lib/types";

/** How long the newest shot wears the Just dropped badge. */
const JUST_DROPPED_MS = 5 * 60_000;

interface Stats {
  photos: number;
  people: number;
  faces: number;
}

/** Fallback when the share sheet cannot take the files. One shot saves directly; several come down as a ZIP. */
function downloadShots(dumpsterId: string, shots: { id: string; url: string }[]) {
  if (!shots.length) return;
  if (shots.length === 1) {
    window.location.href = attachmentUrl(shots[0].url);
    return;
  }
  // A real form POST lets the browser stream the ZIP to disk instead of holding it in memory.
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `/api/dumpsters/${dumpsterId}/download`;
  for (const shot of shots) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "ids";
    input.value = shot.id;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

/** Reactions on a tile, as pictures: the burning can for fires, emoji for the rest. */
function ReactionMarks({ m }: { m: PublicMedia }) {
  const shown = REACTIONS.filter((r) => m.reactions[r.key] > 0);
  if (!shown.length) return null;
  return (
    <span className="z-labels absolute right-2 bottom-2 flex items-center gap-2 bg-ink/80 px-2 py-1">
      {shown.map((r) => (
        <span key={r.key} className="flex items-center gap-1">
          {r.key === "fire" ? <FireIcon size={22} /> : <span className="text-lg leading-none">{"emoji" in r ? r.emoji : ""}</span>}
          <span className="display text-sm tabular-nums">{m.reactions[r.key]}</span>
        </span>
      ))}
    </span>
  );
}

/** Tap-in viewer for the big screen: swipe or arrow through, react, save, close. */
function StageViewer({
  list,
  index,
  dumpsterId,
  onIndex,
  onClose,
  onReact,
}: {
  list: PublicMedia[];
  index: number;
  dumpsterId: string;
  onIndex: (i: number) => void;
  onClose: () => void;
  onReact: (id: string, key: ReactionKey) => void;
}) {
  const m = list[index];
  const camera = useSaveShots(m ? [{ id: m.id, url: m.url, kind: m.kind }] : [], (shots) => downloadShots(dumpsterId, shots));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (e.key === "ArrowRight" && index < list.length - 1) onIndex(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, list.length, onIndex, onClose]);
  if (!m) return null;
  return (
    <div className="fixed inset-0 z-dialog flex flex-col bg-ink text-paper" role="dialog" aria-modal aria-label="Photo">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-paper/30 px-4">
        <span className="label">
          {index + 1}/{list.length}
        </span>
        <button onClick={camera.save} disabled={camera.busy} className="btn btn-green ml-auto !px-3 !py-2 !text-sm">
          {camera.label}
        </button>
        <button onClick={onClose} className="display px-2 text-2xl" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <MediaStage
          m={m}
          prev={list[index - 1]}
          next={list[index + 1]}
          onPrev={() => onIndex(index - 1)}
          onNext={() => onIndex(index + 1)}
        />
      </div>
      <div className="shrink-0 space-y-2 border-t-3 border-paper p-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <ReactionBar m={m} onReact={(key) => onReact(m.id, key)} tone="dark" />
        {camera.note && <p className="text-center text-xs leading-snug">{camera.note}</p>}
      </div>
    </div>
  );
}

/** Full-width bar for the projector. Same save path as the phone: camera roll on iPhone, a file or a ZIP elsewhere. */
function StageSaveBar(props: {
  dumpsterId: string;
  selected: PublicMedia[];
  allCount: number;
  onAll: () => void;
  onNone: () => void;
  onDone: () => void;
}) {
  const n = props.selected.length;
  const camera = useSaveShots(
    props.selected.map((m) => ({ id: m.id, url: m.url, kind: m.kind })),
    (shots) => downloadShots(props.dumpsterId, shots),
  );
  return (
    <div className="fixed inset-x-0 bottom-0 z-nav border-t-3 border-ink bg-paper text-ink">
      {camera.note && <p className="px-4 py-2 text-xs leading-snug">{camera.note}</p>}
      <div className="flex items-stretch">
        <span className="label flex items-center px-4">{n} selected</span>
        <button className="label ml-auto border-l border-ink px-4" onClick={n === props.allCount ? props.onNone : props.onAll}>
          {n === props.allCount ? "None" : "All"}
        </button>
        <button className="display border-l-3 border-ink bg-green px-5 py-4 text-sm disabled:opacity-40" disabled={!n || camera.busy} onClick={camera.save}>
          {camera.label}
        </button>
        <button className="display border-l border-ink px-4" onClick={props.onDone} aria-label="Done selecting">
          ✕
        </button>
      </div>
    </div>
  );
}

function SelectGrid({ list, selected, onToggle }: { list: PublicMedia[]; selected: Set<string>; onToggle: (id: string) => void }) {
  return (
    <ul className="grid grid-cols-2 gap-[3px] sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {list.map((m, i) => (
        <li key={m.id}>
          <button
            onClick={() => onToggle(m.id)}
            aria-pressed={selected.has(m.id)}
            className="relative block aspect-square w-full overflow-hidden bg-[#222] text-left"
          >
            {m.kind === "image" ? (
              <ShotImage url={m.url} group="stage-select" order={i} row={4} className="z-media relative size-full object-cover" />
            ) : (
              <video src={`${m.url}#t=0.1`} muted playsInline preload="metadata" className="z-media relative size-full object-cover" />
            )}
            {m.kind === "video" && <span className="label z-labels absolute top-0 right-0 bg-paper px-1 !text-[9px] text-ink">▶ Clip</span>}
            <span className={`z-labels absolute inset-0 ${selected.has(m.id) ? "bg-green/40 outline-4 -outline-offset-4 outline-green" : ""}`}>
              <span
                className={`display absolute top-1 left-1 grid size-7 place-items-center border-2 border-ink text-sm text-ink ${selected.has(m.id) ? "bg-green" : "bg-paper/80"}`}
              >
                {selected.has(m.id) ? "✓" : ""}
              </span>
            </span>
            <ReactionMarks m={m} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Projector / TV view: QR and counts on top, then every shot. The page scrolls. */
export function Stage({ initial }: { initial: DumpsterState }) {
  const { state, destroyed, react } = useDumpster(initial);
  const [stats, setStats] = useState<Stats | null>(null);
  // Track the open photo by id: new drops land at the front and would shift an index.
  const [open, setOpen] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const now = useNow(15_000);
  const id = state.dumpster.id;

  const toggle = (mediaId: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(mediaId)) next.delete(mediaId);
      else next.add(mediaId);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const startSelecting = () => {
    setOpen(null);
    setSelecting(true);
  };

  useEffect(() => {
    const load = () =>
      fetch(`/api/dumpsters/${id}/stats`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => s && setStats(s))
        .catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [id]);

  if (destroyed) return <Burned />;

  const all = state.media;
  const chosen = all.filter((m) => selected.has(m.id));
  const fire = fireRank(state.media.filter((m) => m.kind === "image"))[0];

  return (
    <div className="stage-root min-h-dvh bg-ink text-paper">
      <header className="flex flex-wrap items-end gap-6 border-b-3 border-paper p-6">
        <div className="min-w-[12rem] flex-1">
          <p className="label text-green">Live Dumpster</p>
          <h1 className="display text-5xl break-words">{state.dumpster.name}</h1>
        </div>

        <div className="flex items-end gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/dumpsters/${id}/qr?theme=dark`} alt="Scan to join" className="w-36 border-3 border-paper" />
          <p className="display text-4xl">
            Scan
            <br />
            to <span className="text-green">drop</span>
          </p>
        </div>

        <dl className="grid min-w-[18rem] flex-1 grid-cols-3 border-3 border-paper">
          {[
            ["Photos", stats?.photos ?? state.media.length],
            ["People", stats?.faces ?? state.clusters.length],
            ["Fires", state.media.reduce((s, m) => s + m.reactions.fire, 0)],
          ].map(([k, v], i) => (
            <div key={k} className={`p-3 ${i ? "border-l-3 border-paper" : ""}`}>
              <dt className="label">{k}</dt>
              <dd className="display text-4xl tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>

        {fire && (
          <div className="grid grid-cols-[96px_1fr] border-3 border-fire">
            <ShotImage url={fire.url} eager className="size-24 object-cover" />
            <div className="p-2">
              <p className="label text-fire">Top Dumpster Fire</p>
              <p className="flex items-center gap-2">
                <FireIcon size={36} />
                <span className="display text-3xl tabular-nums">{fire.reactions.fire}</span>
              </p>
            </div>
          </div>
        )}

        <div>
          <p className="label mb-1">Burns in</p>
          <div className="hazard p-2">
            <Countdown expiresAt={state.dumpster.expiresAt} className="display block bg-ink px-3 text-5xl" />
          </div>
        </div>

        {all.length > 0 && (
          <button
            onClick={() => (selecting ? stopSelecting() : startSelecting())}
            className={`btn !py-3 ${selecting ? "btn-green" : "btn-ghost"}`}
            aria-pressed={selecting}
          >
            Select
          </button>
        )}
      </header>

      <main className={selecting ? "p-[3px] pb-28" : "relative grid auto-rows-[24vh] grid-cols-2 content-start gap-[3px] p-[3px] md:grid-cols-4"}>
        {selecting ? (
          <SelectGrid list={all} selected={selected} onToggle={toggle} />
        ) : (
          <>
            {all.length === 0 && (
              <div className="col-span-full row-span-3 grid place-items-center">
                <p className="display text-center text-[8vw]">
                  Waiting for
                  <br />
                  the first dump.
                </p>
              </div>
            )}
            {all.map((m, i) => {
              const fresh = i === 0 && now !== null && now - Date.parse(m.createdAt) < JUST_DROPPED_MS;
              const hero = i === 0;
              return (
                <button
                  key={m.id}
                  onClick={() => setOpen(m.id)}
                  className={`relative block overflow-hidden bg-[#222] text-left ${hero ? "col-span-2 row-span-2" : ""}`}
                  aria-label={m.kind === "video" ? "Open clip" : "Open photo"}
                >
                  {m.kind === "image" ? (
                    <ShotImage
                      url={m.url}
                      edge={hero ? 960 : 320}
                      group="stage"
                      order={i}
                      row={4}
                      className={`z-media relative size-full object-cover ${fresh ? "animate-drop" : ""}`}
                    />
                  ) : (
                    <video
                      src={`${m.url}#t=0.1`}
                      muted
                      playsInline
                      preload="metadata"
                      className={`z-media relative size-full object-cover ${fresh ? "animate-drop" : ""}`}
                    />
                  )}
                  {m.kind === "video" && <span className="label z-labels absolute top-0 right-0 bg-paper px-1 !text-[9px] text-ink">▶ Clip</span>}
                  {fresh && <span className="label z-labels absolute top-2 left-2 bg-green px-1.5 py-0.5 text-ink">Just dropped</span>}
                  <ReactionMarks m={m} />
                </button>
              );
            })}
          </>
        )}
      </main>

      {selecting && (
        <StageSaveBar
          dumpsterId={id}
          selected={chosen}
          allCount={all.length}
          onAll={() => setSelected(new Set(all.map((m) => m.id)))}
          onNone={() => setSelected(new Set())}
          onDone={stopSelecting}
        />
      )}

      {open && !selecting && all.some((x) => x.id === open) && (
        <StageViewer
          list={all}
          index={all.findIndex((x) => x.id === open)}
          dumpsterId={id}
          onIndex={(i) => all[i] && setOpen(all[i].id)}
          onClose={() => setOpen(null)}
          onReact={react}
        />
      )}
    </div>
  );
}
