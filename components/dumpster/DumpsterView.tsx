"use client";

import { useMemo, useState } from "react";
import { MarkBlock } from "@/components/Brand";
import { Burned } from "@/components/Burned";
import { Countdown } from "@/components/ui";
import { useDumpster } from "@/lib/client/useDumpster";
import { useUploader } from "@/lib/client/useUploader";
import type { PublicMedia, DumpsterState } from "@/lib/types";
import { Drop } from "./Drop";
import { EventMap } from "./EventMap";
import { Fire } from "./Fire";
import { Me } from "./Me";
import { SignIn } from "./SignIn";
import { Pack } from "./Pack";
import { Dump } from "./Dump";
import { Viewer } from "./Viewer";

export type Tab = "drop" | "dump" | "fire" | "map" | "pack" | "me";

export type Filter =
  | { kind: "faces"; ids: string[]; label: string; name?: string }
  | { kind: "shots"; ids: string[]; label: string };

const TABS: { id: Tab; label: string }[] = [
  { id: "drop", label: "Drop" },
  { id: "dump", label: "Dump" },
  { id: "fire", label: "Fire" },
  { id: "map", label: "Map" },
  { id: "pack", label: "Pack" },
  { id: "me", label: "Me" },
];

export function inFilter(m: PublicMedia, filter: Filter | null) {
  if (filter?.kind === "faces") {
    const inFrame = m.faces.some((f) => f.clusterId && filter.ids.includes(f.clusterId));
    const mentioned = !!filter.name && m.mentions.includes(filter.name);
    return inFrame || mentioned;
  }
  if (filter?.kind === "shots") return filter.ids.includes(m.id);
  return true;
}

export function DumpsterView({ initial, isNew, showMine }: { initial: DumpsterState; isNew: boolean; showMine: boolean }) {
  const id = initial.dumpster.id;
  const uploader = useUploader(id);
  const dumpster = useDumpster(initial, uploader.settle);
  const { state } = dumpster;

  // "You" = the faces your selfie matched; the name (if someone added one) also finds mentions in videos.
  const mineFilter = (s: DumpsterState): Filter | null => {
    if (!s.me?.clusterIds.length) return null;
    const name = s.clusters.find((c) => s.me!.clusterIds.includes(c.id) && c.name)?.name;
    return { kind: "faces", ids: s.me.clusterIds, label: "You", name };
  };

  const [tab, setTab] = useState<Tab>(showMine ? "dump" : isNew || !initial.media.length ? "drop" : "dump");
  const [filter, setFilter] = useState<Filter | null>(() => (showMine ? mineFilter(initial) : null));
  const [q, setQ] = useState("");
  const [viewing, setViewing] = useState<{ ids: string[]; index: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [onboarding, setOnboarding] = useState(false);

  const byId = useMemo(() => new Map(state.media.map((m) => [m.id, m])), [state.media]);
  const names = useMemo(
    () => new Map(state.clusters.filter((c) => c.name).map((c) => [c.id, c.name!] as [string, string])),
    [state.clusters],
  );
  const frames = useMemo(() => {
    const n = new Map<string, number>();
    state.media.forEach((m, i) => n.set(m.id, state.media.length - i));
    return n;
  }, [state.media]);

  if (dumpster.destroyed) return <Burned />;

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

  const header = (
        <header className="sticky top-0 z-header border-b-3 border-ink bg-paper">
          <div className="flex h-14 items-stretch">
            <MarkBlock />
            <h1 className="display min-w-0 flex-1 self-center truncate px-3 text-[22px] leading-none">{state.dumpster.name}</h1>
            <button
              onClick={copyLink}
              className={`label mr-2 shrink-0 self-center border-2 border-ink px-2 py-1.5 !text-[10px] ${copied ? "bg-ink text-paper" : "bg-green"}`}
              aria-live="polite"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <div className="flex items-center justify-between border-t border-ink pl-3">
            <span className="label">Burns in</span>
            <span className="hazard py-1 pl-6">
              <Countdown expiresAt={state.dumpster.expiresAt} className="display block bg-ink px-2 text-lg text-paper" />
            </span>
          </div>
        </header>
  );

  // Signing in is the door to the dumpster: name, then (first time only) a selfie and an optional number.
  if (!state.me || onboarding)
    return (
      <div className="mx-auto min-h-dvh w-full max-w-[430px]">
        {header}
        <SignIn
          dumpster={state.dumpster}
          me={state.me}
          onSignedIn={dumpster.refresh}
          onEnrolled={() => setOnboarding(true)}
          onDone={() => setOnboarding(false)}
        />
      </div>
    );
  const me = state.me;

  return (
    <div className="mx-auto min-h-dvh w-full max-w-[430px] pb-[calc(64px+env(safe-area-inset-bottom))]">
      {header}

      <main>
        {tab === "drop" && <Drop dumpster={state.dumpster} uploader={uploader} onCopyLink={copyLink} copied={copied} />}
        {tab === "dump" && (
          <Dump
            onNameFaces={dumpster.nameFaces}
            id={id}
            media={state.media}
            byId={byId}
            frames={frames}
            names={names}
            clusters={state.clusters}
            me={state.me}
            filter={filter}
            setFilter={setFilter}
            mine={mineFilter(state)}
            q={q}
            setQ={setQ}
            canAsk={state.canAsk}
            onOpen={open}
            goTo={setTab}
          />
        )}
        {tab === "fire" && <Fire media={state.media} onReact={dumpster.react} onOpen={open} />}
        {tab === "map" && (
          <EventMap media={state.media} onOpen={open} />
        )}
        {tab === "pack" && <Pack stickers={state.stickers} goTo={setTab} onRetry={dumpster.makeSticker} />}
        {tab === "me" && (
          <Me
            dumpster={state.dumpster}
            me={me}
            photosOfMe={state.media.filter((m) => inFilter(m, mineFilter(state))).length}
            onChanged={dumpster.refresh}
            goTo={setTab}
            onShowMine={() => {
              setFilter(mineFilter(state));
              setTab("dump");
            }}
          />
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-nav mx-auto w-full max-w-[430px] border-t-3 border-ink bg-paper pb-[env(safe-area-inset-bottom)]">
        <ul className="grid grid-cols-6">
          {TABS.map((t, i) => {
            const active = tab === t.id;
            const count = t.id === "dump" ? state.media.length : t.id === "pack" ? state.stickers.length : 0;
            return (
              <li key={t.id} className={i ? "border-l border-ink" : ""}>
                <button
                  onClick={() => setTab(t.id)}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex h-16 w-full flex-col items-center justify-center ${
                    active ? "bg-ink text-paper" : t.id === "drop" ? "bg-green" : ""
                  }`}
                >
                  <span className="display text-[14px] leading-none">{t.label}</span>
                  {count > 0 && <span className="label mt-1 !text-[10px] !tracking-normal">{count}</span>}
                  {t.id === "drop" && uploader.items.some((u) => u.state === "waiting") && (
                    <span className="absolute top-1 right-1 size-2 animate-blink bg-fire" aria-label="Photos waiting to send" />
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
          names={names}
          byId={byId}
          onIndex={(index) => setViewing({ ...viewing, index })}
          onClose={() => setViewing(null)}
          onReact={dumpster.react}
          onDelete={dumpster.remove}
          onSticker={dumpster.makeSticker}
          onPerson={(clusterId, name) => {
            setViewing(null);
            setQ("");
            setFilter({ kind: "faces", ids: [clusterId], label: name, name });
            setTab("dump");
          }}
          onSearch={(text) => {
            setViewing(null);
            setFilter(null);
            setQ(text);
            setTab("dump");
          }}
        />
      )}
    </div>
  );
}
