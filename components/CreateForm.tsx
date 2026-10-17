"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setHostToken } from "@/lib/client/useRoom";

const TTLS = [24, 48, 72] as const;

export function CreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [ttl, setTtl] = useState<(typeof TTLS)[number]>(24);
  const [phone, setPhone] = useState("");
  const [blur, setBlur] = useState(true);
  const [redact, setRedact] = useState(true);
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
      body: JSON.stringify({
        name,
        ttlHours: ttl,
        hostPhone: phone || undefined,
        settings: { blurNonConsented: blur, redactSensitiveText: redact, allowVideo: video },
      }),
    }).catch(() => null);
    const body = await r?.json().catch(() => ({}));
    if (!r?.ok) {
      setError(body?.error ?? "No connection. Try again.");
      setBusy(false);
      return;
    }
    setHostToken(body.id, body.hostToken);
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
        <legend className="label mb-1">Self-destruct after</legend>
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

      <label className="block">
        <span className="label mb-1 block">Your phone (optional) — for the burn warning</span>
        <input className="field" type="tel" inputMode="tel" placeholder="+1 206 555 0123" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>

      <fieldset className="border-3 border-ink">
        <legend className="label px-1 ml-2">Privacy</legend>
        <Toggle checked={blur} onChange={setBlur} title="Blur strangers" note="Faces stay blurred until that person opts in with a selfie." />
        <Toggle checked={redact} onChange={setRedact} title="Redact sensitive text" note="IDs, plates, card numbers in the background get blurred." />
        <Toggle checked={video} onChange={setVideo} title="Allow video" note="Videos are transcribed but not face-blurred." last />
      </fieldset>

      {error && <p className="border-3 border-fire bg-fire/15 p-3 text-sm">{error}</p>}

      <button className="btn btn-green w-full !text-2xl !py-5" disabled={busy || !name.trim()}>
        {busy ? "Opening…" : "Open the Dumpster →"}
      </button>
    </form>
  );
}

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; title: string; note: string; last?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 p-3 ${props.last ? "" : "border-b border-ink"}`}>
      <input type="checkbox" className="peer sr-only" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span
        aria-hidden
        className="mt-0.5 grid size-6 shrink-0 place-items-center border-3 border-ink font-bold peer-checked:bg-green peer-focus-visible:outline-3 peer-focus-visible:outline-green"
      >
        {props.checked ? "✓" : ""}
      </span>
      <span>
        <span className="block font-bold uppercase">{props.title}</span>
        <span className="block text-sm text-smoke">{props.note}</span>
      </span>
    </label>
  );
}
