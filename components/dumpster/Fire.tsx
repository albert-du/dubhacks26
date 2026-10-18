"use client";

import { FireIcon } from "@/components/Brand";
import { ReactionBar } from "@/components/Reactions";
import { ShotImage } from "@/components/ui";
import { topFireFrameStyle } from "@/lib/fireFrame";
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
      <div className="flex items-end justify-between gap-4 border-b-3 border-ink px-4 pt-5 pb-4">
        <div className="min-w-0">
          <h2 className="display text-[clamp(2.25rem,10.5vw,3.5rem)]">
            Dumpster
            <br />
            <span className="hl bg-fire">fire</span>
          </h2>
        </div>
        <FireIcon size={88} className="mr-1" />
      </div>

      {!top && (
        <div className="px-4 py-10">
          <p className="display text-3xl">Nothing’s burning yet.</p>
        </div>
      )}

      {top && (
        <article className="border-b-3 border-ink">
          {/* The container makes 100cqw the board width, so the #1 frame is full size before its file loads. */}
          <div style={{ containerType: "inline-size" }}>
            <button className="relative block w-full" onClick={() => onOpen(ranked, top.id)}>
              <span className="bg-bone" style={topFireFrameStyle(top.width, top.height)}>
                <Thumb m={top} edge={960} eager fill className="absolute inset-0 size-full object-cover" />
                <span className="display z-labels absolute top-0 left-0 bg-fire px-2 text-6xl leading-none">01</span>
              </span>
            </button>
          </div>
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
              <Thumb m={m} group="fire-list" order={i} row={4} className="size-full object-cover" />
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

function Thumb({
  m,
  className,
  edge = 320,
  eager = false,
  fill = false,
  group,
  order,
  row,
}: {
  m: PublicMedia;
  className: string;
  edge?: 320 | 960;
  eager?: boolean;
  /** Cover a frame that is already sized, instead of growing the page when the file arrives. */
  fill?: boolean;
  group?: string;
  order?: number;
  row?: number;
}) {
  const fillStyle = fill
    ? { position: "absolute" as const, inset: 0, width: "100%", height: "100%", objectFit: "cover" as const }
    : undefined;
  return m.kind === "image" ? (
    <ShotImage url={m.url} alt={m.caption ?? ""} edge={edge} eager={eager} group={group} order={order} row={row} className={className} style={fillStyle} />
  ) : (
    <video
      src={`${m.url}#t=0.1`}
      muted
      playsInline
      preload={eager ? "auto" : "metadata"}
      style={fillStyle}
      className={className}
    />
  );
}
