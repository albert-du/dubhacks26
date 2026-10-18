"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactionKey } from "@/lib/reactions";
import type { PublicCluster, PublicMedia, PublicSticker, DumpsterState, SameName, StickerTarget } from "@/lib/types";

function sortMedia(list: PublicMedia[]) {
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Dumpster state + live updates over SSE. `onReady` gets the ids of media that just finished processing. */
export function useDumpster(initial: DumpsterState, onReady?: (ids: string[]) => void) {
  const [state, setState] = useState(initial);
  const [destroyed, setDestroyed] = useState(false);
  const id = initial.dumpster.id;

  const mergeMedia = useCallback(
    (incoming: PublicMedia[]) => {
      setState((s) => {
        const byId = new Map(s.media.map((m) => [m.id, m]));
        for (const m of incoming) {
          if (m.status === "ready") byId.set(m.id, m);
          else byId.delete(m.id);
        }
        return { ...s, media: sortMedia([...byId.values()]) };
      });
      onReady?.(incoming.filter((m) => m.status === "ready").map((m) => m.id));
    },
    [onReady],
  );

  useEffect(() => {
    const es = new EventSource(`/api/dumpsters/${id}/stream?since=${encodeURIComponent(initial.cursor)}`);
    es.addEventListener("media", (e) => mergeMedia(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("stickers", (e) => {
      const incoming: PublicSticker[] = JSON.parse((e as MessageEvent).data);
      setState((s) => {
        const byId = new Map(s.stickers.map((x) => [x.id, x]));
        for (const x of incoming) {
          if (x.status === "deleted") byId.delete(x.id);
          else byId.set(x.id, x);
        }
        return { ...s, stickers: [...byId.values()] };
      });
    });
    es.addEventListener("clusters", (e) => {
      const clusters: PublicCluster[] = JSON.parse((e as MessageEvent).data);
      setState((s) => ({ ...s, clusters }));
    });
    es.addEventListener("destroyed", () => {
      setDestroyed(true);
      es.close();
      navigator.serviceWorker?.controller?.postMessage({ type: "forget-dumpster", path: `/${id}` });
    });
    return () => es.close();
  }, [id, initial.cursor, mergeMedia]);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/dumpsters/${id}`, { cache: "no-store" });
    if (r.status === 404) return setDestroyed(true);
    if (r.ok) setState(await r.json());
  }, [id]);

  const react = useCallback(
    async (mediaId: string, key: ReactionKey) => {
      const patch = (fn: (m: PublicMedia) => PublicMedia) =>
        setState((s) => ({ ...s, media: s.media.map((m) => (m.id === mediaId ? fn(m) : m)) }));
      // Optimistic toggle; the server's answer wins.
      patch((m) => {
        const on = m.myReactions.includes(key);
        return {
          ...m,
          myReactions: on ? m.myReactions.filter((k) => k !== key) : [...m.myReactions, key],
          reactions: { ...m.reactions, [key]: Math.max(0, m.reactions[key] + (on ? -1 : 1)) },
        };
      });
      const r = await fetch(`/api/dumpsters/${id}/media/${mediaId}/react`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (r.ok) {
        const { on, reactions } = await r.json();
        patch((m) => ({
          ...m,
          reactions,
          myReactions: on ? [...new Set([...m.myReactions, key])] : m.myReactions.filter((k) => k !== key),
        }));
      }
    },
    [id],
  );

  const remove = useCallback(
    async (mediaId: string) => {
      const r = await fetch(`/api/dumpsters/${id}/media/${mediaId}`, { method: "DELETE" });
      if (r.ok) setState((s) => ({ ...s, media: s.media.filter((m) => m.id !== mediaId) }));
      return r.ok;
    },
    [id],
  );

  /**
   * Name (or clear) one or more faces. Optimistic; the stream confirms. If someone here already
   * goes by that name, nothing changes and `sameName` comes back so the page can ask
   * "same person?"; calling again with `group` folds the faces into theirs.
   */
  const nameFaces = useCallback(
    async (faceIds: string[], name: string, group = false): Promise<{ error?: string; sameName?: SameName }> => {
      const clean = name.trim().slice(0, 40);
      if (!group) {
        setState((s) => ({
          ...s,
          clusters: s.clusters.map((c) => (faceIds.includes(c.id) ? { ...c, name: clean || undefined } : c)),
        }));
      }
      for (const faceId of faceIds) {
        const r = await fetch(`/api/dumpsters/${id}/faces/${faceId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: clean, group }),
        }).catch(() => null);
        if (r?.ok) continue;
        const body = await r?.json().catch(() => null);
        await refresh();
        if (!r) return { error: "Couldn’t reach Dump. Check your signal and try again." };
        return { error: body?.error ?? "Couldn’t save that name.", sameName: body?.sameName };
      }
      if (group) await refresh();
      return {};
    },
    [id, refresh],
  );

  /** Hide a face nobody claimed (a stranger in the background) for everyone. Returns the error, if any. */
  const hideFace = useCallback(
    async (faceId: string): Promise<string | null> => {
      const r = await fetch(`/api/dumpsters/${id}/faces/${faceId}`, { method: "DELETE" }).catch(() => null);
      const error = r?.ok ? null : ((await r?.json().catch(() => null))?.error ?? "Couldn’t reach Dump. Check your signal and try again.");
      await refresh();
      return error;
    },
    [id, refresh],
  );

  /** Bring back a face someone hid. Returns the error, if any. */
  const unhideFace = useCallback(
    async (faceId: string): Promise<string | null> => {
      const r = await fetch(`/api/dumpsters/${id}/faces/${faceId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hidden: false }),
      }).catch(() => null);
      const error = r?.ok ? null : ((await r?.json().catch(() => null))?.error ?? "Couldn’t reach Dump. Check your signal and try again.");
      await refresh();
      return error;
    },
    [id, refresh],
  );

  /** Take a sticker out of the pack for everyone. */
  const deleteSticker = useCallback(
    async (stickerId: string) => {
      const r = await fetch(`/api/dumpsters/${id}/stickers/${encodeURIComponent(stickerId)}`, { method: "DELETE" }).catch(() => null);
      if (r?.ok) setState((s) => ({ ...s, stickers: s.stickers.filter((x) => x.id !== stickerId) }));
      return !!r?.ok;
    },
    [id],
  );

  /** "That's me" on a face nobody has claimed. Returns the error, if any. */
  const claimFace = useCallback(
    async (faceId: string): Promise<string | null> => {
      const r = await fetch(`/api/dumpsters/${id}/faces/${faceId}/claim`, { method: "POST" }).catch(() => null);
      const error = r?.ok ? null : ((await r?.json().catch(() => null))?.error ?? "Couldn’t reach Dump. Check your signal and try again.");
      await refresh();
      return error;
    },
    [id, refresh],
  );

  const makeSticker = useCallback(
    async (mediaId: string, target: StickerTarget) => {
      const r = await fetch(`/api/dumpsters/${id}/media/${mediaId}/sticker`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(target),
      });
      if (r.ok) {
        const st: PublicSticker = await r.json();
        setState((s) => {
          const current = s.stickers.find((x) => x.id === st.id);
          // A fast cut can already be ready by the time this pending response lands.
          if (current && current.status !== "pending" && st.status === "pending") return s;
          return { ...s, stickers: [st, ...s.stickers.filter((x) => x.id !== st.id)] };
        });
      }
      return r.ok;
    },
    [id],
  );

  return { state, destroyed, refresh, react, remove, makeSticker, deleteSticker, nameFaces, claimFace, hideFace, unhideFace };
}
