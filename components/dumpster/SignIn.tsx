"use client";

import { useState } from "react";
import type { PublicDumpster } from "@/lib/types";
import { SelfiePicker } from "./Selfie";

/** The door to a dumpster: your name and a quick selfie. No account; it's just for this one. */
export function SignIn({ dumpster, onSignedIn }: { dumpster: PublicDumpster; onSignedIn: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [selfie, setSelfie] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selfie || !name.trim()) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("name", name.trim());
    form.append("selfie", selfie, "selfie.jpg");
    const r = await fetch(`/api/dumpsters/${dumpster.id}/guests`, { method: "POST", body: form }).catch(() => null);
    const body = await r?.json().catch(() => ({}));
    if (!r?.ok) {
      setBusy(false);
      setError(body?.error ?? "Couldn’t reach Dump. Check your signal and try again.");
      return;
    }
    await onSignedIn();
  }

  return (
    <form onSubmit={submit} className="space-y-5 px-4 pt-6 pb-10">
      <h2 className="display text-[clamp(2.5rem,12vw,4rem)]">
        Sign in to
        <br />
        <span className="hl max-w-full bg-green break-words">{dumpster.name}</span>
      </h2>

      <label className="block">
        <span className="label mb-1 block">Your name</span>
        <input
          className="field display !text-2xl !py-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          autoComplete="given-name"
          autoFocus
          required
        />
      </label>

      <div>
        <span className="label mb-1 block">Quick selfie</span>
        <SelfiePicker value={selfie} onChange={setSelfie} />
      </div>

      {error && <p className="border-3 border-fire bg-fire/15 p-3 text-sm">{error}</p>}

      <button className="btn btn-green w-full !py-5 !text-xl" disabled={busy || !selfie || !name.trim()}>
        {busy ? "Getting you in…" : "Get in →"}
      </button>
    </form>
  );
}
