"use client";

import { useCallback, useEffect, useState } from "react";
import type { NotificationStatus } from "@/lib/types";

type Status = NotificationStatus & { available?: boolean };
type Challenge = { agentNumber: string; message: string; expiresAt: string };

export function NotificationSettings({ dumpsterId, initial, onConnected }: {
  dumpsterId: string;
  initial?: NotificationStatus;
  onConnected: () => Promise<void>;
}) {
  const endpoint = `/api/dumpsters/${dumpsterId}/notifications`;
  const [status, setStatus] = useState<Status>(initial ?? { state: "disconnected" });
  const [phone, setPhone] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setIos(/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const r = await fetch(endpoint, { cache: "no-store" });
      if (!r.ok) return;
      const next: Status = await r.json();
      setStatus(next);
      if (next.state === "connected") {
        setChallenge(null);
        setChanging(false);
        setPhone("");
        setError("");
        await onConnected();
      } else if (next.state === "disconnected") {
        setChallenge(null);
      }
    } catch {
      // Keep the connection instructions visible during a brief network outage.
    }
  }, [endpoint, onConnected]);

  useEffect(() => { void checkStatus(); }, [checkStatus]);
  useEffect(() => {
    if (status.state !== "pending") return;
    const timer = setInterval(() => { void checkStatus(); }, 3000);
    const onFocus = () => { void checkStatus(); };
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [status.state, checkStatus]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Couldn’t prepare the connection message. Try again.");
      setChallenge(body);
      setStatus({ state: "pending", expiresAt: body.expiresAt, available: true });
      setChanging(false);
      await onConnected();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(endpoint, { method: "DELETE" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Couldn’t disconnect alerts. Try again.");
      setStatus({ state: "disconnected", available: status.available });
      setChallenge(null);
      setChanging(false);
      setPhone("");
      await onConnected();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const messageUrl = challenge ? `sms:${challenge.agentNumber}${ios ? "&" : "?"}body=${encodeURIComponent(challenge.message)}` : "";
  return (
    <div className="space-y-4 border-b-3 border-ink p-4">
      <h3 className="display text-2xl">iMessage alerts</h3>
      <p className="text-sm leading-snug">Optional texts when photos of you land, a video mentions you, or this Dumpster is about to burn. Available to registered demo participants.</p>
      {status.state === "connected" && !changing ? (
        <>
          <p className="border-3 border-green bg-green/20 p-3 text-sm" role="status">Alerts connected. This connection burns with the Dumpster.</p>
          <div className="grid grid-cols-2 gap-3">
            <button className="btn btn-ghost" disabled={busy} onClick={() => setChanging(true)}>Change number</button>
            <button className="btn btn-ghost" disabled={busy} onClick={disconnect}>{busy ? "Disconnecting…" : "Disconnect"}</button>
          </div>
        </>
      ) : status.available === false ? (
        <p className="text-sm">iMessage alerts aren’t available right now. Everything else on the website still works.</p>
      ) : (
        <>
          {status.state === "pending" && !changing && (
            <div className="space-y-3 border-3 border-ink bg-bone p-3">
              <p className="label" role="status">Waiting for your message</p>
              {challenge ? (
                <>
                  <p className="text-sm">Send from the exact number you entered to <b>{challenge.agentNumber}</b>. This message expires in ten minutes, or when the Dumpster burns.</p>
                  <code className="block break-all border-2 border-ink bg-paper p-2 text-sm">{challenge.message}</code>
                  <a className="btn btn-green w-full" href={messageUrl}>Open Messages</a>
                  <button className="btn btn-ghost w-full" onClick={async () => {
                    try { await navigator.clipboard.writeText(challenge.message); setCopied(true); }
                    catch { setError("Copy the connection message above and send it in Messages."); }
                  }}>{copied ? "Copied" : "Copy connection message"}</button>
                  <button className="label underline" onClick={() => { void checkStatus(); }}>I’ve sent it — check connection</button>
                </>
              ) : <p className="text-sm">If you haven’t sent the connection message, enter your number below to request a new one.</p>}
              <button className="label block underline" disabled={busy} onClick={disconnect}>Cancel connection</button>
            </div>
          )}
          {(!challenge || changing) && (
            <form className="space-y-3" onSubmit={connect}>
              <label className="block">
                <span className="label mb-1 block">Your iMessage phone number</span>
                <input className="field" type="tel" inputMode="tel" autoComplete="tel" placeholder="+1 206 555 0123" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} required />
              </label>
              <p className="text-sm">By connecting, you agree to these alerts for this Dumpster. We’ll show your assigned number; you must send the connection message yourself. You can disconnect here any time.</p>
              <button className="btn btn-green w-full" disabled={busy || !phone.trim()}>{busy ? "Checking registration…" : "Connect iMessage alerts"}</button>
              {changing && <button type="button" className="label underline" onClick={() => setChanging(false)}>Keep current connection</button>}
            </form>
          )}
        </>
      )}
      {error && <p className="border-3 border-fire bg-fire/15 p-3 text-sm" role="alert">{error}</p>}
    </div>
  );
}
