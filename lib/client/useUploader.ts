"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { classifyUpload } from "../uploadKind";
import { blobToSend, prepareFile, uploadQueue, type QueuedUpload } from "./uploadQueue";

export type UploadState = "queued" | "uploading" | "waiting" | "processing" | "failed";

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  kind: "image" | "video";
  progress: number;
  state: UploadState;
  error?: string;
  preview?: string;
  /** Server id once accepted. Kept only in this tab's memory to know when it's live. */
  mediaId?: string;
}

function send(
  u: QueuedUpload,
  onProgress: (p: number) => void,
): Promise<{ ok: boolean; status: number; error?: string; id?: string }> {
  return new Promise((resolve) => {
    void (async () => {
      const form = new FormData();
      let blob: Blob;
      try {
        blob = await blobToSend(u.blob, u.type);
      } catch (err) {
        resolve({ ok: false, status: 400, error: err instanceof Error ? err.message : "Couldn't read that clip on this phone. Drop it again." });
        return;
      }
      form.append("file", blob, u.name);
      if (u.lat !== undefined) form.append("lat", String(u.lat));
      if (u.lng !== undefined) form.append("lng", String(u.lng));
      if (u.takenAt !== undefined) form.append("takenAt", String(u.takenAt));
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/dumpsters/${u.dumpsterId}/media`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let body: { error?: string; id?: string } = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {}
        resolve({ ok: xhr.status < 300, status: xhr.status, error: body.error, id: body.id });
      };
      xhr.onerror = () => resolve({ ok: false, status: 0 });
      try {
        xhr.send(form);
      } catch (err) {
        resolve({ ok: false, status: 400, error: err instanceof Error ? err.message : "Couldn't read that clip on this phone. Drop it again." });
      }
    })();
  });
}

/** Clear the picker after its bytes are copied, so the same clip can be chosen again.
 * Doing it sooner lets iOS revoke the disk file mid-read. */
function releasePicker(files: readonly File[]) {
  if (typeof document === "undefined") return;
  const wanted = new Set<File>(files);
  for (const input of document.querySelectorAll("input[type=file]")) {
    const list = (input as HTMLInputElement).files;
    if (!list) continue;
    for (const picked of list) {
      if (!wanted.has(picked)) continue;
      (input as HTMLInputElement).value = "";
      break;
    }
  }
}

export function useUploader(dumpsterId: string) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const busy = useRef(false);

  const patch = useCallback((id: string, p: Partial<UploadItem>) => {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)));
  }, []);

  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (const u of await uploadQueue.list(dumpsterId)) {
        if (!navigator.onLine) {
          patch(u.id, { state: "waiting" });
          continue;
        }
        patch(u.id, { state: "uploading", progress: 0 });
        const r = await send(u, (progress) => patch(u.id, { progress }));
        if (r.ok) {
          await uploadQueue.remove(u.id);
          patch(u.id, { state: "processing", progress: 1, mediaId: r.id });
        } else if (r.status === 0 || r.status >= 500 || r.status === 429) {
          patch(u.id, { state: "waiting" }); // keep it queued, retry later
        } else {
          await uploadQueue.remove(u.id);
          patch(u.id, { state: "failed", error: r.error ?? `Error ${r.status}` });
        }
      }
    } finally {
      busy.current = false;
    }
  }, [dumpsterId, patch]);

  // Resume anything left over from a previous visit, and retry on reconnect / every 10s.
  useEffect(() => {
    uploadQueue.list(dumpsterId).then((left) => {
      setItems(
        left.map((u) => ({
          id: u.id,
          name: u.name,
          size: u.blob.size,
          kind: classifyUpload(u.type, u.name)?.kind ?? "image",
          progress: 0,
          state: "queued",
        })),
      );
      pump();
    });
    const t = setInterval(pump, 10_000);
    window.addEventListener("online", pump);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", pump);
    };
  }, [dumpsterId, pump]);

  const add = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      for (const file of list) {
        const id = crypto.randomUUID();
        const kind = classifyUpload(file.type, file.name)?.kind ?? "image";
        const preview = kind === "image" ? URL.createObjectURL(file) : undefined;
        setItems((l) => [...l, { id, name: file.name, size: file.size, kind, progress: 0, state: "queued", preview }]);
        try {
          const prepared = await prepareFile(file);
          await uploadQueue.add({ ...prepared, id, dumpsterId, addedAt: Date.now() });
        } catch (err) {
          patch(id, { state: "failed", error: err instanceof Error ? err.message : "Couldn't read that clip on this phone. Drop it again." });
        }
      }
      releasePicker(list);
      pump();
    },
    [dumpsterId, patch, pump],
  );

  /** Called with ids that just went live in the dump; clears the matching rows. */
  const settle = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const live = new Set(ids);
    setItems((l) => l.filter((i) => !(i.mediaId && live.has(i.mediaId))));
  }, []);

  const dismiss = useCallback((id: string) => setItems((l) => l.filter((i) => i.id !== id)), []);

  return { items, add, settle, dismiss };
}
