"use client";

import { useEffect, useState } from "react";

const CREATE_MESSAGE = 'create dumpster "My Dumpster" 24h';

export function StartByMessage() {
  const [phone, setPhone] = useState("");
  const [agentNumber, setAgentNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setIos(/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  }, []);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/photon/assignment", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Couldn’t look up your number. Try again.");
      setAgentNumber(body.agentNumber);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {agentNumber ? (
        <>
          <p className="text-sm">From the number you entered, send this to <b>{agentNumber}</b>. Edit the name and hours in Messages—pick 24, 48, or 72 hours. We’ll text back your Dumpster link.</p>
          <code className="block break-words border-3 border-ink bg-bone p-3 text-sm">{CREATE_MESSAGE}</code>
          <a className="btn btn-green w-full !py-5" href={`sms:${agentNumber}${ios ? "&" : "?"}body=${encodeURIComponent(CREATE_MESSAGE)}`}>Open Messages</a>
          <button className="label underline" onClick={() => { setAgentNumber(""); setError(""); }}>Use a different number</button>
        </>
      ) : (
        <form onSubmit={lookup} className="space-y-3">
          <p className="text-sm">Start by iMessage. Enter your registered demo number to find where to send your first text.</p>
          <label className="block">
            <span className="label mb-1 block">Your iMessage phone number</span>
            <input className="field" type="tel" inputMode="tel" autoComplete="tel" placeholder="+1 206 555 0123" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </label>
          <button className="btn btn-green w-full !py-5" disabled={busy || !phone.trim()}>{busy ? "Finding your number…" : "Start by iMessage"}</button>
          <p className="text-xs leading-snug">Already have a Dumpster link or QR code? Open it to join—no phone number needed.</p>
        </form>
      )}
      {error && <p className="border-3 border-fire bg-fire/15 p-3 text-sm" role="alert">{error}</p>}
    </div>
  );
}
