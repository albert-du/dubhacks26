"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PublicMedia } from "@/lib/types";

/** Space between neighboring photos while they slide. */
const GAP = 16;
/** How long the slide out/in (or the snap back) takes. */
const SLIDE_MS = 240;
const PAD = 8;

type Size = { w: number; h: number };

/** Fit a photo of `natural` size inside the stage, centered. Unknown size fills the padded area. */
function fit(size: Size, natural: Size | null) {
  const W = Math.max(0, size.w - PAD * 2);
  const H = Math.max(0, size.h - PAD * 2);
  if (!natural || !W || !H) return { w: W, h: H, left: PAD, top: PAD };
  const k = Math.min(W / natural.w, H / natural.h);
  const w = natural.w * k;
  const h = natural.h * k;
  return { w, h, left: (size.w - w) / 2, top: (size.h - h) / 2 };
}

/**
 * Full-bleed media area for the viewers. Any orientation or size is fitted inside the
 * available space (never overflowing), and the photo box it computes is where overlays go.
 *
 * Swiping: the previous, current and next shots sit side by side on one track that follows
 * the finger (`touch-action: pan-y` leaves vertical drags to the browser). Let go past a
 * third of the width, or flick, and the track finishes sliding: one shot goes out as the
 * other comes in, and only then does the index change. Short drags slide back. At either
 * end the track gives a little and springs back. Neighbors are preloaded.
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
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  /** Size measured from the loaded file, for shots the server didn't know the size of. */
  const [measured, setMeasured] = useState<(Size & { id: string }) | null>(null);
  /** Track offset in px, and whether it is gliding (vs. following the finger). */
  const [x, setX] = useState(0);
  const [gliding, setGliding] = useState(false);
  const touch = useRef<{ x: number; y: number; t: number; axis: "x" | "y" | null; dx: number } | null>(null);
  const sliding = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new shot (from a finished slide, a key or a button) starts centered and still.
  useLayoutEffect(() => {
    setGliding(false);
    setX(0);
  }, [m.id]);

  useEffect(() => () => void (sliding.current && clearTimeout(sliding.current)), []);

  useEffect(() => {
    for (const n of [prev, next]) if (n?.kind === "image") new Image().src = n.url;
  }, [prev, next]);

  const step = size.w + GAP;

  /** Glide the track to `to`, then (for a change of shot) hand over to the new index. */
  const glide = (to: number, then?: () => void) => {
    if (sliding.current) clearTimeout(sliding.current);
    setGliding(true);
    setX(to);
    sliding.current = setTimeout(() => {
      sliding.current = null;
      if (then) then();
      else setGliding(false);
    }, SLIDE_MS);
  };
  const goNext = () => !sliding.current && next && glide(-step, onNext);
  const goPrev = () => !sliding.current && prev && glide(step, onPrev);

  const start = (px: number, py: number) => {
    if (sliding.current) return;
    touch.current = { x: px, y: py, t: Date.now(), axis: null, dx: 0 };
  };
  const move = (px: number, py: number) => {
    const t = touch.current;
    if (!t) return;
    const dx = px - t.x;
    const dy = py - t.y;
    if (!t.axis && Math.hypot(dx, dy) > 8) t.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (t.axis !== "x") return;
    t.dx = dx;
    // Nothing on that side: the track gives a little, like a rubber band.
    const edge = (dx > 0 && !prev) || (dx < 0 && !next);
    setGliding(false);
    setX(edge ? dx * 0.25 : dx);
  };
  const end = () => {
    const t = touch.current;
    touch.current = null;
    if (t?.axis !== "x") return;
    const flick = Math.abs(t.dx) > 24 && Math.abs(t.dx) / Math.max(1, Date.now() - t.t) > 0.45;
    const far = Math.abs(t.dx) > size.w / 3;
    if ((far || flick) && t.dx < 0 && next) glide(-step, onNext);
    else if ((far || flick) && t.dx > 0 && prev) glide(step, onPrev);
    else glide(0);
  };

  // Known dimensions come from the server; fall back to the loaded file.
  const known = (n: PublicMedia) => (n.width && n.height ? { w: n.width, h: n.height } : null);
  const box = fit(size, known(m) ?? (measured?.id === m.id ? measured : null));

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
        className="absolute inset-0"
        style={{
          transform: x ? `translate3d(${x}px, 0, 0)` : undefined,
          transition: gliding ? `transform ${SLIDE_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1)` : "none",
          willChange: "transform",
        }}
      >
        {/* Keyed by shot, so the photo that slides in is the same element that stays put. */}
        {prev && <Panel key={prev.id} m={prev} box={fit(size, known(prev))} offset={-step} />}
        <Panel key={m.id} m={m} box={box} offset={0} current onNatural={(n) => setMeasured({ id: m.id, ...n })}>
          {overlay}
        </Panel>
        {next && <Panel key={next.id} m={next} box={fit(size, known(next))} offset={step} />}
      </div>

      {prev && (
        <button
          onClick={goPrev}
          aria-label="Previous"
          className="display z-labels absolute top-1/2 left-1 grid size-10 -translate-y-1/2 place-items-center bg-ink/60 text-xl text-paper"
        >
          ‹
        </button>
      )}
      {next && (
        <button
          onClick={goNext}
          aria-label="Next"
          className="display z-labels absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center bg-ink/60 text-xl text-paper"
        >
          ›
        </button>
      )}
    </div>
  );
}

/**
 * One shot on the track. The current one gets the overlay and, for a clip, the controls;
 * the neighbors wait just off-screen on either side so they slide in with the finger.
 */
function Panel({
  m,
  box,
  offset,
  current,
  onNatural,
  children,
}: {
  m: PublicMedia;
  box: ReturnType<typeof fit>;
  offset: number;
  current?: boolean;
  onNatural?: (n: Size) => void;
  children?: React.ReactNode;
}) {
  // A neighbor that slid in has already loaded, so its onLoad won't fire again: read its size now.
  const img = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const el = img.current;
    if (current && el?.complete && el.naturalWidth) onNatural?.({ w: el.naturalWidth, h: el.naturalHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  return (
    <div className="absolute" style={{ left: box.left + offset, top: box.top, width: box.w, height: box.h }} aria-hidden={!current}>
      {m.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={img}
          src={m.url}
          alt=""
          draggable={false}
          onLoad={(e) => onNatural?.({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className="z-media relative block size-full object-contain"
        />
      ) : current ? (
        <video
          key="playing"
          src={m.url}
          controls
          playsInline
          autoPlay
          onLoadedMetadata={(e) => onNatural?.({ w: e.currentTarget.videoWidth || 16, h: e.currentTarget.videoHeight || 9 })}
          className="z-media relative block size-full object-contain"
        />
      ) : (
        <video key="waiting" src={`${m.url}#t=0.1`} muted playsInline preload="metadata" className="z-media relative block size-full object-contain" />
      )}
      {children}
    </div>
  );
}

/** Adds ?download=1 so the file is saved instead of opened. */
export const downloadUrl = (url: string) => `${url}${url.includes("?") ? "&" : "?"}download=1`;
