"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MarkBlock } from "@/components/Brand";
import { Burned } from "@/components/Burned";
import { Countdown } from "@/components/ui";
import { useDumpster } from "@/lib/client/useDumpster";
import { useUploader } from "@/lib/client/useUploader";
import { setRevealEnabled } from "@/lib/client/reveal";
import { warmMap } from "@/lib/client/warm";
import { withTab, type Tab } from "@/lib/tabs";
import type { PublicMedia, DumpsterState } from "@/lib/types";
import { Drop } from "./Drop";
import { EventMap } from "./EventMap";
import { Fire } from "./Fire";
import { Me } from "./Me";
import { SignIn } from "./SignIn";
import { Pack } from "./Pack";
import { Dump } from "./Dump";
import { Viewer } from "./Viewer";

export type { Tab };

export type Filter =
  | { kind: "faces"; ids: string[]; label: string; name?: string }
  | { kind: "shots"; ids: string[]; label: string };

const TABS: { id: Tab; label: string }[] = [
  { id: "drop", label: "Drop" },
  { id: "dump", label: "dump" },
  { id: "fire", label: "Fire" },
  { id: "map", label: "Map" },
  { id: "pack", label: "Pack" },
  { id: "me", label: "Me" },
];

export function inFilter(m: PublicMedia, filter: Filter | null) {
  if (filter?.kind === "faces") {
    const inFrame = m.faces.some((f) => f.clusterId && !f.hidden && filter.ids.includes(f.clusterId));
    const mentioned = !!filter.name && m.mentions.includes(filter.name);
    return inFrame || mentioned;
  }
  if (filter?.kind === "shots") return filter.ids.includes(m.id);
  return true;
}

export function DumpsterView({ initial, showMine, tab: startTab }: { initial: DumpsterState; showMine: boolean; tab: Tab }) {
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

  const [tab, setTab] = useState<Tab>(startTab);
  /** Screens stay mounted after the first visit so their photos, stickers, and map are still there. */
  const [visited, setVisited] = useState<Tab[]>([startTab]);
  // The screen is React state unless the query remembers it. A reload then opens
  // the same tab instead of falling back to dump. A fresh history state lets Next
  // adopt the url; reusing its state skips that, and the next router update puts
  // the address bar back. replace keeps this history entry, so Back still leaves.
  const rememberTab = useCallback((next: Tab) => {
    const nextSearch = withTab(window.location.search, next);
    if (nextSearch === window.location.search) return;
    window.history.replaceState(null, "", `${window.location.pathname}${nextSearch}${window.location.hash}`);
  }, []);
  const goTo = (next: Tab) => {
    setTab(next);
    setVisited((cur) => (cur.includes(next) ? cur : [...cur, next]));
    rememberTab(next);
  };
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

  // The first visit has no tab in the url yet. Later switches also write from goTo,
  // before this effect, so a reload in that gap still lands on the screen they picked.
  useEffect(() => {
    rememberTab(tab);
  }, [rememberTab, tab]);

  // The map library starts loading while the guest is still on another tab.
  // Previews stay on the row queue so a background pass cannot jump the first screen.
  useEffect(() => {
    if (!state.me) return;
    warmMap();
  }, [state.me]);

  useEffect(() => {
    const lists: [string, Tab][] = [
      ["dump", "dump"],
      ["dump-faces", "dump"],
      ["dump-hidden", "dump"],
      ["fire-list", "fire"],
      ["pack", "pack"],
      ["map-pins", "map"],
      ["map-grid", "map"],
      ["map-moments", "map"],
    ];
    for (const [name, tabId] of lists) setRevealEnabled(name, tab === tabId);
  }, [tab]);

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
      <div className="mx-auto min-h-svh w-full max-w-[430px]">
        {header}
        <SignIn
          dumpster={state.dumpster}
          me={state.me}
          clusters={state.clusters}
          onSignedIn={dumpster.refresh}
          onEnrolled={() => setOnboarding(true)}
          onDone={() => setOnboarding(false)}
        />
      </div>
    );
  const me = state.me;

  return (
    <div className="mx-auto min-h-svh w-full max-w-[430px] pb-[calc(64px+env(safe-area-inset-bottom))]">
      {header}

      <main>
        {tab === "drop" && <Drop dumpster={state.dumpster} uploader={uploader} onCopyLink={copyLink} copied={copied} />}
        {visited.includes("dump") && (
          <div hidden={tab !== "dump"} inert={tab !== "dump"} className={tab === "dump" ? undefined : "hidden"}>
            <Dump
              onNameFaces={dumpster.nameFaces}
              onHideFace={dumpster.hideFace}
              hiddenFaces={state.hiddenFaces}
              onUnhideFace={dumpster.unhideFace}
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
              goTo={goTo}
            />
          </div>
        )}
        {visited.includes("fire") && (
          <div hidden={tab !== "fire"} inert={tab !== "fire"} className={tab === "fire" ? undefined : "hidden"}>
            <Fire media={state.media} onReact={dumpster.react} onOpen={open} />
          </div>
        )}
        {visited.includes("map") && (
          // Stay in the viewport. Sliding the canvas off-screen made the phone drop its drawing, so the map came back blank.
          <div
            inert={tab !== "map"}
            aria-hidden={tab !== "map"}
            className={
              tab === "map"
                ? undefined
                : "pointer-events-none fixed top-24 left-1/2 z-media w-full max-w-[430px] -translate-x-1/2 opacity-0"
            }
          >
            <EventMap media={state.media} onOpen={open} guestId={me.guestId} active={tab === "map"} />
          </div>
        )}
        {visited.includes("pack") && (
          <div hidden={tab !== "pack"} inert={tab !== "pack"} className={tab === "pack" ? undefined : "hidden"}>
            <Pack stickers={state.stickers} goTo={goTo} onRetry={dumpster.makeSticker} onDelete={dumpster.deleteSticker} />
          </div>
        )}
        {visited.includes("me") && (
          <div hidden={tab !== "me"} inert={tab !== "me"} className={tab === "me" ? undefined : "hidden"}>
            <Me
              dumpster={state.dumpster}
              me={me}
              // No face matched yet means no shots of you, not every shot.
              photosOfMe={mineFilter(state) ? state.media.filter((m) => inFilter(m, mineFilter(state))).length : 0}
              onChanged={dumpster.refresh}
              goTo={goTo}
              onShowMine={() => {
                setFilter(mineFilter(state));
                goTo("dump");
              }}
            />
          </div>
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
                  onClick={() => goTo(t.id)}
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
          clusters={state.clusters}
          myClusterIds={me.clusterIds}
          onClaim={dumpster.claimFace}
          onHideFace={dumpster.hideFace}
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
            goTo("dump");
          }}
        />
      )}
    </div>
  );
}
