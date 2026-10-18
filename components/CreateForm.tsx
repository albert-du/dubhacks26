"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const TTLS = [24, 48, 72] as const;

export function CreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [ttl, setTtl] = useState<(typeof TTLS)[number]>(24);
  const [video, setVideo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/dumpsters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, ttlHours: ttl, settings: { allowVideo: video } }),
    }).catch(() => null);
    const body = await r?.json().catch(() => ({}));
    if (!r?.ok) {
      setError(body?.error ?? "Couldn’t reach Dump. Check your connection and try again.");
      setBusy(false);
      return;
    }
    router.push(`/${body.id}?new=1`);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <label className="block">
        <span className="label mb-1 block">Name it</span>
        <input
          className="field display !text-2xl !py-3"
          placeholder="MT. SI HIKE"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          required
        />
      </label>

      <fieldset>
        <legend className="label mb-1">Burns after</legend>
        <div className="grid grid-cols-3 border-3 border-ink">
          {TTLS.map((h, i) => (
            <button
              type="button"
              key={h}
              onClick={() => setTtl(h)}
              aria-pressed={ttl === h}
              className={`display py-4 text-3xl ${i ? "border-l-3 border-ink" : ""} ${ttl === h ? "bg-ink text-paper" : ""}`}
            >
              {h}
              <span className="text-base">H</span>
            </button>
          ))}
        </div>
      </fieldset>

      <label className="flex cursor-pointer items-start gap-3 border-3 border-ink p-3">
        <input type="checkbox" className="peer sr-only" checked={video} onChange={(e) => setVideo(e.target.checked)} />
        <span
          aria-hidden
          className="mt-0.5 grid size-6 shrink-0 place-items-center border-3 border-ink font-bold peer-checked:bg-green peer-focus-visible:outline-3 peer-focus-visible:outline-green"
        >
          {video ? "✓" : ""}
        </span>
        <span>
          <span className="block font-bold uppercase">Videos too</span>
          <span className="block text-sm text-smoke">Let people drop clips as well as photos.</span>
        </span>
      </label>

      {error && <p className="border-3 border-fire bg-fire/15 p-3 text-sm">{error}</p>}

      <button className="btn btn-green w-full !text-2xl !py-5" disabled={busy || !name.trim()}>
        {busy ? "Opening…" : "Open the Dumpster →"}
      </button>
    </form>
  );
}
