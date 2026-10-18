"use client";

import { useEffect, useState } from "react";
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

/** A photo or sticker sized for a tile. The viewer still opens the full file. */
export function ShotImage({
  url,
  alt = "",
  edge = 320,
  eager = false,
  className,
  style,
}: {
  url: string;
  alt?: string;
  edge?: PreviewEdge;
  eager?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const preview = previewUrl(url, edge);
  const [src, setSrc] = useState(preview);
  useEffect(() => setSrc(preview), [preview]);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      decoding="async"
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      draggable={false}
      className={className}
      style={style}
      onError={() => setSrc((cur) => (cur === url ? cur : url))}
    />
  );
}

/** Square crop of a face from a (redaction-safe) public image, without generating new files. */
export function FaceThumb({ cover, size }: { cover: NonNullable<PublicCluster["cover"]>; size: number }) {
  const [x1, y1, x2, y2] = cover.box;
  const { w: W, h: H } = cover;
  const side = Math.max((x2 - x1) * W, (y2 - y1) * H) * 1.4;
  const k = size / side;
  const cx = ((x1 + x2) / 2) * W;
  const cy = ((y1 + y2) / 2) * H;
  return (
    <div className="relative overflow-hidden bg-bone" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={previewUrl(cover.url, 960)}
        alt=""
        decoding="async"
        draggable={false}
        onError={(e) => {
          if (e.currentTarget.src.endsWith(cover.url)) return;
          e.currentTarget.src = cover.url;
        }}
        style={{ position: "absolute", maxWidth: "none", width: W * k, height: H * k, left: size / 2 - cx * k, top: size / 2 - cy * k }}
      />
    </div>
  );
}

export function frameNo(n: number) {
  return `#${String(n).padStart(3, "0")}`;
}
