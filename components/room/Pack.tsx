"use client";

import type { PublicSticker } from "@/lib/types";
import type { Tab } from "./Room";

const tilt = (id: string) => ((id.split("").reduce((s, c) => s + c.charCodeAt(0), 0) % 9) - 4) * 1.1;

export function Pack({ stickers, goTo }: { stickers: PublicSticker[]; goTo: (t: Tab) => void }) {
  const live = stickers.filter((s) => s.status !== "failed");
  return (
    <section>
      <div className="border-b-3 border-ink px-4 pt-5 pb-4">
        <h2 className="display text-[clamp(2.5rem,12vw,4rem)]">
          Sticker
          <br />
          pack
        </h2>
        <p className="mt-3 text-sm leading-snug">
          Open any photo → <b>Sticker</b>. The AI finds the object and cuts it out. Long-press to save. Burns with everything else.
        </p>
      </div>

      {live.length === 0 ? (
        <div className="px-4 py-10">
          <p className="display text-3xl">Pack’s empty.</p>
          <button className="btn mt-4" onClick={() => goTo("pool")}>
            Pick a photo →
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-8 bg-bone p-6">
          {live.map((s) => (
            <li key={s.id} className="flex flex-col items-center" style={{ transform: `rotate(${tilt(s.id)}deg)` }}>
              {s.status === "ready" && s.url ? (
                <a href={s.url} download={`dump-${s.label}.webp`} className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.url} alt={s.label} className="block w-full" />
                </a>
              ) : (
                <div className="grid aspect-square w-full place-items-center border-3 border-dashed border-ink">
                  <span className="label animate-blink">Cutting…</span>
                </div>
              )}
              <span className="label mt-2 bg-ink px-1.5 text-paper">{s.label}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
