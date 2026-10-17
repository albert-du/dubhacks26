"use client";

import { useMemo, useState } from "react";
import { MarkBlock } from "@/components/Brand";
import { Burned } from "@/components/Burned";
import { Countdown } from "@/components/ui";
import { useRoom } from "@/lib/client/useRoom";
import { useUploader } from "@/lib/client/useUploader";
import type { PublicMedia, RoomState } from "@/lib/types";
import { Drop } from "./Drop";
import { EventMap } from "./EventMap";
import { Fire } from "./Fire";
import { Me } from "./Me";
import { Pack } from "./Pack";
import { Pool } from "./Pool";
import { Viewer } from "./Viewer";

export type Tab = "drop" | "pool" | "fire" | "map" | "pack" | "me";

export type Filter =
  | { kind: "faces"; ids: string[]; label: string; name?: string }
  | { kind: "venue"; venue: string; label: string };

const TABS: { id: Tab; label: string }[] = [
  { id: "drop", label: "Drop" },
  { id: "pool", label: "Pool" },
  { id: "fire", label: "Fire" },
  { id: "map", label: "Map" },
  { id: "pack", label: "Pack" },
  { id: "me", label: "Me" },
];

function matches(m: PublicMedia, filter: Filter | null, q: string) {
  if (filter?.kind === "faces") {
    const inFrame = m.faces.some((f) => f.clusterId && filter.ids.includes(f.clusterId));
    const mentioned = !!filter.name && m.mentions.includes(filter.name);
    if (!inFrame && !mentioned) return false;
  }
  if (filter?.kind === "venue" && m.venue !== filter.venue) return false;
  if (q) {
    const hay = [m.caption, m.tags.join(" "), m.transcript, m.venue, m.mentions.join(" ")].join(" ").toLowerCase();
    if (!hay.includes(q.toLowerCase())) return false;
  }
  return true;
}

export function Room({ initial, isNew, showMine }: { initial: RoomState; isNew: boolean; showMine: boolean }) {
  const id = initial.dumpster.id;
  const uploader = useUploader(id);
  const room = useRoom(initial, uploader.settle);
  const { state } = room;

  const mineFilter = (s: RoomState): Filter | null =>
    s.me && s.me.clusterIds.length ? { kind: "faces", ids: s.me.clusterIds, label: "You", name: s.me.name } : null;

  const [tab, setTab] = useState<Tab>(showMine ? "pool" : isNew || !initial.media.length ? "drop" : "pool");
  const [filter, setFilter] = useState<Filter | null>(() => (showMine ? mineFilter(initial) : null));
  const [q, setQ] = useState("");
  const [viewing, setViewing] = useState<{ ids: string[]; index: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const visible = useMemo(() => state.media.filter((m) => matches(m, filter, q)), [state.media, filter, q]);
  const byId = useMemo(() => new Map(state.media.map((m) => [m.id, m])), [state.media]);
  const frames = useMemo(() => {
    const n = new Map<string, number>();
    state.media.forEach((m, i) => n.set(m.id, state.media.length - i));
    return n;
  }, [state.media]);

  if (room.destroyed) return <Burned />;

  const copyLink = async () => {
    const url = `${window.location.origin}/${id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link", url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const open = (list: PublicMedia[], mediaId: string) =>
    setViewing({ ids: list.map((m) => m.id), index: Math.max(0, list.findIndex((m) => m.id === mediaId)) });

  const viewList = viewing ? (viewing.ids.map((i) => byId.get(i)).filter(Boolean) as PublicMedia[]) : [];

  return (
    <div className="mx-auto min-h-dvh max-w-xl pb-[calc(64px+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-30 border-b-3 border-ink bg-paper">
        <div className="flex items-stretch">
          <MarkBlock />
          <h1 className="display min-w-0 flex-1 self-center truncate px-3 py-3 text-2xl leading-none">{state.dumpster.name}</h1>
          <button
            onClick={copyLink}
            className={`display shrink-0 border-l-3 border-ink px-3 text-sm leading-tight ${copied ? "bg-ink text-paper" : "bg-green"}`}
            aria-live="polite"
          >
            {copied ? (
              "Copied!"
            ) : (
              <>
                Copy
                <br />
                link
              </>
            )}
          </button>
        </div>
        <div className="flex items-center justify-between border-t border-ink pl-3">
          <span className="label">Self-destructs in</span>
          <span className="hazard py-1 pl-6">
            <Countdown expiresAt={state.dumpster.expiresAt} className="display block bg-ink px-2 text-lg text-paper" />
          </span>
        </div>
      </header>

      <main>
        {tab === "drop" && <Drop dumpster={state.dumpster} uploader={uploader} onCopyLink={copyLink} copied={copied} />}
        {tab === "pool" && (
          <Pool
            media={visible}
            total={state.media.length}
            frames={frames}
            clusters={state.clusters}
            me={state.me}
            filter={filter}
            setFilter={setFilter}
            mine={mineFilter(state)}
            q={q}
            setQ={setQ}
            onOpen={(mid) => open(visible, mid)}
            goTo={setTab}
          />
        )}
        {tab === "fire" && <Fire media={state.media} onVote={room.vote} onOpen={open} />}
        {tab === "map" && (
          <EventMap
            media={state.media}
            onOpen={open}
            onVenue={(venue) => {
              setFilter({ kind: "venue", venue, label: venue });
              setTab("pool");
            }}
          />
        )}
        {tab === "pack" && <Pack stickers={state.stickers} goTo={setTab} />}
        {tab === "me" && (
          <Me
            dumpster={state.dumpster}
            me={state.me}
            photosOfMe={state.me ? state.media.filter((m) => matches(m, mineFilter(state), "")).length : 0}
            onEnrolled={room.refresh}
            onShowMine={() => {
              setFilter(mineFilter(state));
              setTab("pool");
            }}
          />
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-xl border-t-3 border-ink bg-paper pb-[env(safe-area-inset-bottom)]">
        <ul className="grid grid-cols-6">
          {TABS.map((t, i) => {
            const active = tab === t.id;
            const count = t.id === "pool" ? state.media.length : t.id === "pack" ? state.stickers.length : 0;
            return (
              <li key={t.id} className={i ? "border-l border-ink" : ""}>
                <button
                  onClick={() => setTab(t.id)}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex h-16 w-full flex-col items-center justify-center ${
                    active ? "bg-ink text-paper" : t.id === "drop" ? "bg-green" : ""
                  }`}
                >
                  <span className="display text-[15px] leading-none">{t.label}</span>
                  {count > 0 && <span className="label mt-1 !text-[10px] !tracking-normal">{count}</span>}
                  {t.id === "drop" && uploader.items.some((u) => u.state === "waiting") && (
                    <span className="absolute top-1 right-1 size-2 animate-blink bg-fire" aria-label="uploads waiting" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {viewing && viewList.length > 0 && (
        <Viewer
          list={viewList}
          index={Math.min(viewing.index, viewList.length - 1)}
          frames={frames}
          clusters={state.clusters}
          onIndex={(index) => setViewing({ ...viewing, index })}
          onClose={() => setViewing(null)}
          onVote={room.vote}
          onDelete={room.remove}
          onSticker={async (mid, subject) => {
            const ok = await room.makeSticker(mid, subject);
            return ok;
          }}
        />
      )}
    </div>
  );
}
