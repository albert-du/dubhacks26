"use client";

import { FireIcon } from "@/components/Brand";
import { ReactionBar } from "@/components/Reactions";
import { engagement, fireRank, type ReactionKey } from "@/lib/reactions";
import type { PublicMedia } from "@/lib/types";

/** Leaderboard built only from people's flaming-dumpster reactions; other reactions break ties. */
export function Fire({
  media,
  onReact,
  onOpen,
}: {
  media: PublicMedia[];
  onReact: (id: string, key: ReactionKey) => void;
  onOpen: (list: PublicMedia[], id: string) => void;
}) {
  const ranked = fireRank(media);
  const [top, ...rest] = ranked;

  return (
    <section>
      <div className="flex items-end justify-between gap-3 border-b-3 border-ink px-4 pt-5 pb-4">
        <div>
          <h2 className="display text-[clamp(2.5rem,12vw,4rem)]">
            Dumpster
            <br />
            <span className="bg-fire px-1">fire</span>
          </h2>
          <p className="mt-3 text-sm leading-snug">Tap the burning can on any shot. Most fires wins.</p>
        </div>
        <FireIcon size={96} className="shrink-0" />
      </div>

      {!top && (
        <div className="px-4 py-10">
          <p className="display text-3xl">Nothing’s burning yet.</p>
          <p className="mt-2">Open a photo and hit the flaming can to start the fire.</p>
        </div>
      )}

      {top && (
        <article className="border-b-3 border-ink">
          <button className="relative block w-full" onClick={() => onOpen(ranked, top.id)}>
            <Thumb m={top} className="block max-h-[60dvh] w-full object-cover" />
            <span className="display absolute top-0 left-0 bg-fire px-2 text-6xl leading-none">01</span>
          </button>
          <div className="p-3">
            <ReactionBar m={top} onReact={(k) => onReact(top.id, k)} />
          </div>
        </article>
      )}

      <ol>
        {rest.map((m, i) => (
          <li key={m.id} className="grid grid-cols-[3rem_80px_1fr] border-b border-ink">
            <span className="display border-r border-ink pt-2 text-center text-2xl">{String(i + 2).padStart(2, "0")}</span>
            <button onClick={() => onOpen(ranked, m.id)} className="size-20 overflow-hidden border-r border-ink">
              <Thumb m={m} className="size-full object-cover" />
            </button>
            <div className="flex min-w-0 flex-col justify-center gap-1 px-3 py-2">
              <p className="flex items-center gap-1.5">
                <FireIcon size={26} />
                <span className="display text-2xl tabular-nums">{m.reactions.fire}</span>
              </p>
              <p className="label text-smoke">{engagement(m.reactions)} other reactions</p>
              <button
                onClick={() => onReact(m.id, "fire")}
                aria-pressed={m.myReactions.includes("fire")}
                className={`label self-start border-2 px-2 py-1 ${m.myReactions.includes("fire") ? "border-fire bg-fire" : "border-ink"}`}
              >
                {m.myReactions.includes("fire") ? "You lit this" : "Add fuel"}
              </button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Thumb({ m, className }: { m: PublicMedia; className: string }) {
  return m.kind === "image" ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={m.url} alt={m.caption ?? ""} loading="lazy" className={className} />
  ) : (
    <video src={`${m.url}#t=0.1`} muted playsInline preload="metadata" className={className} />
  );
}
