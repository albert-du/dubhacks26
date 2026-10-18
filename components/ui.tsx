"use client";

import { useEffect, useRef, useState } from "react";
import {
  queueUpgrade,
  REVEAL_TIMEOUT_MS,
  revealImmediately,
  settleReveal,
  watchReveal,
} from "@/lib/client/reveal";
import { previewUrl, type PreviewEdge } from "@/lib/preview";
import type { PublicCluster } from "@/lib/types";

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function formatLeft(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Self-destruct clock. Renders a placeholder until mounted to avoid hydration mismatch. */
export function Countdown({ expiresAt, className = "" }: { expiresAt: string; className?: string }) {
  const now = useNow();
  return <span className={`tabular-nums ${className}`}>{now === null ? "--:--:--" : formatLeft(Date.parse(expiresAt) - now)}</span>;
}

/**
 * A photo or sticker sized for a tile. The viewer still opens the full file.
 * Pass `group` on a list so each row appears together, top to bottom.
 */
export function ShotImage({
  url,
  alt = "",
  edge = 320,
  eager = false,
  className,
  style,
  group,
  order = 0,
  row = 3,
  priority = 0,
  upgrade = false,
  draggable = false,
}: {
  url: string;
  alt?: string;
  edge?: PreviewEdge;
  eager?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Lists that share a group paint one row at a time. */
  group?: string;
  order?: number;
  row?: number;
  priority?: number;
  /** After the preview row is visible, swap in the original file. */
  upgrade?: boolean;
  draggable?: boolean;
}) {
  const preview = previewUrl(url, edge);
  const revealed = useRevealedImage({
    preview,
    fallback: url,
    group,
    order,
    row,
    priority,
    upgrade: upgrade ? url : undefined,
  });
  const first = !group && eager;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={revealed.ref}
      src={revealed.src}
      alt={alt}
      decoding="async"
      loading={revealed.src ? (group ? "eager" : eager ? "eager" : "lazy") : undefined}
      fetchPriority={first || (group && revealImmediately(order, row, priority)) ? "high" : undefined}
      draggable={draggable}
      className={className}
      style={group ? { ...style, opacity: revealed.hidden ? 0 : 1, transition: "opacity 120ms linear" } : style}
      onLoad={revealed.onLoad}
      onError={revealed.onError}
    />
  );
}

export function useRevealedImage({
  preview,
  fallback,
  group,
  order = 0,
  row = 3,
  priority = 0,
  upgrade,
}: {
  preview: string;
  fallback?: string;
  group?: string;
  order?: number;
  row?: number;
  priority?: number;
  upgrade?: string;
}) {
  const grouped = !!group;
  const [src, setSrc] = useState<string | undefined>(() =>
    grouped && !revealImmediately(order, row, priority) ? undefined : preview,
  );
  const [hidden, setHidden] = useState(grouped);
  const ref = useRef<HTMLImageElement>(null);
  const srcRef = useRef(src);
  srcRef.current = src;
  const settleRef = useRef<() => void>(() => {});
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  useEffect(() => {
    if (!group) {
      setSrc(preview);
      setHidden(false);
      return;
    }
    let stopped = false;
    let settled = false;
    let timer: number | undefined;
    let cancelUpgrade: (() => void) | undefined;
    const id = `${order}:${preview}`;
    const finish = () => {
      if (stopped || settled) return;
      settled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      settleReveal(group, id);
    };
    settleRef.current = finish;
    setHidden(true);
    setSrc(revealImmediately(order, row, priority) ? preview : undefined);
    const stop = watchReveal(
      group,
      id,
      order,
      row,
      (phase) => {
        if (stopped) return;
        if (phase.load) {
          setSrc((cur) => (cur === undefined ? preview : cur));
          if (!settled && timer === undefined) timer = window.setTimeout(finish, REVEAL_TIMEOUT_MS);
        }
        if (phase.show) {
          setHidden(false);
          if (upgrade && upgrade !== preview && !cancelUpgrade) {
            cancelUpgrade = queueUpgrade(upgrade, () => {
              if (!stopped) setSrc(upgrade);
            });
          }
        }
      },
      priority,
    );
    const el = ref.current;
    if (el?.complete && el.naturalWidth > 0) finish();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      cancelUpgrade?.();
      stop();
      settleRef.current = () => {};
    };
  }, [group, order, row, priority, preview, upgrade]);

  return {
    ref,
    src,
    hidden,
    onLoad: () => {
      if (group) settleRef.current();
    },
    onError: () => {
      const next = fallbackRef.current;
      if (next && srcRef.current !== next) {
        setSrc(next);
        return;
      }
      if (group) settleRef.current();
    },
  };
}

/** Square crop of a face from a (redaction-safe) public image, without generating new files. */
export function FaceThumb({
  cover,
  size,
  group,
  order = 0,
  row = 4,
  priority = 1,
}: {
  cover: NonNullable<PublicCluster["cover"]>;
  size: number;
  group?: string;
  order?: number;
  row?: number;
  priority?: number;
}) {
  const [x1, y1, x2, y2] = cover.box;
  const { w: W, h: H } = cover;
  const side = Math.max((x2 - x1) * W, (y2 - y1) * H) * 1.4;
  const k = size / side;
  const cx = ((x1 + x2) / 2) * W;
  const cy = ((y1 + y2) / 2) * H;
  const revealed = useRevealedImage({
    preview: previewUrl(cover.url, 960),
    fallback: cover.url,
    group,
    order,
    row,
    priority,
  });
  return (
    <div className="relative overflow-hidden bg-bone" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={revealed.ref}
        src={revealed.src}
        alt=""
        decoding="async"
        draggable={false}
        onLoad={revealed.onLoad}
        onError={revealed.onError}
        style={{
          position: "absolute",
          maxWidth: "none",
          width: W * k,
          height: H * k,
          left: size / 2 - cx * k,
          top: size / 2 - cy * k,
          ...(group ? { opacity: revealed.hidden ? 0 : 1, transition: "opacity 120ms linear" } : null),
        }}
      />
    </div>
  );
}

export function frameNo(n: number) {
  return `#${String(n).padStart(3, "0")}`;
}
