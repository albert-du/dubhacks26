"use client";

import { FireIcon } from "@/components/Brand";
import { FaceThumb, frameNo } from "@/components/ui";
import type { PublicCluster, PublicMedia, RoomState } from "@/lib/types";
import type { Filter, Tab } from "./Room";

export function Pool(props: {
  media: PublicMedia[];
  total: number;
  frames: Map<string, number>;
  clusters: PublicCluster[];
  me?: RoomState["me"];
  filter: Filter | null;
  setFilter: (f: Filter | null) => void;
  mine: Filter | null;
  q: string;
  setQ: (q: string) => void;
  onOpen: (id: string) => void;
  goTo: (t: Tab) => void;
}) {
  const { media, clusters, filter, setFilter } = props;
  const myIds = new Set(props.me?.clusterIds ?? []);
  const others = clusters.filter((c) => !myIds.has(c.id));
  const activeIds = filter?.kind === "faces" ? filter.ids.join() : "";
  const mineIds = props.mine?.kind === "faces" ? props.mine.ids.join() : "";
  const myCover = clusters.find((c) => myIds.has(c.id) && c.cover)?.cover;

  return (
    <section>
      {/* Faces strip */}
      <div className="no-scrollbar flex overflow-x-auto border-b-3 border-ink">
        <FaceButton active={!filter} onClick={() => setFilter(null)} label="All">
          <span className="display grid size-[68px] place-items-center bg-ink text-2xl text-paper">ALL</span>
        </FaceButton>
        {props.mine ? (
          <FaceButton active={!!mineIds && activeIds === mineIds} onClick={() => setFilter(props.mine)} label="You">
            {myCover ? (
              <FaceThumb cover={myCover} size={68} />
            ) : (
              <span className="display grid size-[68px] place-items-center bg-green text-xl">YOU</span>
            )}
          </FaceButton>
        ) : (
          <FaceButton active={false} onClick={() => props.goTo("me")} label="Find me">
            <span className="display grid size-[68px] place-items-center border-2 border-dashed border-ink text-3xl">+</span>
          </FaceButton>
        )}
        {others.map((c, i) => (
          <FaceButton
            key={c.id}
            active={activeIds === c.id}
            onClick={() => setFilter({ kind: "faces", ids: [c.id], label: c.name ?? `Face ${i + 1}`, name: c.name })}
            label={`${c.name ?? `Face ${i + 1}`} · ${c.count}`}
          >
            {c.cover ? <FaceThumb cover={c.cover} size={68} /> : <span className="block size-[68px] bg-bone" />}
          </FaceButton>
        ))}
        {others.length === 0 && (
          <p className="label flex items-center px-3 leading-relaxed text-smoke">People show up here as photos land.</p>
        )}
      </div>

      {/* Search */}
      <div className="flex border-b-3 border-ink">
        <span className="label grid place-items-center border-r border-ink px-3">Find</span>
        <input
          className="min-w-0 flex-1 bg-transparent px-3 py-3 text-base outline-none placeholder:text-smoke"
          placeholder="tags, captions, who said what…"
          value={props.q}
          onChange={(e) => props.setQ(e.target.value)}
          type="search"
        />
      </div>

      {filter && (
        <div className="flex items-center justify-between bg-ink px-3 py-2 text-paper">
          <span className="label">
            Showing: {filter.label} · {media.length}
          </span>
          <button className="label underline" onClick={() => setFilter(null)}>
            Clear ✕
          </button>
        </div>
      )}

      {media.length === 0 ? (
        <div className="px-4 py-12">
          <p className="display text-5xl">{props.total ? "Nothing matches." : "Empty dumpster."}</p>
          <p className="mt-3">{props.total ? "Try a different face or search." : "Be the first to throw something in."}</p>
          {!props.total && (
            <button className="btn btn-green mt-6" onClick={() => props.goTo("drop")}>
              Drop photos →
            </button>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-3 gap-[3px] bg-ink">
          {media.map((m) => (
            <li key={m.id} className="animate-drop">
              <button onClick={() => props.onOpen(m.id)} className="relative block aspect-square w-full overflow-hidden bg-bone">
                {m.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt={m.caption ?? ""} loading="lazy" className="size-full object-cover" />
                ) : (
                  <video src={`${m.url}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" />
                )}
                <span className="label absolute bottom-0 left-0 bg-ink px-1 !text-[9px] text-paper">
                  {frameNo(props.frames.get(m.id) ?? 0)}
                </span>
                {m.kind === "video" && <span className="label absolute top-0 left-0 bg-paper px-1 !text-[9px]">▶ Vid</span>}
                {m.reactions.fire > 0 && (
                  <span className="absolute top-0 right-0 flex items-center gap-0.5 bg-paper py-0.5 pr-1 pl-0.5">
                    <FireIcon size={14} />
                    <span className="label !text-[9px] !tracking-normal">{m.reactions.fire}</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FaceButton(props: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className={`flex w-[84px] shrink-0 flex-col items-center gap-1 border-r border-ink p-2 ${props.active ? "bg-green" : ""}`}
      aria-pressed={props.active}
    >
      <span className={`border-2 ${props.active ? "border-ink" : "border-transparent"}`}>{props.children}</span>
      <span className="label w-full truncate text-center !text-[9px] !tracking-wide">{props.label}</span>
    </button>
  );
}
