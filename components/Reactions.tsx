"use client";

import { FireIcon } from "@/components/Brand";
import { REACTIONS, type ReactionKey } from "@/lib/reactions";
import type { PublicMedia } from "@/lib/types";

/**
 * Reaction row. The flaming dumpster is the big one (it ranks); the emoji are smaller
 * and purely expressive. `tone` matches the surface it sits on.
 */
export function ReactionBar({
  m,
  onReact,
  tone = "light",
}: {
  m: PublicMedia;
  onReact: (key: ReactionKey) => void;
  tone?: "light" | "dark";
}) {
  const fireOn = m.myReactions.includes("fire");
  const base = tone === "dark" ? "border-paper text-paper" : "border-ink text-ink";
  return (
    <div className="flex items-stretch gap-1.5">
      <button
        onClick={() => onReact("fire")}
        aria-pressed={fireOn}
        aria-label={`Dumpster fire, ${m.reactions.fire}`}
        className={`flex h-12 shrink-0 items-center gap-1.5 border-3 px-2.5 transition-transform active:translate-y-[2px] ${
          fireOn ? "border-fire bg-fire text-ink" : base
        }`}
      >
        <FireIcon size={30} />
        <span className="display text-lg tabular-nums">{m.reactions.fire}</span>
      </button>
      <div className="no-scrollbar scroll-x flex min-w-0 flex-1 gap-1.5">
        {REACTIONS.filter((r) => r.key !== "fire").map((r) => {
          const on = m.myReactions.includes(r.key);
          const n = m.reactions[r.key];
          return (
            <button
              key={r.key}
              onClick={() => onReact(r.key)}
              aria-pressed={on}
              aria-label={`${r.label}, ${n}`}
              className={`flex h-12 min-w-11 shrink-0 items-center justify-center gap-1 border-2 px-1.5 active:translate-y-[2px] ${
                on ? (tone === "dark" ? "border-paper bg-paper text-ink" : "border-ink bg-ink text-paper") : base
              }`}
            >
              <span className="text-lg leading-none">{"emoji" in r ? r.emoji : ""}</span>
              {n > 0 && <span className="label !tracking-normal tabular-nums">{n}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
