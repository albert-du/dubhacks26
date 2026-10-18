"use client";

import { useState } from "react";
import { FaceThumb } from "@/components/ui";
import type { DumpsterState, PublicCluster, PublicDumpster } from "@/lib/types";
import { NotificationSettings } from "./NotificationSettings";
import { SelfiePicker } from "./Selfie";

type Step = "name" | "returning" | "named" | "selfie" | "sameFace" | "claim" | "phone";
type Match = { guest?: { name: string }; faceIds: string[] };

/**
 * The door to a dumpster. Your name first. Been here before? That's all it takes.
 * New here: a quick selfie, then an optional number for texts when you show up in new shots.
 * If the selfie looks like someone already signed in, we ask whether that's you. If your face
 * is already in the pile, you pick the faces that are you and those shots become yours.
 * No account; it's just for this one.
 */
export function SignIn({ dumpster, me, clusters, onSignedIn, onEnrolled, onDone }: {
  dumpster: PublicDumpster;
  me?: DumpsterState["me"];
  clusters: PublicCluster[];
  onSignedIn: () => Promise<void>;
  /** The guest exists now; keep this screen up for the phone step. */
  onEnrolled: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<Step>(me ? "phone" : "name");
  const [name, setName] = useState(me?.name ?? "");
  const [selfie, setSelfie] = useState<Blob | null>(null);
  const [match, setMatch] = useState<Match>({ faceIds: [] });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** Who already goes by the typed name: their spelling and their faces in the pile. */
  const [holder, setHolder] = useState<{ name: string; faceIds: string[] } | null>(null);
  /** Faces already called this name that they said are them; claimed when they sign in. */
  const [namedFaces, setNamedFaces] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/dumpsters/${dumpster.id}/guests`;

  async function send({ url = base, ...init }: RequestInit & { url?: string }) {
    setBusy(true);
    setError(null);
    const r = await fetch(url, { method: "POST", ...init }).catch(() => null);
    const body = await r?.json().catch(() => ({}));
    setBusy(false);
    if (!r?.ok) {
      setError(body?.error ?? "Couldn’t reach Dump. Check your signal and try again.");
      return null;
    }
    return body;
  }

  const byName = (confirm: boolean, as = name.trim()) =>
    send({ headers: { "content-type": "application/json" }, body: JSON.stringify({ name: as, confirm }) });

  async function submitName(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const body = await byName(false);
    if (!body) return;
    setNamedFaces([]);
    setHolder(body.name ? { name: body.name, faceIds: body.faceIds ?? [] } : null);
    setStep(body.status === "returning" ? "returning" : body.status === "named" ? "named" : "selfie");
  }

  /** Not them: two people can't share a name, so back to the name with a hint. */
  const notMe = () => {
    setError(`Someone here is already ${holder?.name ?? name.trim()}. Add a last initial or a nickname.`);
    setStep("name");
  };

  async function confirmReturning() {
    const body = await byName(true);
    if (body?.status === "signed-in") await onSignedIn();
    else if (body) setStep("selfie");
  }

  /** Check the selfie against the pile first: same face as someone signed in? Your shots already here? */
  async function submitSelfie(e: React.FormEvent) {
    e.preventDefault();
    if (!selfie) return;
    const form = new FormData();
    form.append("selfie", selfie, "selfie.jpg");
    const r = await send({ body: form, url: `${base}/match` });
    if (!r) return;
    const found: Match = {
      guest: r.guest,
      faceIds: (r.faceIds ?? []).filter((id: string) => clusters.some((c) => c.id === id) && !namedFaces.includes(id)),
    };
    setMatch(found);
    setPicked(new Set(found.faceIds));
    if (found.guest) setStep("sameFace");
    else if (found.faceIds.length) setStep("claim");
    else await enroll([]);
  }

  async function signInAs(existing: string) {
    const body = await byName(true, existing);
    if (body?.status === "signed-in") await onSignedIn();
  }

  async function enroll(claim: string[]) {
    if (!selfie) return;
    const form = new FormData();
    form.append("name", name.trim());
    form.append("selfie", selfie, "selfie.jpg");
    form.append("claim", JSON.stringify([...new Set([...claim, ...namedFaces])]));
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

  // Their face from the pile, so "is this you?" can be answered by looking.
  const faces = (holder?.faceIds ?? [])
    .map((id) => clusters.find((c) => c.id === id))
    .filter((c): c is PublicCluster => !!c?.cover)
    .slice(0, 3);
  const pictures = faces.length > 0 && (
    <div className="flex gap-2">
      {faces.map((c) => (
        <span key={c.id} className="border-3 border-ink">
          <FaceThumb cover={c.cover!} size={96} />
        </span>
      ))}
    </div>
  );

  if (step === "returning" || step === "named")
    return (
      <div className="space-y-5 px-4 pt-6 pb-10">
        {title}
        <p className="text-lg">
          {step === "returning" ? (
            <>
              Someone already signed in here as <b>{holder?.name ?? name.trim()}</b>.
            </>
          ) : (
            <>
              {faces.length > 1 ? "These faces are" : "This face is"} already called <b>{holder?.name ?? name.trim()}</b>.
            </>
          )}{" "}
          {faces.length ? "Is this you?" : "Is that you?"}
        </p>
        {pictures}
        {errorBox}
        <button
          className="btn btn-green w-full !py-5 !text-xl"
          disabled={busy}
          onClick={() => {
            if (step === "returning") return void confirmReturning();
            // Their faces are already here; the selfie step signs them in and claims them.
            setNamedFaces(holder?.faceIds ?? []);
            setError(null);
            setStep("selfie");
          }}
        >
          {busy ? "Getting you in…" : "That’s me →"}
        </button>
        <button className="btn btn-ghost w-full" disabled={busy} onClick={notMe}>
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
          {busy ? "Looking for you…" : "Next →"}
        </button>
        <button type="button" className="label underline" disabled={busy} onClick={() => { setError(null); setStep("name"); }}>
          Back
        </button>
      </form>
    );

  if (step === "sameFace" && match.guest) {
    const other = match.guest.name;
    return (
      <div className="space-y-5 px-4 pt-6 pb-10">
        {title}
        <p className="text-lg">
          You look like <b>{other}</b>, who already signed in here. Is that you?
        </p>
        {errorBox}
        <button className="btn btn-green w-full !py-5 !text-xl" disabled={busy} onClick={() => void signInAs(other)}>
          {busy ? "Getting you in…" : `Yes, I’m ${other} →`}
        </button>
        <button
          className="btn btn-ghost w-full"
          disabled={busy}
          onClick={() => (match.faceIds.length ? setStep("claim") : void enroll([]))}
        >
          No, I’m {name.trim()}
        </button>
      </div>
    );
  }

  if (step === "claim") {
    const faces = match.faceIds.map((id) => clusters.find((c) => c.id === id)).filter((c): c is PublicCluster => !!c);
    const shots = faces.filter((c) => picked.has(c.id)).reduce((n, c) => n + c.count, 0);
    return (
      <div className="space-y-5 px-4 pt-6 pb-10">
        {title}
        {stepLabel(2, "Your shots")}
        <p className="text-sm leading-snug">
          These faces are already in the pile and look like you. Tap any that aren’t you. The rest take your name, and new
          shots of them go to you.
        </p>
        <ul className="grid grid-cols-3 gap-2">
          {faces.map((c) => {
            const on = picked.has(c.id);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setPicked((p) => {
                      const next = new Set(p);
                      if (on) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    })
                  }
                  className={`relative block w-full border-3 ${on ? "border-green" : "border-ink opacity-50"}`}
                >
                  {c.cover ? <FaceThumb cover={c.cover} size={104} /> : <span className="block aspect-square bg-bone" />}
                  <span className={`display absolute top-1 left-1 grid size-6 place-items-center border-2 border-ink text-sm ${on ? "bg-green" : "bg-paper"}`}>
                    {on ? "✓" : ""}
                  </span>
                  <span className="label block bg-paper py-0.5 text-center !text-[9px]">
                    {c.count} shot{c.count === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {errorBox}
        <button className="btn btn-green w-full !py-5 !text-xl" disabled={busy || !picked.size} onClick={() => void enroll([...picked])}>
          {busy ? "Claiming…" : `That’s me · ${shots} shot${shots === 1 ? "" : "s"} →`}
        </button>
        <button className="btn btn-ghost w-full" disabled={busy} onClick={() => void enroll([])}>
          None of these are me
        </button>
      </div>
    );
  }

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
