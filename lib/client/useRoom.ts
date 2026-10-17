"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicCluster, PublicMedia, PublicSticker, RoomState } from "@/lib/types";

function sortMedia(list: PublicMedia[]) {
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Room state + live updates over SSE. `onReady` gets the ids of media that just finished processing. */
export function useRoom(initial: RoomState, onReady?: (ids: string[]) => void) {
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
        for (const x of incoming) byId.set(x.id, x);
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
      navigator.serviceWorker?.controller?.postMessage({ type: "forget-room", path: `/${id}` });
    });
    return () => es.close();
  }, [id, initial.cursor, mergeMedia]);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/dumpsters/${id}`, { cache: "no-store" });
    if (r.status === 404) return setDestroyed(true);
    if (r.ok) setState(await r.json());
  }, [id]);

  const vote = useCallback(
    async (mediaId: string) => {
      // Optimistic toggle; the server's answer wins.
      setState((s) => ({
        ...s,
        media: s.media.map((m) => (m.id === mediaId ? { ...m, voted: !m.voted, votes: m.votes + (m.voted ? -1 : 1) } : m)),
      }));
      const r = await fetch(`/api/dumpsters/${id}/media/${mediaId}/vote`, { method: "POST" });
      if (r.ok) {
        const { voted, votes } = await r.json();
        setState((s) => ({ ...s, media: s.media.map((m) => (m.id === mediaId ? { ...m, voted, votes } : m)) }));
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

  const makeSticker = useCallback(
    async (mediaId: string, subject: number) => {
      const r = await fetch(`/api/dumpsters/${id}/media/${mediaId}/sticker`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject }),
      });
      if (r.ok) {
        const st: PublicSticker = await r.json();
        setState((s) => ({ ...s, stickers: [st, ...s.stickers.filter((x) => x.id !== st.id)] }));
      }
      return r.ok;
    },
    [id],
  );

  return { state, destroyed, refresh, vote, remove, makeSticker };
}
