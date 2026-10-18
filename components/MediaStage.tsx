"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PublicMedia } from "@/lib/types";

/**
 * Full-bleed media area for the viewers. Any orientation or size is fitted inside the
 * available space (never overflowing), and the photo box it computes is where overlays go.
 *
 * Swiping: the stage takes horizontal drags itself (`touch-action: pan-y`), follows the
 * finger, and changes photo past a threshold. Vertical drags are left to the browser.
 * Neighbors are preloaded so the next photo appears instantly.
 */
export function MediaStage({
  m,
  prev,
  next,
  onPrev,
  onNext,
  overlay,
}: {
  m: PublicMedia;
  prev?: PublicMedia;
  next?: PublicMedia;
  onPrev: () => void;
  onNext: () => void;
  /** Rendered inside the fitted photo box (percent coordinates line up with the image). */
  overlay?: React.ReactNode;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [drag, setDrag] = useState(0);
  const touch = useRef<{ x: number; y: number; axis: "x" | "y" | null } | null>(null);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Known dimensions come from the server; fall back to the loaded image.
  useEffect(() => {
    setNatural(m.width && m.height ? { w: m.width, h: m.height } : null);
    setDrag(0);
  }, [m.id, m.width, m.height]);

  useEffect(() => {
    for (const n of [prev, next]) if (n?.kind === "image") new Image().src = n.url;
  }, [prev, next]);

  const pad = 8;
  const box = (() => {
    const W = Math.max(0, size.w - pad * 2);
    const H = Math.max(0, size.h - pad * 2);
    if (!natural || !W || !H) return { w: W, h: H, left: pad, top: pad };
    const k = Math.min(W / natural.w, H / natural.h);
    const w = natural.w * k;
    const h = natural.h * k;
    return { w, h, left: (size.w - w) / 2, top: (size.h - h) / 2 };
  })();

  const start = (x: number, y: number) => (touch.current = { x, y, axis: null });
  const move = (x: number, y: number) => {
    const t = touch.current;
    if (!t) return;
    const dx = x - t.x;
    const dy = y - t.y;
    if (!t.axis && Math.hypot(dx, dy) > 8) t.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (t.axis === "x") setDrag(dx);
  };
  const end = () => {
    const t = touch.current;
    touch.current = null;
    if (t?.axis === "x") {
      const threshold = Math.min(90, size.w * 0.18);
      if (drag < -threshold && next) onNext();
      else if (drag > threshold && prev) onPrev();
    }
    setDrag(0);
  };

  return (
    <div
      ref={stage}
      className="relative min-h-0 flex-1 touch-pan-y overflow-hidden select-none"
      onTouchStart={(e) => start(e.touches[0].clientX, e.touches[0].clientY)}
      onTouchMove={(e) => move(e.touches[0].clientX, e.touches[0].clientY)}
      onTouchEnd={end}
      onTouchCancel={end}
    >
      <div
        className="absolute"
        style={{
          left: box.left,
          top: box.top,
          width: box.w,
          height: box.h,
          transform: drag ? `translateX(${drag}px)` : undefined,
          transition: drag ? "none" : "transform 160ms ease-out",
        }}
      >
        {m.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={m.id}
            src={m.url}
            alt={m.caption ?? ""}
            draggable={false}
            onLoad={(e) => !natural && setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="z-media relative block size-full object-contain"
          />
        ) : (
          <video
            key={m.id}
            src={m.url}
            controls
            playsInline
            autoPlay
            onLoadedMetadata={(e) =>
              !natural && setNatural({ w: e.currentTarget.videoWidth || 16, h: e.currentTarget.videoHeight || 9 })
            }
            className="z-media relative block size-full object-contain"
          />
        )}
        {overlay}
      </div>

      {prev && (
        <button
          onClick={onPrev}
          aria-label="Previous"
          className="display z-labels absolute top-1/2 left-1 grid size-10 -translate-y-1/2 place-items-center bg-ink/60 text-xl text-paper"
        >
          ‹
        </button>
      )}
      {next && (
        <button
          onClick={onNext}
          aria-label="Next"
          className="display z-labels absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center bg-ink/60 text-xl text-paper"
        >
          ›
        </button>
      )}
    </div>
  );
}

/** Adds ?download=1 so the file is saved instead of opened. */
export const downloadUrl = (url: string) => `${url}${url.includes("?") ? "&" : "?"}download=1`;
