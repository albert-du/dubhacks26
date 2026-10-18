"use client";

import { useEffect, useState } from "react";
import { FireIcon } from "@/components/Brand";
import { Burned } from "@/components/Burned";
import { downloadUrl, MediaStage } from "@/components/MediaStage";
import { Countdown, ShotImage, useNow } from "@/components/ui";
import { useDumpster } from "@/lib/client/useDumpster";
import { fireRank, REACTIONS } from "@/lib/reactions";
import type { DumpsterState, PublicMedia } from "@/lib/types";

/** How long the newest shot wears the Just dropped badge. */
const JUST_DROPPED_MS = 5 * 60_000;

interface Stats {
  photos: number;
  people: number;
  faces: number;
}

/** Reactions on a tile, as pictures: the burning can for fires, emoji for the rest. */
function Reactions({ m }: { m: PublicMedia }) {
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

/** Tap-in viewer for the big screen: swipe or arrow through, download, close. */
function StageViewer({ list, index, onIndex, onClose }: { list: PublicMedia[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const m = list[index];
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
        <a href={downloadUrl(m.url)} download className="btn btn-green ml-auto !px-3 !py-2 !text-sm">
          Download
        </a>
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
          overlay={<Reactions m={m} />}
        />
      </div>
    </div>
  );
}

/** Projector / TV view: live mosaic, giant QR, counts, countdown. */
export function Stage({ initial }: { initial: DumpsterState }) {
  const { state, destroyed } = useDumpster(initial);
  const [stats, setStats] = useState<Stats | null>(null);
  // Track the open photo by id: new drops land at the front and would shift an index.
  const [open, setOpen] = useState<string | null>(null);
  const now = useNow(15_000);
  const id = state.dumpster.id;

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

  const latest = state.media.filter((m) => m.kind === "image").slice(0, 11);
  const all = state.media;
  const fire = fireRank(state.media.filter((m) => m.kind === "image"))[0];

  return (
    <div className="stage-root grid min-h-dvh bg-ink text-paper lg:grid-cols-[1fr_400px]">
      <main className="grid auto-rows-[24vh] grid-cols-2 gap-[3px] p-[3px] md:grid-cols-4">
        {latest.length === 0 && (
          <div className="col-span-full row-span-3 grid place-items-center">
            <p className="display text-center text-[8vw]">
              Waiting for
              <br />
              the first dump.
            </p>
          </div>
        )}
        {latest.map((m, i) => {
          const fresh = i === 0 && now !== null && now - Date.parse(m.createdAt) < JUST_DROPPED_MS;
          return (
            <button
              key={m.id}
              onClick={() => setOpen(m.id)}
              className={`relative block overflow-hidden bg-[#222] text-left ${i === 0 ? "col-span-2 row-span-2" : ""}`}
              aria-label="Open photo"
            >
              <ShotImage url={m.url} edge={i === 0 ? 960 : 320} eager={i < 5} className={`z-media relative size-full object-cover ${fresh ? "animate-drop" : ""}`} />
              {fresh && <span className="label z-labels absolute top-2 left-2 bg-green px-1.5 py-0.5 text-ink">Just dropped</span>}
              <Reactions m={m} />
            </button>
          );
        })}
      </main>

      <aside className="flex flex-col gap-6 border-t-3 border-paper p-6 lg:border-t-0 lg:border-l-3">
        <div>
          <p className="label text-green">Live Dumpster</p>
          <h1 className="display text-5xl break-words">{state.dumpster.name}</h1>
        </div>

        <div className="flex items-end gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/dumpsters/${id}/qr?theme=dark`} alt="Scan to join" className="w-44 border-3 border-paper" />
          <p className="display text-4xl">
            Scan
            <br />
            to <span className="text-green">drop</span>
          </p>
        </div>

        <dl className="grid grid-cols-3 border-3 border-paper">
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

        <div className="mt-auto">
          <p className="label mb-1">Burns in</p>
          <div className="hazard p-2">
            <Countdown expiresAt={state.dumpster.expiresAt} className="display block bg-ink px-3 text-5xl" />
          </div>
        </div>
      </aside>

      {open && all.some((x) => x.id === open) && (
        <StageViewer
          list={all}
          index={all.findIndex((x) => x.id === open)}
          onIndex={(i) => all[i] && setOpen(all[i].id)}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
