"use client";

import { useEffect, useState } from "react";
import { FireIcon } from "@/components/Brand";
import { Burned } from "@/components/Burned";
import { Countdown } from "@/components/ui";
import { useRoom } from "@/lib/client/useRoom";
import { fireRank } from "@/lib/reactions";
import type { RoomState } from "@/lib/types";

interface Stats {
  velocity: { t: string; n: number }[];
  photos: number;
  people: number;
  faces: number;
}

/** Projector / TV view: live mosaic, giant QR, upload velocity, countdown. */
export function Stage({ initial }: { initial: RoomState }) {
  const { state, destroyed } = useRoom(initial);
  const [stats, setStats] = useState<Stats | null>(null);
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
  const fire = fireRank(state.media.filter((m) => m.kind === "image"))[0];
  const bars = buildBars(stats?.velocity ?? []);
  const peak = Math.max(1, ...bars);
  const perMin = bars.slice(-5).reduce((s, n) => s + n, 0) / 5;

  return (
    <div className="grid min-h-dvh bg-ink text-paper lg:grid-cols-[1fr_400px]">
      <main className="grid auto-rows-[24vh] grid-cols-2 gap-[3px] p-[3px] md:grid-cols-4">
        {latest.length === 0 && (
          <div className="col-span-full row-span-3 grid place-items-center">
            <p className="display text-center text-[8vw]">
              Waiting for
              <br />
              the first throw.
            </p>
          </div>
        )}
        {latest.map((m, i) => (
          <figure key={m.id} className={`relative overflow-hidden bg-[#222] ${i === 0 ? "col-span-2 row-span-2" : ""}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.url} alt="" className={`size-full object-cover ${i === 0 ? "animate-drop" : ""}`} />
            {i === 0 && <figcaption className="display absolute top-3 left-3 bg-green px-2 py-1 text-xl text-ink">Just dropped</figcaption>}
            {i === 0 && m.caption && (
              <figcaption className="absolute right-0 bottom-0 left-0 bg-ink/85 p-3 text-lg">{m.caption}</figcaption>
            )}
          </figure>
        ))}
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
            ["Faces", stats?.faces ?? state.clusters.length],
            ["Opted in", stats?.people ?? 0],
          ].map(([k, v], i) => (
            <div key={k} className={`p-3 ${i ? "border-l-3 border-paper" : ""}`}>
              <dt className="label">{k}</dt>
              <dd className="display text-4xl tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="label">Uploads / min · last 15</span>
            <span className="display text-2xl tabular-nums">{perMin.toFixed(1)}</span>
          </div>
          <div className="flex h-20 items-end gap-[3px] border-b-3 border-paper" role="img" aria-label="Upload velocity">
            {bars.map((n, i) => (
              <div key={i} className={`flex-1 ${i === bars.length - 1 ? "bg-green" : "bg-paper"}`} style={{ height: `${(n / peak) * 100}%` }} />
            ))}
          </div>
        </div>

        {fire && (
          <div className="grid grid-cols-[96px_1fr] border-3 border-fire">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fire.url} alt="" className="size-24 object-cover" />
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
          <p className="label mb-1">Self-destructs in</p>
          <div className="hazard p-2">
            <Countdown expiresAt={state.dumpster.expiresAt} className="display block bg-ink px-3 text-5xl" />
          </div>
        </div>
      </aside>
    </div>
  );
}

/** 15 one-minute buckets ending now, zero-filled. */
function buildBars(velocity: { t: string; n: number }[]) {
  const now = Math.floor(Date.now() / 60_000);
  const byMin = new Map(velocity.map((v) => [Math.floor(Date.parse(v.t) / 60_000), v.n]));
  return Array.from({ length: 15 }, (_, i) => byMin.get(now - 14 + i) ?? 0);
}
