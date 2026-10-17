import { config } from "./config";

/**
 * Photon 2.0 messaging agent adapter (SMS / iMessage).
 * VERIFY the send endpoint + payload shape against Photon's docs; this is the only
 * place that needs to change. Without config, messages are logged (dev mode).
 */
export const photon = {
  enabled: () => !!(config.photon.url && config.photon.apiKey),

  async send(to: string, text: string): Promise<void> {
    if (!photon.enabled()) {
      console.log(`[photon:dev] -> ${maskPhone(to)}: ${text}`);
      return;
    }
    const res = await fetch(`${config.photon.url}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.photon.apiKey}` },
      body: JSON.stringify({ to, text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`photon ${res.status}: ${(await res.text()).slice(0, 200)}`);
  },
};

/** Never log full phone numbers. */
export function maskPhone(p: string) {
  return p.length > 4 ? `${"*".repeat(p.length - 4)}${p.slice(-4)}` : "****";
}

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  const d = digits.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}
