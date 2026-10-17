"use client";

import { HeatMeter } from "@/components/ui";
import type { PublicMedia } from "@/lib/types";

/** The AI nominates candid chaos (aiFire ≥ 40); the group's 🔥 votes decide the order. */
export function Fire({
  media,
  onVote,
  onOpen,
}: {
  media: PublicMedia[];
  onVote: (id: string) => void;
  onOpen: (list: PublicMedia[], id: string) => void;
}) {
  const ranked = media
    .filter((m) => m.kind === "image" && (m.aiFire >= 40 || m.votes > 0))
    .sort((a, b) => b.votes - a.votes || b.aiFire - a.aiFire);
  const [top, ...rest] = ranked;

  return (
    <section>
      <div className="border-b-3 border-ink px-4 pt-5 pb-4">
        <h2 className="display text-[clamp(2.5rem,12vw,4rem)]">
          Dumpster
          <br />
          <span className="bg-fire px-1">fire</span> rank
        </h2>
        <p className="mt-3 text-sm leading-snug">The AI nominates the candid chaos. You decide what burns brightest.</p>
      </div>

      {!top && (
        <p className="px-4 py-10">
          <span className="display block text-3xl">No fires yet.</span>
          The AI flags bloopers, mid-blink shots and chaos as they land.
        </p>
      )}

      {top && (
        <article className="border-b-3 border-ink">
          <button className="relative block w-full" onClick={() => onOpen(ranked, top.id)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={top.url} alt={top.caption ?? ""} className="block max-h-[60dvh] w-full object-cover" />
            <span className="display absolute top-0 left-0 bg-fire px-2 text-6xl leading-none">01</span>
          </button>
          <Row m={top} onVote={onVote} />
        </article>
      )}

      <ol>
        {rest.map((m, i) => (
          <li key={m.id} className="grid grid-cols-[3.25rem_88px_1fr] border-b border-ink">
            <span className="display border-r border-ink pt-2 text-center text-2xl">{String(i + 2).padStart(2, "0")}</span>
            <button onClick={() => onOpen(ranked, m.id)} className="size-[88px] overflow-hidden border-r border-ink">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url} alt={m.caption ?? ""} loading="lazy" className="size-full object-cover" />
            </button>
            <Row m={m} onVote={onVote} compact />
          </li>
        ))}
      </ol>
    </section>
  );
}

function Row({ m, onVote, compact }: { m: PublicMedia; onVote: (id: string) => void; compact?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${compact ? "p-2" : "p-3"}`}>
      <div className="min-w-0 space-y-1">
        {m.fireReason && <p className={`${compact ? "text-sm" : "display text-lg"} leading-tight`}>{m.fireReason}</p>}
        <HeatMeter value={m.aiFire} />
      </div>
      <button
        onClick={() => onVote(m.id)}
        aria-pressed={m.voted}
        className={`btn shrink-0 ${m.voted ? "btn-fire" : "btn-ghost"} ${compact ? "!px-2 !py-2" : ""}`}
      >
        🔥 {m.votes}
      </button>
    </div>
  );
}
