"use client";

import { useMemo, useState } from "react";
import { FireIcon } from "@/components/Brand";
import { FaceThumb, frameNo } from "@/components/ui";
import { groupMoments } from "@/lib/moments";
import { matchSources, SOURCE_LABEL, type MatchSource } from "@/lib/search";
import type { PublicCluster, PublicMedia, RoomState } from "@/lib/types";
import { inFilter, type Filter, type Tab } from "./Room";

type View = "grid" | "moments";

export function Pool(props: {
  media: PublicMedia[];
  byId: Map<string, PublicMedia>;
  frames: Map<string, number>;
  names: Map<string, string>;
  clusters: PublicCluster[];
  me?: RoomState["me"];
  filter: Filter | null;
  setFilter: (f: Filter | null) => void;
  mine: Filter | null;
  q: string;
  setQ: (q: string) => void;
  onOpen: (list: PublicMedia[], id: string) => void;
  goTo: (t: Tab) => void;
}) {
  const { media, clusters, filter, setFilter, q } = props;
  const [view, setView] = useState<View>("grid");
  const [showDupes, setShowDupes] = useState(false);

  const myIds = new Set(props.me?.clusterIds ?? []);
  const others = clusters.filter((c) => !myIds.has(c.id));
  const activeIds = filter?.kind === "faces" ? filter.ids.join() : "";
  const mineIds = props.mine?.kind === "faces" ? props.mine.ids.join() : "";
  const myCover = clusters.find((c) => myIds.has(c.id) && c.cover)?.cover;

  // Filter → search → duplicates. A duplicate only counts while its original is still here.
  const { results, sources, dupes } = useMemo(() => {
    const sources = new Map<MatchSource, number>();
    const matched: PublicMedia[] = [];
    for (const m of media) {
      if (!inFilter(m, filter)) continue;
      const hit = matchSources(m, q, props.names);
      if (!hit) continue;
      hit.forEach((s) => sources.set(s, (sources.get(s) ?? 0) + 1));
      matched.push(m);
    }
    const isDupe = (m: PublicMedia) => !!m.duplicateOf && props.byId.has(m.duplicateOf);
    return {
      results: showDupes ? matched : matched.filter((m) => !isDupe(m)),
      sources,
      dupes: matched.filter(isDupe).length,
    };
  }, [media, filter, q, props.names, props.byId, showDupes]);

  const moments = useMemo(
    () =>
      view === "moments"
        ? groupMoments(
            results.map((m) => ({
              id: m.id,
              t: Date.parse(m.takenAt ?? m.createdAt),
              gps: m.gps,
              venue: m.venue,
              tags: m.tags,
            })),
          ).reverse()
        : [],
    [view, results],
  );

  return (
    <section>
      {/* People */}
      <div className="no-scrollbar flex overflow-x-auto border-b-3 border-ink">
        <FaceButton active={!filter} onClick={() => setFilter(null)} label="Everyone">
          <span className="display grid size-[64px] place-items-center bg-ink text-xl text-paper">ALL</span>
        </FaceButton>
        {props.mine ? (
          <FaceButton active={!!mineIds && activeIds === mineIds} onClick={() => setFilter(props.mine)} label="You">
            {myCover ? (
              <FaceThumb cover={myCover} size={64} />
            ) : (
              <span className="display grid size-[64px] place-items-center bg-green text-lg">YOU</span>
            )}
          </FaceButton>
        ) : (
          <FaceButton active={false} onClick={() => props.goTo("me")} label="Find me">
            <span className="display grid size-[64px] place-items-center border-2 border-dashed border-ink text-3xl">+</span>
          </FaceButton>
        )}
        {others.map((c, i) => (
          <FaceButton
            key={c.id}
            active={activeIds === c.id}
            onClick={() => setFilter({ kind: "faces", ids: [c.id], label: c.name ?? `Person ${i + 1}`, name: c.name })}
            label={`${c.name ?? `#${i + 1}`} · ${c.count}`}
          >
            {c.cover ? <FaceThumb cover={c.cover} size={64} /> : <span className="block size-[64px] bg-bone" />}
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
          placeholder="a dog, a sign, something someone said"
          value={q}
          onChange={(e) => props.setQ(e.target.value)}
          type="search"
          enterKeyHint="search"
        />
      </div>

      {/* Status bar: active filter / search breakdown / view toggle */}
      {(filter || q) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-ink px-3 py-2 text-paper">
          <span className="label">
            {results.length} {results.length === 1 ? "shot" : "shots"}
            {filter ? ` · ${filter.label}` : ""}
          </span>
          {q &&
            [...sources.entries()].map(([s, n]) => (
              <span key={s} className="label text-green">
                {n} {SOURCE_LABEL[s]}
              </span>
            ))}
          {filter && (
            <button className="label ml-auto underline" onClick={() => setFilter(null)}>
              Clear ✕
            </button>
          )}
        </div>
      )}
      <div className="flex items-stretch border-b border-ink">
        {(["grid", "moments"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={`label flex-1 py-2 ${view === v ? "bg-ink text-paper" : ""} ${v === "moments" ? "border-l border-ink" : ""}`}
          >
            {v === "grid" ? "All shots" : "Moments"}
          </button>
        ))}
        {dupes > 0 && (
          <button onClick={() => setShowDupes((v) => !v)} className="label border-l border-ink px-3" aria-pressed={showDupes}>
            {showDupes ? "Hide" : "Show"} {dupes} dupe{dupes === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {results.length === 0 ? (
        <div className="px-4 py-12">
          <p className="display text-5xl">{media.length ? "Nothing matches." : "Empty dumpster."}</p>
          <p className="mt-3">{media.length ? "Try another person or word." : "Be the first to throw something in."}</p>
          {!media.length && (
            <button className="btn btn-green mt-6" onClick={() => props.goTo("drop")}>
              Drop photos →
            </button>
          )}
        </div>
      ) : view === "grid" ? (
        <Grid list={results} {...props} />
      ) : (
        moments.map((mo, i) => {
          const list = mo.ids.map((x) => props.byId.get(x)!).reverse();
          const t = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
          return (
            <section key={mo.id} className="border-b-3 border-ink">
              <header className="px-3 pt-3 pb-2">
                <h3 className="display text-xl leading-none break-words">{mo.label ?? `Moment ${moments.length - i}`}</h3>
                <p className="label mt-1">
                  {t(mo.start)}
                  {mo.end - mo.start > 60_000 ? `–${t(mo.end)}` : ""} · {list.length} {list.length === 1 ? "shot" : "shots"}
                </p>
              </header>
              <Grid list={list} {...props} />
            </section>
          );
        })
      )}
    </section>
  );
}

function Grid({
  list,
  frames,
  byId,
  onOpen,
}: {
  list: PublicMedia[];
  frames: Map<string, number>;
  byId: Map<string, PublicMedia>;
  onOpen: (list: PublicMedia[], id: string) => void;
}) {
  return (
    <ul className="grid grid-cols-3 gap-[3px] bg-ink">
      {list.map((m) => (
        <li key={m.id} className="animate-drop">
          <button onClick={() => onOpen(list, m.id)} className="relative block aspect-square w-full overflow-hidden bg-bone">
            {m.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.url} alt={m.caption ?? ""} loading="lazy" className="z-media relative size-full object-cover" />
            ) : (
              <video src={`${m.url}#t=0.1`} muted playsInline preload="metadata" className="z-media relative size-full object-cover" />
            )}
            <span className="label z-labels absolute bottom-0 left-0 bg-ink px-1 !text-[9px] text-paper">{frameNo(frames.get(m.id) ?? 0)}</span>
            {m.kind === "video" && <span className="label z-labels absolute top-0 left-0 bg-paper px-1 !text-[9px]">▶ Clip</span>}
            {m.duplicateOf && byId.has(m.duplicateOf) && (
              <span className="label z-labels absolute right-0 bottom-0 bg-paper px-1 !text-[9px]">Dupe</span>
            )}
            {m.reactions.fire > 0 && (
              <span className="z-labels absolute top-0 right-0 flex items-center gap-0.5 bg-paper py-0.5 pr-1 pl-0.5">
                <FireIcon size={14} />
                <span className="label !text-[9px] !tracking-normal">{m.reactions.fire}</span>
              </span>
            )}
          </button>
        </li>
      ))}
      {/* Fill the last row so the ink gutter background doesn't show as a black tile. */}
      {Array.from({ length: (3 - (list.length % 3)) % 3 }, (_, i) => (
        <li key={`pad${i}`} className="bg-paper" aria-hidden />
      ))}
    </ul>
  );
}

function FaceButton(props: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className={`flex w-[80px] shrink-0 flex-col items-center gap-1 border-r border-ink p-2 ${props.active ? "bg-green" : ""}`}
      aria-pressed={props.active}
    >
      <span className={`border-2 ${props.active ? "border-ink" : "border-transparent"}`}>{props.children}</span>
      <span className="label w-full truncate text-center !text-[9px] !tracking-wide">{props.label}</span>
    </button>
  );
}
