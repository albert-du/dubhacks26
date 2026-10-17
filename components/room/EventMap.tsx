"use client";

import { useMemo, useState } from "react";
import type { PublicMedia } from "@/lib/types";

/**
 * Tile-free spatial map: shots are projected from GPS onto a local grid, so it works
 * offline and never sends guests' locations to a third-party map provider.
 * Shots without GPS are placed by Perceptron's venue/signage reading on the Venue Board.
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
  const [hover, setHover] = useState<string | null>(null);
  const located = useMemo(() => media.filter((m) => m.gps), [media]);

  const proj = useMemo(() => {
    if (!located.length) return null;
    const lat0 = located.reduce((s, m) => s + m.gps!.lat, 0) / located.length;
    const kx = Math.cos((lat0 * Math.PI) / 180);
    const xs = located.map((m) => m.gps!.lng * kx);
    const ys = located.map((m) => m.gps!.lat);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const span = Math.max(maxX - minX, maxY - minY, 0.0006);
    const ox = (span - (maxX - minX)) / 2;
    const oy = (span - (maxY - minY)) / 2;
    const pts = located.map((m, i) => ({
      m,
      x: 8 + ((xs[i] - minX + ox) / span) * 84,
      y: 8 + ((maxY - ys[i] + oy) / span) * 84,
    }));
    return { pts, meters: Math.round(span * 111_320) };
  }, [located]);

  const venues = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of media) if (m.venue) counts.set(m.venue, (counts.get(m.venue) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [media]);

  return (
    <section>
      <div className="flex items-baseline justify-between border-b-3 border-ink px-4 pt-5 pb-3">
        <h2 className="display text-4xl">The scene</h2>
        <span className="label">{located.length} pinned</span>
      </div>

      <div className="relative aspect-square border-b-3 border-ink bg-bone">
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
          {Array.from({ length: 11 }, (_, i) => (
            <g key={i} stroke="#121212" strokeOpacity={i % 5 === 0 ? 0.35 : 0.12} strokeWidth={0.2}>
              <line x1={i * 10} y1={0} x2={i * 10} y2={100} />
              <line x1={0} y1={i * 10} x2={100} y2={i * 10} />
            </g>
          ))}
          {proj?.pts.map(({ m, x, y }) => (
            <g key={m.id} onClick={() => onOpen(located, m.id)} onMouseEnter={() => setHover(m.id)} className="cursor-pointer">
              <rect x={x - 2} y={y - 2} width={4} height={4} fill={m.aiFire >= 70 ? "#ff5b1f" : "#46a65a"} stroke="#121212" strokeWidth={0.6} />
              {hover === m.id && <rect x={x - 3.2} y={y - 3.2} width={6.4} height={6.4} fill="none" stroke="#121212" strokeWidth={0.4} />}
            </g>
          ))}
        </svg>
        <span className="display absolute top-2 left-3 text-xl">N↑</span>
        {proj && <span className="label absolute right-2 bottom-2 bg-paper px-1">≈ {proj.meters} m across</span>}
        {!proj && (
          <p className="absolute inset-0 grid place-items-center p-8 text-center">
            <span>
              <span className="display block text-2xl">No pins yet.</span>
              Photos with location turned on land here.
            </span>
          </p>
        )}
      </div>

      {hover && proj && (
        <PreviewStrip m={proj.pts.find((p) => p.m.id === hover)!.m} onOpen={() => onOpen(located, hover)} />
      )}

      <div className="px-4 pt-5 pb-2">
        <h3 className="display text-2xl">Venue board</h3>
        <p className="text-sm">Spots read off signs and landmarks in the shots.</p>
      </div>
      {venues.length ? (
        <ul className="border-t border-ink">
          {venues.map(([v, n]) => (
            <li key={v} className="border-b border-ink">
              <button onClick={() => onVenue(v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
                <span className="display text-lg">{v}</span>
                <span className="label">{n} shots →</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="label px-4 pb-6 text-smoke">Nothing read yet.</p>
      )}
      <p className="label px-4 py-4 text-smoke">
        {media.length - located.length} shots have no location. Coordinates are rounded to ~10 m and deleted with the Dumpster.
      </p>
    </section>
  );
}

function PreviewStrip({ m, onOpen }: { m: PublicMedia; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 border-b-3 border-ink p-2 text-left">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {m.kind === "image" && <img src={m.url} alt="" className="size-14 border-2 border-ink object-cover" />}
      <span className="min-w-0">
        <span className="block truncate font-bold">{m.caption ?? "Untitled"}</span>
        <span className="label">{new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · open →</span>
      </span>
    </button>
  );
}
