"use client";

import { useMemo } from "react";
import { groupMoments } from "@/lib/moments";
import type { PublicMedia } from "@/lib/types";

/**
 * Tile-free map of the event: shots are projected onto a local grid, so it works on
 * bad signal and never sends anyone's location to a map provider. Pins are numbered
 * by moment (same time, same place).
 */
export function EventMap({
  media,
  onOpen,
  onVenue,
}: {
  media: PublicMedia[];
  onOpen: (list: PublicMedia[], id: string) => void;
  onVenue: (venue: string) => void;
}) {
  const byId = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const moments = useMemo(
    () =>
      groupMoments(media.map((m) => ({ id: m.id, t: Date.parse(m.takenAt ?? m.createdAt), gps: m.gps, venue: m.venue, tags: m.tags }))),
    [media],
  );

  const proj = useMemo(() => {
    const pinned = moments.filter((mo) => mo.center);
    if (!pinned.length) return null;
    const lat0 = pinned.reduce((s, mo) => s + mo.center!.lat, 0) / pinned.length;
    const kx = Math.cos((lat0 * Math.PI) / 180);
    const xs = pinned.map((mo) => mo.center!.lng * kx);
    const ys = pinned.map((mo) => mo.center!.lat);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const span = Math.max(maxX - minX, maxY - minY, 0.0015);
    const ox = (span - (maxX - minX)) / 2;
    const oy = (span - (maxY - minY)) / 2;
    return {
      pts: pinned.map((mo, i) => ({ mo, x: 16 + ((xs[i] - minX + ox) / span) * 68, y: 16 + ((maxY - ys[i] + oy) / span) * 68 })),
      meters: Math.round(span * 111_320),
    };
  }, [moments]);

  const venues = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of media) if (m.venue) counts.set(m.venue, (counts.get(m.venue) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [media]);

  const openMoment = (ids: string[]) => {
    const list = ids.map((i) => byId.get(i)!).filter(Boolean);
    if (list.length) onOpen(list, list[0].id);
  };
  const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const number = new Map(moments.map((mo, i) => [mo.id, i + 1]));

  return (
    <section>
      <div className="flex items-baseline justify-between border-b-3 border-ink px-4 pt-5 pb-3">
        <h2 className="display text-4xl">The scene</h2>
        <span className="label">{moments.length} moments</span>
      </div>

      <div className="relative aspect-square border-b-3 border-ink bg-bone">
        <svg viewBox="0 0 100 100" className="z-boxes absolute inset-0 size-full" aria-hidden>
          {Array.from({ length: 11 }, (_, i) => (
            <g key={i} stroke="#121212" strokeOpacity={i % 5 === 0 ? 0.35 : 0.12} strokeWidth={0.2}>
              <line x1={i * 10} y1={0} x2={i * 10} y2={100} />
              <line x1={0} y1={i * 10} x2={100} y2={i * 10} />
            </g>
          ))}
        </svg>
        {/* Pins are HTML so their numbers stay crisp and sit above the grid lines. */}
        {proj?.pts.map(({ mo, x, y }) => {
          const fire = mo.ids.some((i) => (byId.get(i)?.reactions.fire ?? 0) > 0);
          return (
            <button
              key={mo.id}
              onClick={() => openMoment(mo.ids)}
              className={`display z-labels absolute grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center border-2 border-ink text-sm ${
                fire ? "bg-fire" : "bg-green"
              }`}
              style={{ left: `${x}%`, top: `${y}%` }}
              aria-label={`Moment ${number.get(mo.id)}, ${mo.ids.length} shots`}
            >
              {number.get(mo.id)}
            </button>
          );
        })}
        <span className="display z-labels absolute top-2 left-3 text-xl">N↑</span>
        {proj && <span className="label z-labels absolute right-2 bottom-2 bg-paper px-1">≈ {proj.meters} m across</span>}
        {!proj && (
          <p className="z-labels absolute inset-0 grid place-items-center p-8 text-center">
            <span>
              <span className="display block text-2xl">No pins yet.</span>
              Shots taken with location on show up here.
            </span>
          </p>
        )}
      </div>

      {moments.length > 0 && (
        <ol>
          {[...moments].reverse().map((mo) => (
            <li key={mo.id} className="border-b border-ink">
              <button onClick={() => openMoment(mo.ids)} className="grid w-full grid-cols-[2.75rem_1fr_auto] items-center gap-3 py-2 pr-3 text-left">
                <span className={`display grid h-full place-items-center border-r border-ink text-lg ${mo.center ? "" : "text-smoke"}`}>
                  {number.get(mo.id)}
                </span>
                <span className="min-w-0">
                  <span className="display block truncate text-lg">{mo.label ?? "Untitled moment"}</span>
                  <span className="label">
                    {time(mo.start)}
                    {mo.end - mo.start > 60_000 ? `–${time(mo.end)}` : ""}
                  </span>
                </span>
                <span className="label">{mo.ids.length} →</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="px-4 pt-5 pb-2">
        <h3 className="display text-2xl">Venue board</h3>
        <p className="text-sm">Places named on signs and landmarks in the shots.</p>
      </div>
      {venues.length ? (
        <ul className="border-t border-ink">
          {venues.map(([v, n]) => (
            <li key={v} className="border-b border-ink">
              <button onClick={() => onVenue(v)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                <span className="display min-w-0 truncate text-lg">{v}</span>
                <span className="label shrink-0">{n} shots →</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="label px-4 pb-6 text-smoke">No places spotted yet.</p>
      )}
    </section>
  );
}
