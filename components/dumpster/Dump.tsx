"use client";

import { useMemo, useState } from "react";
import { FireIcon } from "@/components/Brand";
import { FaceThumb, frameNo } from "@/components/ui";
import { prepareFile } from "@/lib/client/uploadQueue";
import { groupMoments } from "@/lib/moments";
import { matchSources, SOURCE_LABEL, type MatchSource } from "@/lib/search";
import type { PublicCluster, PublicMedia, DumpsterState, SameName } from "@/lib/types";
import { inFilter, type Filter, type Tab } from "./DumpsterView";

type View = "grid" | "moments";

export function Dump(props: {
  id: string;
  media: PublicMedia[];
  byId: Map<string, PublicMedia>;
  frames: Map<string, number>;
  names: Map<string, string>;
  clusters: PublicCluster[];
  me?: DumpsterState["me"];
  filter: Filter | null;
  setFilter: (f: Filter | null) => void;
  mine: Filter | null;
  q: string;
  setQ: (q: string) => void;
  canAsk: boolean;
  onNameFaces: (faceIds: string[], name: string, group?: boolean) => Promise<{ error?: string; sameName?: SameName }>;
  onOpen: (list: PublicMedia[], id: string) => void;
  goTo: (t: Tab) => void;
  /** Hide a face nobody claimed (a stranger in the background). Resolves to an error, or null. */
  onHideFace: (faceId: string) => Promise<string | null>;
  /** Faces someone hid, and a way to bring one back. */
  hiddenFaces: PublicCluster[];
  onUnhideFace: (faceId: string) => Promise<string | null>;
}) {
  const { media, clusters, filter, q } = props;
  const [view, setView] = useState<View>("grid");
  const [showDupes, setShowDupes] = useState(false);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ ids: string[]; value: string } | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  /** A name someone here already has: ask whether these faces are the same person before grouping. */
  const [sameName, setSameName] = useState<{ ids: string[]; value: string; holder: SameName } | null>(null);
  const [photoSearching, setPhotoSearching] = useState(false);

  /** Search with a photo: a face finds that person's shots, otherwise the things in it. */
  const searchByPhoto = async (file: File) => {
    setPhotoSearching(true);
    setAskError(null);
    try {
      const { blob, name } = await prepareFile(file);
      const form = new FormData();
      form.append("image", blob, name);
      const r = await fetch(`/api/dumpsters/${props.id}/search-photo`, { method: "POST", body: form });
      const data = (await r.json().catch(() => null)) as { ids?: string[]; people?: string[]; things?: string[]; error?: string } | null;
      if (!r.ok || !data) {
        setAskError(data?.error ?? "Photo search didn’t work. Try words instead.");
        return;
      }
      const ids = data.ids ?? [];
      const what = data.people?.length ? data.people.join(", ") : (data.things ?? []).join(", ");
      props.setQ("");
      setAnswer(ids.length ? `Shots with ${what || "what’s in your photo"}.` : "Nothing in the dump matched that photo.");
      setFilter({ kind: "shots", ids, label: what ? `Photo: ${what}` : "Photo" });
    } catch {
      setAskError("Photo search didn’t work. Try words instead.");
    } finally {
      setPhotoSearching(false);
    }
  };
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (mediaId: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(mediaId)) next.delete(mediaId);
      else next.add(mediaId);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const saveName = async () => {
    if (!naming) return;
    const { ids, value } = naming;
    setNaming(null);
    setSameName(null);
    const { error, sameName: holder } = await props.onNameFaces(ids, value);
    if (holder) return setSameName({ ids, value, holder });
    if (error) return setAskError(error);
    // Keep an active face filter in step with the new name (used for video mentions).
    if (filter?.kind === "faces" && filter.ids.join() === ids.join()) {
      props.setFilter({ ...filter, label: value.trim() || filter.label, name: value.trim() || undefined });
    }
  };

  /** Same person: fold the faces into the one already called that. Different: pick another name. */
  const answerSameName = async (same: boolean) => {
    if (!sameName) return;
    const { ids, holder, value } = sameName;
    setSameName(null);
    if (!same) {
      setAskError(`Two people can’t both be ${holder.name}. Try adding a last initial.`);
      return setNaming({ ids, value });
    }
    const { error } = await props.onNameFaces(ids, holder.name, true);
    if (error) return setAskError(error);
    if (filter?.kind === "faces" && filter.ids.join() === ids.join()) props.setFilter(null);
  };

  const setFilter = (f: Filter | null) => {
    if (!f || f.kind !== "shots") setAnswer(null);
    props.setFilter(f);
  };

  const ask = async () => {
    const query = q.trim();
    if (!props.canAsk || !query || asking) return;
    setAsking(true);
    setAskError(null);
    try {
      const r = await fetch(`/api/dumpsters/${props.id}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: query }),
      });
      const data = (await r.json().catch(() => null)) as { answer?: string; ids?: string[]; error?: string } | null;
      if (!r.ok || !data) {
        setAskError(data?.error ?? "Ask didn't work. The word search still applies.");
        return;
      }
      const ids = data.ids ?? [];
      setAnswer(data.answer || (ids.length ? "Here's what matched." : "Nothing in the dump matched."));
      setFilter({ kind: "shots", ids, label: "Asked" });
    } catch {
      setAskError("Ask didn't work. The word search still applies.");
    } finally {
      setAsking(false);
    }
  };

  const myIds = new Set(props.me?.clusterIds ?? []);
  const others = clusters.filter((c) => !myIds.has(c.id));
  const activeIds = filter?.kind === "faces" ? filter.ids.join() : "";
  const mineIds = props.mine?.kind === "faces" ? props.mine.ids.join() : "";
  const myCover = clusters.find((c) => myIds.has(c.id) && c.cover)?.cover;
  const myName = clusters.find((c) => myIds.has(c.id) && c.name)?.name;

  // Filter → search → duplicates. A duplicate only counts while its original is still here.
  const { results, sources, dupes } = useMemo(() => {
    const sources = new Map<MatchSource, number>();
    const matched: PublicMedia[] = [];
    for (const m of media) {
      if (!inFilter(m, filter)) continue;
      // An Ask result is already the match. Don't also require every word of the question.
      const hit = filter?.kind === "shots" ? [] : matchSources(m, q, props.names);
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
    <section className={selecting ? "pb-14" : ""}>
      {/* People */}
      <div className="no-scrollbar flex overflow-x-auto border-b-3 border-ink">
        <FaceButton active={!filter} onClick={() => setFilter(null)} label="Everyone">
          <span className="display grid size-[64px] place-items-center bg-ink text-xl text-paper">ALL</span>
        </FaceButton>
        {props.mine && (
          <FaceButton
            active={!!mineIds && activeIds === mineIds}
            onClick={() => setFilter(props.mine)}
            label="You"
            name={myName}
            onName={() => setNaming({ ids: [...myIds], value: myName ?? "" })}
          >
            {myCover ? (
              <FaceThumb cover={myCover} size={64} />
            ) : (
              <span className="display grid size-[64px] place-items-center bg-green text-lg">YOU</span>
            )}
          </FaceButton>
        )}
        {others.map((c, i) => (
          <FaceButton
            key={c.id}
            active={activeIds === c.id}
            onClick={() => setFilter({ kind: "faces", ids: [c.id], label: c.name ?? `Person ${i + 1}`, name: c.name })}
            label={`${c.count} shot${c.count === 1 ? "" : "s"}`}
            name={c.name}
            onName={() => setNaming({ ids: [c.id], value: c.name ?? "" })}
          >
            {c.cover ? <FaceThumb cover={c.cover} size={64} /> : <span className="block size-[64px] bg-bone" />}
          </FaceButton>
        ))}
        {props.hiddenFaces.length > 0 && (
          <button
            onClick={() => setShowHidden((v) => !v)}
            aria-expanded={showHidden}
            className={`label shrink-0 self-center px-3 !text-[9px] underline ${showHidden ? "font-bold" : "text-smoke"}`}
          >
            {props.hiddenFaces.length} hidden
          </button>
        )}
        {others.length === 0 && (
          <p className="label flex items-center px-3 leading-relaxed text-smoke">People show up here as photos land.</p>
        )}
      </div>

      {showHidden && props.hiddenFaces.length > 0 && (
        <div className="no-scrollbar flex items-center gap-3 overflow-x-auto border-b-3 border-ink bg-bone px-3 py-2">
          <span className="label shrink-0 !text-[9px]">Hidden</span>
          {props.hiddenFaces.map((c) => (
            <button
              key={c.id}
              className="flex shrink-0 flex-col items-center gap-1"
              aria-label="Unhide this face"
              onClick={async () => {
                const error = await props.onUnhideFace(c.id);
                if (error) setAskError(error);
                if (props.hiddenFaces.length <= 1) setShowHidden(false);
              }}
            >
              {c.cover ? <FaceThumb cover={c.cover} size={40} /> : <span className="block size-10 bg-paper" />}
              <span className="label !text-[9px] underline">Unhide</span>
            </button>
          ))}
        </div>
      )}

      {naming && (
        <form
          className="flex items-stretch border-b-3 border-ink bg-bone"
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <span className="label grid place-items-center border-r border-ink px-3">Name</span>
          <input
            autoFocus
            className="min-w-0 flex-1 bg-transparent px-3 py-3 text-base outline-none placeholder:text-smoke"
            placeholder="Who is this?"
            value={naming.value}
            maxLength={40}
            onChange={(e) => setNaming({ ...naming, value: e.target.value })}
            enterKeyHint="done"
          />
          <button type="submit" className="display border-l-3 border-ink bg-green px-3 text-sm">
            Save
          </button>
          <button type="button" onClick={() => setNaming(null)} className="display border-l border-ink px-3" aria-label="Cancel">
            ✕
          </button>
        </form>
      )}
      {naming && naming.ids.length === 1 && clusters.some((c) => c.id === naming.ids[0] && !c.claimed) && (
        <div className="flex items-center justify-between gap-3 border-b-3 border-ink bg-bone px-3 py-2">
          <span className="text-sm leading-snug">Nobody you know? A stranger in the background?</span>
          <button
            type="button"
            className="btn btn-ghost shrink-0 !px-2 !py-1.5 !text-xs"
            onClick={async () => {
              if (!confirm("Hide this face for everyone? It comes off the face row and the shots, and new shots of it stay hidden.")) return;
              const faceId = naming.ids[0];
              setNaming(null);
              if (filter?.kind === "faces" && filter.ids.includes(faceId)) setFilter(null);
              const error = await props.onHideFace(faceId);
              if (error) setAskError(error);
            }}
          >
            Hide face
          </button>
        </div>
      )}

      {sameName && (
        <div className="space-y-3 border-b-3 border-ink bg-bone p-3">
          <p className="text-sm leading-snug">
            {sameName.holder.signedIn ? (
              <>
                <b>{sameName.holder.name}</b> already signed in here.
              </>
            ) : (
              <>
                There’s already a face called <b>{sameName.holder.name}</b>.
              </>
            )}{" "}
            Same person? Two people can’t share a name.
          </p>
          <div className="flex items-center gap-2">
            {[...sameName.ids, ...sameName.holder.faceIds].map((faceId, i) => {
              const c = clusters.find((x) => x.id === faceId);
              return (
                <span key={faceId} className="flex items-center gap-2">
                  {i === sameName.ids.length && <span className="display text-xl">=?</span>}
                  {c?.cover ? <FaceThumb cover={c.cover} size={56} /> : <span className="block size-14 bg-paper" />}
                </span>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-green !py-2 !text-sm" onClick={() => void answerSameName(true)}>
              Same person
            </button>
            <button className="btn btn-ghost !py-2 !text-sm" onClick={() => void answerSameName(false)}>
              Different person
            </button>
          </div>
        </div>
      )}

      {/* Search. Typing filters on the words. Ask sends the sentence to Backboard. */}
      <form
        className="flex border-b-3 border-ink"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <input
          className="min-w-0 flex-1 truncate bg-transparent px-3 py-3 text-base outline-none placeholder:text-smoke"
          placeholder={props.canAsk ? "Search, or ask a question" : "Things, signs, or words said"}
          aria-label="Search the dump"
          value={q}
          onChange={(e) => {
            props.setQ(e.target.value);
            setAskError(null);
            if (filter?.kind === "shots") setFilter(null);
          }}
          type="search"
          enterKeyHint="search"
        />
        <label
          className={`grid w-12 shrink-0 cursor-pointer place-items-center border-l-3 border-ink ${photoSearching ? "bg-green" : ""}`}
          aria-label="Search with a photo"
          title="Search with a photo"
        >
          {photoSearching ? <span className="display animate-blink">…</span> : <CameraIcon />}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={photoSearching}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void searchByPhoto(f);
            }}
          />
        </label>
        {props.canAsk && (
          <button type="submit" disabled={asking || !q.trim()} className="display border-l-3 border-ink bg-green px-3 text-sm disabled:opacity-40">
            {asking ? "…" : "Ask"}
          </button>
        )}
      </form>
      {answer && <p className="border-b border-ink px-3 py-2 text-sm leading-snug">{answer}</p>}
      {askError && <p className="border-b border-ink bg-fire px-3 py-2 text-sm leading-snug text-ink">{askError}</p>}

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
        {results.length > 0 && (
          <button
            onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
            className={`label border-l border-ink px-3 ${selecting ? "bg-green" : ""}`}
            aria-pressed={selecting}
          >
            Select
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
        <Grid list={results} {...props} selecting={selecting} selected={selected} onToggle={toggle} />
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
              <Grid list={list} {...props} selecting={selecting} selected={selected} onToggle={toggle} />
            </section>
          );
        })
      )}

      {selecting && (
        <SelectBar
          dumpsterId={props.id}
          selected={results.filter((m) => selected.has(m.id))}
          allCount={results.length}
          onAll={() => setSelected(new Set(results.map((m) => m.id)))}
          onNone={() => setSelected(new Set())}
          onDone={stopSelecting}
        />
      )}
    </section>
  );
}

function CameraIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="miter" aria-hidden>
      <path d="M3 7h4l2-3h6l2 3h4v13H3z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

/** Pinned above the tab bar while selecting. One shot saves directly; several come down as a ZIP. */
function SelectBar(props: {
  dumpsterId: string;
  selected: PublicMedia[];
  allCount: number;
  onAll: () => void;
  onNone: () => void;
  onDone: () => void;
}) {
  const n = props.selected.length;
  const save = () => {
    if (n === 1) {
      const url = props.selected[0].url;
      window.location.href = `${url}${url.includes("?") ? "&" : "?"}download=1`;
      return;
    }
    // A real form POST lets the browser stream the ZIP to disk instead of holding it in memory.
    const form = document.createElement("form");
    form.method = "POST";
    form.action = `/api/dumpsters/${props.dumpsterId}/download`;
    for (const m of props.selected) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "ids";
      input.value = m.id;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
    form.remove();
  };
  return (
    <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-nav mx-auto flex w-full max-w-[430px] items-stretch border-t-3 border-ink bg-paper">
      <span className="label flex items-center px-3">{n} selected</span>
      <button className="label ml-auto border-l border-ink px-3" onClick={n === props.allCount ? props.onNone : props.onAll}>
        {n === props.allCount ? "None" : "All"}
      </button>
      <button className="display border-l-3 border-ink bg-green px-4 py-3 text-sm disabled:opacity-40" disabled={!n} onClick={save}>
        {n > 1 ? `Save ${n}` : "Save"}
      </button>
      <button className="display border-l border-ink px-3" onClick={props.onDone} aria-label="Done selecting">
        ✕
      </button>
    </div>
  );
}

function Grid({
  list,
  frames,
  byId,
  onOpen,
  selecting,
  selected,
  onToggle,
}: {
  list: PublicMedia[];
  frames: Map<string, number>;
  byId: Map<string, PublicMedia>;
  onOpen: (list: PublicMedia[], id: string) => void;
  selecting: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="grid grid-cols-3 gap-[3px] bg-ink">
      {list.map((m) => (
        <li key={m.id} className="animate-drop">
          <button
            onClick={() => (selecting ? onToggle(m.id) : onOpen(list, m.id))}
            aria-pressed={selecting ? selected.has(m.id) : undefined}
            className="relative block aspect-square w-full overflow-hidden bg-bone"
          >
            {m.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.url} alt={m.caption ?? ""} loading="lazy" className="z-media relative size-full object-cover" />
            ) : (
              <video src={`${m.url}#t=0.1`} muted playsInline preload="metadata" className="z-media relative size-full object-cover" />
            )}
            <span className="label z-labels absolute bottom-0 left-0 bg-ink px-1 !text-[9px] text-paper">{frameNo(frames.get(m.id) ?? 0)}</span>
            {m.kind === "video" && !selecting && <span className="label z-labels absolute top-0 left-0 bg-paper px-1 !text-[9px]">▶ Clip</span>}
            {m.duplicateOf && byId.has(m.duplicateOf) && (
              <span className="label z-labels absolute right-0 bottom-0 bg-paper px-1 !text-[9px]">Dupe</span>
            )}
            {selecting && (
              <span className={`z-labels absolute inset-0 ${selected.has(m.id) ? "bg-green/40 outline-4 -outline-offset-4 outline-green" : ""}`}>
                <span
                  className={`display absolute top-1 left-1 grid size-6 place-items-center border-2 border-ink text-sm ${selected.has(m.id) ? "bg-green" : "bg-paper/80"}`}
                >
                  {selected.has(m.id) ? "✓" : ""}
                </span>
              </span>
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

function FaceButton(props: {
  active: boolean;
  onClick: () => void;
  label: string;
  /** Faces (not ALL) can be named: shows the name, or a small "+ name" when there isn't one. */
  name?: string;
  onName?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex w-[80px] shrink-0 flex-col items-center border-r border-ink p-2 ${props.active ? "bg-green" : ""}`}>
      <button onClick={props.onClick} aria-pressed={props.active} className="flex flex-col items-center gap-1">
        <span className={`border-2 ${props.active ? "border-ink" : "border-transparent"}`}>{props.children}</span>
        <span className="label w-full truncate text-center !text-[9px] !tracking-wide">{props.label}</span>
      </button>
      {props.onName && (
        <button
          onClick={props.onName}
          className={`label mt-1 w-full truncate text-center !text-[9px] !tracking-wide ${props.name ? "font-bold" : "border border-dashed border-ink py-0.5"}`}
          aria-label={props.name ? `Rename ${props.name}` : "Add a name"}
        >
          {props.name ?? "+ name"}
        </button>
      )}
    </div>
  );
}
