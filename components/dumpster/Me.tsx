"use client";

import { useState } from "react";
import type { DumpsterState, PublicDumpster } from "@/lib/types";
import type { Tab } from "./DumpsterView";
import { NotificationSettings } from "./NotificationSettings";
import { SelfiePicker } from "./Selfie";

/** Me: who you signed in as, your shots, optional texts, and signing out. */
export function Me(props: {
  dumpster: PublicDumpster;
  me: NonNullable<DumpsterState["me"]>;
  photosOfMe: number;
  onChanged: () => Promise<void>;
  onShowMine: () => void;
  goTo: (t: Tab) => void;
}) {
  const { me } = props;
  const [editing, setEditing] = useState<"name" | "selfie" | null>(null);
  const [name, setName] = useState(me.name);
  const [selfie, setSelfie] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const base = `/api/dumpsters/${props.dumpster.id}/guests`;

  async function call(init: RequestInit, ok: string, url = base) {
    setBusy(true);
    setMsg(null);
    const r = await fetch(url, init).catch(() => null);
    const body = await r?.json().catch(() => ({}));
    setBusy(false);
    if (!r?.ok) return setMsg({ tone: "err", text: body?.error ?? "Couldn’t reach Dump. Check your signal and try again." });
    setEditing(null);
    setSelfie(null);
    setMsg({ tone: "ok", text: ok });
    await props.onChanged();
  }

  const saveName = () =>
    call({ method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim() }) }, "Name updated.");
  const saveSelfie = () => {
    if (!selfie) return;
    const form = new FormData();
    form.append("name", me.name);
    form.append("selfie", selfie, "selfie.jpg");
    return call({ method: "POST", body: form }, "Selfie updated.");
  };
  const signOut = () => {
    if (confirm(`Sign out on this phone? Sign back in any time with just “${me.name}”.`)) void call({ method: "DELETE" }, "Signed out.");
  };
  const forget = () => {
    if (confirm("Forget you in this dumpster? Your name, face match and texts are deleted on every phone."))
      void call({ method: "DELETE" }, "Forgotten.", `${base}?forget=1`);
  };

  return (
    <section>
      <div className="border-b-3 border-ink px-4 pt-5 pb-5">
        <p className="label">Signed in as</p>
        {editing === "name" ? (
          <form
            className="mt-1 flex border-3 border-ink"
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
          >
            <input className="display min-w-0 flex-1 bg-transparent px-3 py-2 text-2xl outline-none" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
            <button className="display border-l-3 border-ink bg-green px-3 text-sm" disabled={busy || !name.trim()}>
              Save
            </button>
          </form>
        ) : (
          <h2 className="display text-[clamp(2.5rem,12vw,4rem)] break-words">{me.name}</h2>
        )}
        <p className="mt-3">
          <b className="display text-3xl">{props.photosOfMe}</b> photos & videos of you so far.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button className="btn btn-green" onClick={props.onShowMine} disabled={!me.clusterIds.length}>
            Show mine
          </button>
          <button className="btn btn-ghost" onClick={() => props.goTo("dump")}>
            All faces
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          <button className="label underline" onClick={() => setEditing(editing === "name" ? null : "name")}>
            {editing === "name" ? "Cancel" : "Change name"}
          </button>
          <button className="label underline" onClick={() => setEditing(editing === "selfie" ? null : "selfie")}>
            {editing === "selfie" ? "Cancel" : "New selfie"}
          </button>
          <button className="label ml-auto underline" onClick={signOut} disabled={busy}>
            Sign out
          </button>
          <button className="label underline" onClick={forget} disabled={busy}>
            Forget me
          </button>
        </div>
      </div>

      {editing === "selfie" && (
        <div className="space-y-3 border-b-3 border-ink px-4 py-5">
          <SelfiePicker value={selfie} onChange={setSelfie} />
          <button className="btn btn-green w-full" disabled={busy || !selfie} onClick={() => void saveSelfie()}>
            {busy ? "Matching…" : "Use this selfie"}
          </button>
        </div>
      )}

      <NotificationSettings dumpsterId={props.dumpster.id} initial={me.notifications} onConnected={props.onChanged} />

      {msg && (
        <p className={`mx-4 my-5 border-3 p-3 text-sm ${msg.tone === "ok" ? "border-green bg-green/20" : "border-fire bg-fire/15"}`}>{msg.text}</p>
      )}
    </section>
  );
}
