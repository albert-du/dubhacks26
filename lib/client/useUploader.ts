"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { prepareFile, uploadQueue, type QueuedUpload } from "./uploadQueue";

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
}

function send(u: QueuedUpload, onProgress: (p: number) => void): Promise<{ ok: boolean; status: number; error?: string }> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append("file", u.blob, u.name);
    if (u.lat !== undefined) form.append("lat", String(u.lat));
    if (u.lng !== undefined) form.append("lng", String(u.lng));
    if (u.takenAt !== undefined) form.append("takenAt", String(u.takenAt));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/dumpsters/${u.dumpsterId}/media`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let error: string | undefined;
      try {
        error = JSON.parse(xhr.responseText).error;
      } catch {}
      resolve({ ok: xhr.status < 300, status: xhr.status, error });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0 });
    xhr.send(form);
  });
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
          patch(u.id, { state: "processing", progress: 1 });
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
          kind: u.type.startsWith("video/") ? "video" : "image",
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
      for (const file of Array.from(files)) {
        const id = crypto.randomUUID();
        const kind = file.type.startsWith("video/") ? "video" : "image";
        const preview = kind === "image" ? URL.createObjectURL(file) : undefined;
        setItems((l) => [...l, { id, name: file.name, size: file.size, kind, progress: 0, state: "queued", preview }]);
        const prepared = await prepareFile(file);
        await uploadQueue.add({ ...prepared, id, dumpsterId, addedAt: Date.now() });
      }
      pump();
    },
    [dumpsterId, pump],
  );

  /** Called when a processed item shows up in the live pool. */
  const settle = useCallback((count: number) => {
    setItems((l) => {
      let n = count;
      return l.filter((i) => !(i.state === "processing" && n-- > 0));
    });
  }, []);

  const dismiss = useCallback((id: string) => setItems((l) => l.filter((i) => i.id !== id)), []);

  return { items, add, settle, dismiss };
}
