"use client";

import { useEffect, useRef, useState } from "react";
import {
  canShareFiles,
  chooseBatch,
  isIosDevice,
  loadShot,
  mapPool,
  SHARE_BATCH_LIMIT,
  type LoadedShot,
  type SaveShot,
} from "@/lib/saveToPhotos";

/**
 * On iPhone and iPad, Save opens the system share sheet with the photo files
 * so Save Image writes them to the camera roll. Elsewhere, `fallback` keeps
 * the normal download (one file, or a zip when there are several).
 */
export function useSaveShots(shots: SaveShot[], fallback: (shots: SaveShot[]) => void) {
  const key = shots.map((shot) => shot.id).join("\n");
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  const ready = useRef(new Map<string, File>());
  const inflight = useRef(new Map<string, Promise<void>>());
  const pendingRef = useRef<string[]>(shots.map((shot) => shot.id));
  const batchRef = useRef<LoadedShot[] | null>(null);
  const selectionGen = useRef(0);
  const jobGen = useRef(0);
  const sharing = useRef(false);

  const seenKey = useRef(key);
  if (seenKey.current !== key) {
    seenKey.current = key;
    selectionGen.current += 1;
    pendingRef.current = shots.map((shot) => shot.id);
    batchRef.current = null;
  }

  const [phase, setPhase] = useState<"idle" | "preparing" | "confirm" | "error">("idle");
  const [note, setNote] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const [tracked, setTracked] = useState(key);
  if (tracked !== key) {
    setTracked(key);
    setPhase("idle");
    setNote(null);
    setRemaining(null);
  }

  function remember(id: string, file: File) {
    ready.current.delete(id);
    ready.current.set(id, file);
    const keep = new Set(shotsRef.current.map((shot) => shot.id));
    for (const oldest of ready.current.keys()) {
      if (ready.current.size <= SHARE_BATCH_LIMIT) break;
      if (keep.has(oldest)) continue;
      ready.current.delete(oldest);
    }
  }

  function ensure(shot: SaveShot) {
    if (!shot.url || ready.current.has(shot.id)) return Promise.resolve();
    const existing = inflight.current.get(shot.id);
    if (existing) return existing;
    const task = loadShot(shot)
      .then((item) => remember(item.shot.id, item.file))
      .catch(() => {})
      .finally(() => inflight.current.delete(shot.id));
    inflight.current.set(shot.id, task);
    return task;
  }

  function currentPending() {
    const byId = new Map(shotsRef.current.map((shot) => [shot.id, shot]));
    return pendingRef.current.flatMap((id) => {
      const shot = byId.get(id);
      return shot ? [shot] : [];
    });
  }

  function itemsFrom(list: SaveShot[]): LoadedShot[] {
    return list.flatMap((shot) => {
      const file = ready.current.get(shot.id);
      return file ? [{ shot, file }] : [];
    });
  }

  function shareable(items: LoadedShot[]) {
    return chooseBatch(items, (item) => item.file.type, (group) =>
      canShareFiles(
        group.map((item) => item.file),
        (data) => navigator.canShare?.(data),
      ),
    ).batch;
  }

  function prefetch(list: SaveShot[]) {
    const want = list.filter((shot) => shot.kind === "image" && shot.url).slice(0, SHARE_BATCH_LIMIT);
    void mapPool(want, 3, (shot) => ensure(shot));
  }

  useEffect(() => {
    if (!isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)) return;
    // Fetch photos ahead of the tap so Save can open the sheet inside the gesture.
    prefetch(shotsRef.current);
  }, [key]);

  async function shareBatch(batch: LoadedShot[], sel: number) {
    if (sharing.current || selectionGen.current !== sel) return;
    sharing.current = true;
    try {
      await navigator.share({ files: batch.map((item) => item.file) });
      if (selectionGen.current !== sel) return;
      const shared = new Set(batch.map((item) => item.shot.id));
      pendingRef.current = pendingRef.current.filter((id) => !shared.has(id));
      batchRef.current = null;
      const left = pendingRef.current.length;
      setPhase("idle");
      if (!left) {
        // The sheet finished. Offer Save again in case they sent the shots somewhere else.
        pendingRef.current = shotsRef.current.map((shot) => shot.id);
        setRemaining(null);
        setNote(null);
      } else {
        setRemaining(left);
        setNote("Tap Save to add the next ones to your camera roll.");
        prefetch(currentPending());
      }
    } catch (e) {
      if (selectionGen.current !== sel) return;
      const name = (e as { name?: string }).name;
      if (name === "AbortError") {
        batchRef.current = null;
        setPhase("idle");
        setNote(null);
        return;
      }
      if (name === "NotAllowedError") {
        if (phaseRef.current === "confirm") {
          batchRef.current = null;
          setPhase("error");
          setNote("Couldn’t add them to your camera roll. Tap Save to download instead.");
          return;
        }
        batchRef.current = batch;
        setPhase("confirm");
        setNote(batch.length > 1 ? "Tap again to add them to your camera roll." : "Tap again to add it to your camera roll.");
        return;
      }
      batchRef.current = null;
      setPhase("error");
      setNote("Couldn’t add them to your camera roll. Tap Save to download instead.");
    } finally {
      sharing.current = false;
    }
  }

  async function prepare(sel: number) {
    const job = ++jobGen.current;
    setPhase("preparing");
    setNote(null);
    const pendingShots = currentPending();
    const slice = pendingShots.slice(0, SHARE_BATCH_LIMIT);
    const images = slice.filter((shot) => shot.kind === "image");
    const videos = slice.filter((shot) => shot.kind === "video");
    const stale = () => selectionGen.current !== sel || jobGen.current !== job;

    if (images.length) await mapPool(images, 3, (shot) => ensure(shot));
    if (stale()) return;
    const imageBatch = shareable(itemsFrom(images));
    if (imageBatch.length) {
      await shareBatch(imageBatch, sel);
      return;
    }

    if (videos.length) await mapPool(videos, 2, (shot) => ensure(shot));
    if (stale()) return;
    const videoBatch = shareable(itemsFrom(videos));
    if (videoBatch.length) {
      await shareBatch(videoBatch, sel);
      return;
    }

    fallbackRef.current(pendingShots);
    setPhase("idle");
    setNote(null);
  }

  const save = () => {
    const ios = isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
    if (!ios) {
      fallbackRef.current(shotsRef.current);
      return;
    }
    const sel = selectionGen.current;
    if (phaseRef.current === "error") {
      const pending = currentPending();
      fallbackRef.current(pending.length ? pending : shotsRef.current);
      setPhase("idle");
      setNote(null);
      return;
    }
    if (phaseRef.current === "confirm" && batchRef.current?.length) {
      void shareBatch(batchRef.current, sel);
      return;
    }
    const pendingShots = currentPending();
    if (!pendingShots.length) return;
    const slice = pendingShots.slice(0, SHARE_BATCH_LIMIT);
    const allItems = itemsFrom(slice);
    if (allItems.length === slice.length) {
      const batch = shareable(allItems);
      if (batch.length) {
        void shareBatch(batch, sel);
        return;
      }
      fallbackRef.current(pendingShots);
      return;
    }
    // Ready photos open the sheet in this tap, even if a clip is still loading.
    const images = slice.filter((shot) => shot.kind === "image");
    const imageItems = itemsFrom(images);
    if (images.length > 0 && imageItems.length === images.length) {
      const batch = shareable(imageItems);
      if (batch.length) {
        void shareBatch(batch, sel);
        return;
      }
    }
    void prepare(sel);
  };

  const left = remaining ?? shots.length;
  const label =
    phase === "preparing" ? "Saving…" : left > 0 && left < shots.length ? `Save ${left} more` : shots.length > 1 ? `Save ${shots.length}` : "Save";

  return { save, busy: phase === "preparing", note, label };
}
