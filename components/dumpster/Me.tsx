"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicDumpster, DumpsterState } from "@/lib/types";

export function Me(props: {
  dumpster: PublicDumpster;
  me?: DumpsterState["me"];
  photosOfMe: number;
  onEnrolled: () => Promise<void>;
  onShowMine: () => void;
}) {
  const [editing, setEditing] = useState(!props.me);
  const [name, setName] = useState(props.me?.name ?? "");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [selfie, setSelfie] = useState<Blob | null>(null);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const selfieUrl = useMemo(() => (selfie ? URL.createObjectURL(selfie) : ""), [selfie]);
  useEffect(() => () => (selfieUrl ? URL.revokeObjectURL(selfieUrl) : undefined), [selfieUrl]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const form = new FormData();
    form.append("name", name);
    form.append("phone", phone);
    form.append("consent", consent ? "yes" : "no");
    if (selfie) form.append("selfie", selfie, "selfie.jpg");
    const r = await fetch(`/api/dumpsters/${props.dumpster.id}/guests`, { method: "POST", body: form }).catch(() => null);
    const body = await r?.json().catch(() => ({}));
    setBusy(false);
    if (!r?.ok) return setMsg({ tone: "err", text: body?.error ?? "Couldn’t reach Dump. Check your signal and try again." });
    setMsg({
      tone: "ok",
      text: body.faceMatched
        ? body.clustersClaimed
          ? `Found you. Your shots are tagged with your name now.`
          : `Got it. You’ll show up as photos land.`
        : `You’re in. Add a selfie any time to find your photos.`,
    });
    setSelfie(null);
    setEditing(false);
    await props.onEnrolled();
  }

  return (
    <section>
      {props.me && !editing ? (
        <div className="border-b-3 border-ink px-4 pt-5 pb-6">
          <p className="label">You’re in as</p>
          <h2 className="display text-[clamp(3rem,15vw,5rem)] break-words">{props.me.name}.</h2>
          <p className="mt-3">
            <b className="display text-3xl">{props.photosOfMe}</b> photos & videos of you so far.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button className="btn btn-green" onClick={props.onShowMine} disabled={!props.me.clusterIds.length}>
              Show mine
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(true)}>
              Update
            </button>
          </div>
          {!props.me.clusterIds.length && <p className="label mt-3 text-smoke">Add a selfie to find photos of you.</p>}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 p-4">
          <div>
            <h2 className="display text-[clamp(2.5rem,12vw,4rem)]">
              Find
              <br />
              yourself.
            </h2>
            <p className="mt-2 text-sm leading-snug">Take a quick selfie to pull up every shot you’re in. Leave a number and we’ll text you when new ones land.</p>
          </div>

          <div className="border-3 border-ink">
            {camera ? (
              <Camera
                onShot={(b) => {
                  setSelfie(b);
                  setCamera(false);
                }}
                onCancel={() => setCamera(false)}
              />
            ) : selfie ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={selfieUrl} alt="Your selfie" className="block aspect-square w-full object-cover" />
                <button type="button" className="btn absolute right-2 bottom-2 !py-2" onClick={() => setCamera(true)}>
                  Retake
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setCamera(true)} className="grid aspect-[4/3] w-full place-items-center bg-bone">
                <span className="text-center">
                  <span className="display block text-4xl">Selfie</span>
                  <span className="label">Tap to open camera</span>
                </span>
              </button>
            )}
          </div>

          <label className="block">
            <span className="label mb-1 block">Name (how friends say it in videos)</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoComplete="given-name" />
          </label>
          <label className="block">
            <span className="label mb-1 block">Phone (optional) — for “new photos of you” texts</span>
            <input className="field" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          </label>

          <label className="flex cursor-pointer items-start gap-3 border-3 border-ink p-3">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-5 accent-[#46a65a]" />
            <span className="text-sm leading-snug">
              Tag me in this Dumpster’s photos and text me when I show up. My selfie isn’t kept, and my name and number{" "}
              <b>burn with this Dumpster</b>.
            </span>
          </label>

          {msg && <p className={`border-3 p-3 text-sm ${msg.tone === "ok" ? "border-green bg-green/20" : "border-fire bg-fire/15"}`}>{msg.text}</p>}

          <button className="btn btn-green w-full !py-5 !text-xl" disabled={busy || !consent || !name.trim()}>
            {busy ? "Scanning…" : "Let me in"}
          </button>
        </form>
      )}
      {msg?.tone === "ok" && !editing && <p className="border-b-3 border-ink bg-green/20 p-3 text-sm">{msg.text}</p>}
    </section>
  );
}

function Camera({ onShot, onCancel }: { onShot: (b: Blob) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        stream.current = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setError("Camera blocked. Allow it in your browser settings."));
    return () => stream.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const snap = () => {
    const v = video.current;
    if (!v?.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => b && onShot(b), "image/jpeg", 0.9);
  };

  if (error)
    return (
      <div className="p-4">
        <p className="mb-3">{error}</p>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Back
        </button>
      </div>
    );

  return (
    <div className="relative bg-ink">
      <video ref={video} autoPlay playsInline muted className="block aspect-square w-full -scale-x-100 object-cover" />
      <div className="pointer-events-none absolute inset-[18%] border-3 border-dashed border-green" />
      <div className="absolute inset-x-0 bottom-0 grid grid-cols-[1fr_2fr] gap-2 p-2">
        <button type="button" className="btn btn-ghost !text-paper" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-green" onClick={snap}>
          Snap
        </button>
      </div>
    </div>
  );
}
