"use client";

import { useState } from "react";
import type { DumpsterState, PublicDumpster } from "@/lib/types";
import { NotificationSettings } from "./NotificationSettings";
import { SelfiePicker } from "./Selfie";

type Step = "name" | "returning" | "selfie" | "phone";

/**
 * The door to a dumpster. Your name first. Been here before? That's all it takes.
 * New here: a quick selfie, then an optional number for texts when you show up in new shots.
 * No account; it's just for this one.
 */
export function SignIn({ dumpster, me, onSignedIn, onEnrolled, onDone }: {
  dumpster: PublicDumpster;
  me?: DumpsterState["me"];
  onSignedIn: () => Promise<void>;
  /** The guest exists now; keep this screen up for the phone step. */
  onEnrolled: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<Step>(me ? "phone" : "name");
  const [name, setName] = useState(me?.name ?? "");
  const [selfie, setSelfie] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/dumpsters/${dumpster.id}/guests`;

  async function send(init: RequestInit) {
    setBusy(true);
    setError(null);
    const r = await fetch(base, { method: "POST", ...init }).catch(() => null);
    const body = await r?.json().catch(() => ({}));
    setBusy(false);
    if (!r?.ok) {
      setError(body?.error ?? "Couldn’t reach Dump. Check your signal and try again.");
      return null;
    }
    return body;
  }

  const byName = (confirm: boolean) =>
    send({ headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim(), confirm }) });

  async function submitName(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const body = await byName(false);
    if (body) setStep(body.status === "returning" ? "returning" : "selfie");
  }

  async function confirmReturning() {
    const body = await byName(true);
    if (body?.status === "signed-in") await onSignedIn();
    else if (body) setStep("selfie");
  }

  async function submitSelfie(e: React.FormEvent) {
    e.preventDefault();
    if (!selfie) return;
    const form = new FormData();
    form.append("name", name.trim());
    form.append("selfie", selfie, "selfie.jpg");
    if (!(await send({ body: form }))) return;
    onEnrolled();
    setStep("phone");
    await onSignedIn();
  }

  const title = (
    <h2 className="display text-[clamp(2.5rem,12vw,4rem)]">
      {step === "returning" ? "Welcome back to" : "Sign in to"}
      <br />
      <span className="hl max-w-full bg-green break-words">{dumpster.name}</span>
    </h2>
  );
  const errorBox = error && <p className="border-3 border-fire bg-fire/15 p-3 text-sm" role="alert">{error}</p>;
  const stepLabel = (n: number, label: string) => <p className="label">Step {n} of 3 · {label}</p>;

  if (step === "returning")
    return (
      <div className="space-y-5 px-4 pt-6 pb-10">
        {title}
        <p className="text-lg">
          Someone already signed in here as <b>{name.trim()}</b>. Is that you?
        </p>
        {errorBox}
        <button className="btn btn-green w-full !py-5 !text-xl" disabled={busy} onClick={() => void confirmReturning()}>
          {busy ? "Getting you in…" : "That’s me →"}
        </button>
        <button className="btn btn-ghost w-full" disabled={busy} onClick={() => { setError(null); setStep("name"); }}>
          Not me. Use another name
        </button>
      </div>
    );

  if (step === "selfie")
    return (
      <form onSubmit={submitSelfie} className="space-y-5 px-4 pt-6 pb-10">
        {title}
        {stepLabel(2, "Quick selfie")}
        <p className="text-sm leading-snug">
          Hi <b>{name.trim()}</b>. The selfie finds your face in the pile and puts your name on it. It isn’t kept. You only
          need it this once; next time your name gets you in.
        </p>
        <SelfiePicker value={selfie} onChange={setSelfie} />
        {errorBox}
        <button className="btn btn-green w-full !py-5 !text-xl" disabled={busy || !selfie}>
          {busy ? "Finding your face…" : "Next →"}
        </button>
        <button type="button" className="label underline" disabled={busy} onClick={() => { setError(null); setStep("name"); }}>
          Back
        </button>
      </form>
    );

  if (step === "phone") {
    const connected = me?.notifications?.state === "connected";
    return (
      <div className="pt-6 pb-10">
        <div className="space-y-3 px-4 pb-4">
          {title}
          {stepLabel(3, "Texts (optional)")}
          <p className="text-sm leading-snug">Add your number and we’ll text you when you show up in new photos or videos. Skip it if you’d rather not.</p>
        </div>
        <NotificationSettings dumpsterId={dumpster.id} initial={me?.notifications} onConnected={onSignedIn} />
        <div className="px-4 pt-5">
          <button className={`btn w-full !py-5 !text-xl ${connected ? "btn-green" : "btn-ghost"}`} onClick={onDone}>
            {connected ? "Done →" : "Skip for now →"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submitName} className="space-y-5 px-4 pt-6 pb-10">
      {title}
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
      <p className="text-sm leading-snug">Signed in here before, on any phone? Your name is all you need.</p>
      {errorBox}
      <button className="btn btn-green w-full !py-5 !text-xl" disabled={busy || !name.trim()}>
        {busy ? "Checking…" : "Next →"}
      </button>
    </form>
  );
}
