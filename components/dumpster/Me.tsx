"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DumpsterState, PublicDumpster } from "@/lib/types";
import type { Tab } from "./DumpsterView";

/**
 * Me: texts are opt-in. Nothing is asked for until you turn texts on; then we need a
 * phone number to text and a selfie to know which face is yours. Naming people
 * happens on the faces in the Dump tab, not here.
 */
export function Me(props: {
  dumpster: PublicDumpster;
  me?: DumpsterState["me"];
  photosOfMe: number;
  onEnrolled: () => Promise<void>;
  onShowMine: () => void;
  goTo: (t: Tab) => void;
}) {
  const [texts, setTexts] = useState(false);
  const [phone, setPhone] = useState("");
  const [selfie, setSelfie] = useState<Blob | null>(null);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const selfieUrl = useMemo(() => (selfie ? URL.createObjectURL(selfie) : ""), [selfie]);
  useEffect(() => () => (selfieUrl ? URL.revokeObjectURL(selfieUrl) : undefined), [selfieUrl]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selfie) return;
    setBusy(true);
    setMsg(null);
    const form = new FormData();
    form.append("phone", phone);
    form.append("consent", "yes");
    form.append("selfie", selfie, "selfie.jpg");
    const r = await fetch(`/api/dumpsters/${props.dumpster.id}/guests`, { method: "POST", body: form }).catch(() => null);
    const body = await r?.json().catch(() => ({}));
    setBusy(false);
    if (!r?.ok) return setMsg({ tone: "err", text: body?.error ?? "Couldn’t reach Dump. Check your signal and try again." });
    setMsg({ tone: "ok", text: body.clustersClaimed ? "Found you. Texts are on." : "Texts are on. We’ll text you when you show up." });
    setSelfie(null);
    setTexts(false);
    await props.onEnrolled();
  }

  async function stop() {
    setBusy(true);
    await fetch(`/api/dumpsters/${props.dumpster.id}/guests`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    setMsg({ tone: "ok", text: "Texts are off." });
    await props.onEnrolled();
  }

  return (
    <section>
      <div className="border-b-3 border-ink px-4 pt-5 pb-5">
        <h2 className="display text-[clamp(2.5rem,12vw,4rem)]">
          Find
          <br />
          yourself.
        </h2>
        <p className="mt-2 text-sm leading-snug">Tap any face in the Dump to see every shot they’re in.</p>
        <button className="btn btn-ghost mt-4 !py-2.5 !text-sm" onClick={() => props.goTo("dump")}>
          Go to faces →
        </button>
      </div>

      {props.me ? (
        <div className="space-y-4 px-4 py-5">
          <p className="label">Texts on{props.me.phoneLast4 ? ` · ••• ${props.me.phoneLast4}` : ""}</p>
          <p>
            <b className="display text-3xl">{props.photosOfMe}</b> photos & videos of you so far.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button className="btn btn-green" onClick={props.onShowMine} disabled={!props.me.clusterIds.length}>
              Show mine
            </button>
            <button className="btn btn-ghost" onClick={stop} disabled={busy}>
              Stop texts
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 px-4 py-5">
          <label className="flex cursor-pointer items-center gap-3 border-3 border-ink p-3">
            <input type="checkbox" checked={texts} onChange={(e) => setTexts(e.target.checked)} className="size-5 shrink-0 accent-[#46a65a]" />
            <span className="font-bold uppercase">Text me when I show up</span>
          </label>

          {texts && (
            <>
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
                <span className="label mb-1 block">Phone</span>
                <input
                  className="field"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                  required
                />
              </label>

              <button className="btn btn-green w-full !py-5 !text-xl" disabled={busy || !selfie || !phone.trim()}>
                {busy ? "Scanning…" : "Start texts"}
              </button>
            </>
          )}
        </form>
      )}

      {msg && (
        <p className={`mx-4 mb-5 border-3 p-3 text-sm ${msg.tone === "ok" ? "border-green bg-green/20" : "border-fire bg-fire/15"}`}>{msg.text}</p>
      )}
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
