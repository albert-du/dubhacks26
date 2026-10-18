"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { dumpMapStyle } from "@/lib/mapStyle";
import { groupMoments } from "@/lib/moments";
import type { PublicMedia } from "@/lib/types";

/** Thumbnail size at the fitted view and zoomed in, and the smallest it gets zoomed out, in px. */
const PIN_BASE = 56;
const PIN_MIN = 26;

/**
 * Shots at the same rounded spot fan out in a spiral. The spiral opens up as you zoom in
 * (`zoomedIn` levels past the fitted view), so a pile comes apart into separate shots.
 */
function spread(k: number, px: number, zoomedIn = 0): [number, number] {
  if (k === 0) return [0, 0];
  const r = px * 1.1 * Math.sqrt(k) * Math.min(3, Math.pow(1.35, Math.max(0, zoomedIn)));
  const a = k * 2.39996; // golden angle
  return [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))];
}

/**
 * The scene: every shot with a location, as a small thumbnail on an OpenFreeMap drawn in
 * Dump's paper and ink. Zoom in and the thumbnails keep their size while the map grows
 * under them, so they separate and each can be tapped; zoom out and they shrink to fit. The "use two fingers" hint shows once per sign-in. Full screen frees one-finger panning. Tile requests cover the area already
 * shown on the pins. If the phone has no WebGL, the same thumbnails fall back to a grid.
 */
export function EventMap({
  media,
  onOpen,
  guestId,
}: {
  media: PublicMedia[];
  onOpen: (list: PublicMedia[], id: string) => void;
  /** Who is signed in: the two-finger hint is shown once per sign-in. */
  guestId: string;
}) {
  const byId = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const moments = useMemo(
    () =>
      groupMoments(media.map((m) => ({ id: m.id, t: Date.parse(m.takenAt ?? m.createdAt), gps: m.gps, venue: m.venue, tags: m.tags }))),
    [media],
  );

  /** One pin per located shot; `k` is its place among shots at the exact same spot. */
  const pins = useMemo(() => {
    const seen = new Map<string, number>();
    return media.flatMap((m) => {
      if (!m.gps) return [];
      const spot = `${m.gps.lat},${m.gps.lng}`;
      const k = seen.get(spot) ?? 0;
      seen.set(spot, k + 1);
      return [{ m, lng: m.gps.lng, lat: m.gps.lat, k }];
    });
  }, [media]);
  const pinKey = pins.map((p) => `${p.m.id}:${p.m.url}:${p.m.reactions.fire > 0 ? 1 : 0}`).join("|");

  const proj = useMemo(() => {
    if (!pins.length) return null;
    const lat0 = pins.reduce((s, pin) => s + pin.lat, 0) / pins.length;
    const kx = Math.cos((lat0 * Math.PI) / 180);
    const xs = pins.map((pin) => pin.lng * kx);
    const ys = pins.map((pin) => pin.lat);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const span = Math.max(maxX - minX, maxY - minY, 0.0015);
    const ox = (span - (maxX - minX)) / 2;
    const oy = (span - (maxY - minY)) / 2;
    return {
      pts: pins.map((pin, i) => ({ pin, x: 16 + ((xs[i] - minX + ox) / span) * 68, y: 16 + ((maxY - ys[i] + oy) / span) * 68 })),
      meters: Math.round(span * 111_320),
    };
  }, [pins]);

  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const mediaRef = useRef(media);
  mediaRef.current = media;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<{ marker: Marker; k: number }[]>([]);
  const fitZoomRef = useRef<number | null>(null);
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const [engine, setEngine] = useState<"map" | "grid">("map");
  const [ready, setReady] = useState(false);
  const [full, setFull] = useState(false);
  const fullRef = useRef(full);
  fullRef.current = full;
  const showMap = engine === "map" && pins.length > 0;

  /** Open a shot among every located shot, so swiping walks the map's pile. */
  const openShot = (id: string) => {
    const located = mediaRef.current.filter((m) => m.gps);
    if (located.some((m) => m.id === id)) onOpenRef.current(located, id);
  };
  const openShotRef = useRef(openShot);
  openShotRef.current = openShot;

  /** Thumbnails keep their size as you zoom in (piles at one spot open up); zooming out shrinks them so they fit. */
  const rescale = () => {
    const map = mapRef.current;
    const el = containerRef.current;
    if (!map || !el) return;
    const zoomedIn = map.getZoom() - (fitZoomRef.current ?? map.getZoom());
    const px = Math.round(zoomedIn >= 0 ? PIN_BASE : Math.max(PIN_MIN, PIN_BASE * Math.pow(0.8, -zoomedIn)));
    el.style.setProperty("--pin", `${px}px`);
    for (const { marker, k } of markersRef.current) marker.setOffset(spread(k, px, zoomedIn));
  };
  const rescaleRef = useRef(rescale);
  rescaleRef.current = rescale;

  useEffect(() => {
    if (!showMap) return;
    const el = containerRef.current;
    if (!el) return;
    let map: MlMap | undefined;
    let cancelled = false;

    void import("maplibre-gl").then((ml) => {
      if (cancelled || !containerRef.current) return;
      try {
        // MapLibre's default sibling URL is lost when Next bundles its main module.
        // A static URL lets Webpack emit the matching worker as a build asset.
        ml.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
        const first = pinsRef.current[0];
        map = new ml.Map({
          container: containerRef.current,
          style: dumpMapStyle(),
          center: [first?.lng ?? 0, first?.lat ?? 0],
          zoom: 14,
          maxZoom: 20,
          attributionControl: { compact: false },
          cooperativeGestures: !fullRef.current,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          fadeDuration: 0,
        });
      } catch {
        if (!cancelled) setEngine("grid");
        return;
      }
      map.on("error", (event) => {
        const message = event.error instanceof Error ? event.error.message : "";
        if (/webgl|worker.*(?:failed|error)/i.test(message) && !cancelled) setEngine("grid");
      });
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      map.addControl(new ml.ScaleControl({ maxWidth: 72, unit: "metric" }), "bottom-left");
      map.on("zoom", () => rescaleRef.current());
      // The "use two fingers" hint: once per sign-in, then the map stays quiet about it.
      const quiet = () => containerRef.current?.classList.add("dump-map-quiet");
      if (hintSeen(guestId)) quiet();
      else
        map.once("cooperativegestureprevented", () => {
          markHintSeen(guestId);
          setTimeout(quiet, 2500);
        });
      mapRef.current = map;
      map.once("load", () => {
        if (cancelled) return;
        map?.resize();
        setReady(true);
      });
    }).catch(() => {
      if (!cancelled) setEngine("grid");
    });

    return () => {
      cancelled = true;
      setReady(false);
      fitZoomRef.current = null;
      for (const { marker } of markersRef.current) marker.remove();
      markersRef.current = [];
      map?.remove();
      mapRef.current = null;
    };
  }, [showMap, guestId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let cancelled = false;

    void import("maplibre-gl").then((ml) => {
      if (cancelled || mapRef.current !== map) return;
      for (const { marker } of markersRef.current) marker.remove();
      // Oldest first, so the newest shot at a spot sits on top of the pile.
      markersRef.current = [...pinsRef.current].reverse().map((pin) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `dump-pin dump-photo-pin${pin.m.reactions.fire > 0 ? " is-fire" : ""}`;
        button.setAttribute("aria-label", pin.m.venue ? `Shot at ${pin.m.venue}` : "Shot");
        const thumb = document.createElement(pin.m.kind === "image" ? "img" : "video");
        if (thumb instanceof HTMLImageElement) {
          thumb.src = pin.m.url;
          thumb.alt = "";
          thumb.loading = "lazy";
        } else {
          thumb.src = `${pin.m.url}#t=0.1`;
          thumb.muted = true;
          thumb.preload = "metadata";
          thumb.playsInline = true;
        }
        button.appendChild(thumb);
        button.addEventListener("click", () => openShotRef.current(pin.m.id));
        return { marker: new ml.Marker({ element: button, anchor: "center" }).setLngLat([pin.lng, pin.lat]).addTo(map), k: pin.k };
      });

      if (fitZoomRef.current === null && pinsRef.current.length) {
        const bounds = new ml.LngLatBounds();
        for (const pin of pinsRef.current) bounds.extend([pin.lng, pin.lat]);
        map.fitBounds(bounds, { padding: { top: 56, bottom: 64, left: 40, right: 40 }, maxZoom: 16, duration: 0 });
        fitZoomRef.current = map.getZoom();
      }
      rescaleRef.current();
    });

    return () => {
      cancelled = true;
    };
  }, [ready, pinKey]);

  // Full screen: cover the app, let one finger pan, and give Escape a way out.
  useEffect(() => {
    const map = mapRef.current;
    if (map) {
      if (full) map.cooperativeGestures.disable();
      else map.cooperativeGestures.enable();
      requestAnimationFrame(() => map.resize());
    }
    if (!full) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [full, ready]);

  const openMoment = (ids: string[]) => {
    const list = ids.map((id) => byId.get(id)).filter((item): item is PublicMedia => !!item);
    if (list.length) onOpen(list, list[0].id);
  };
  const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const located = pins.length;

  return (
    <section>
      <div className="flex items-baseline justify-between border-b-3 border-ink px-4 pt-5 pb-3">
        <h2 className="display text-4xl">The scene</h2>
        <span className="label">
          {located} {located === 1 ? "shot" : "shots"} on the map
        </span>
      </div>

      <div
        className={
          full
            ? "fixed inset-0 z-dialog bg-paper pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
            : "relative aspect-square overflow-hidden border-b-3 border-ink bg-paper"
        }
      >
        <div className="relative h-full w-full overflow-hidden">
          {pins.length === 0 ? (
            <p className="z-labels absolute inset-0 grid place-items-center p-8 text-center">
              <span>
                <span className="display block text-2xl">No pins yet.</span>
                Shots taken with location on show up here.
              </span>
            </p>
          ) : showMap ? (
            <div className="absolute inset-0">
              <div ref={containerRef} className="dump-map h-full w-full" />
            </div>
          ) : (
            proj && <Grid pts={proj.pts} meters={proj.meters} onOpen={openShot} />
          )}
          <span className="display pointer-events-none absolute top-2 left-3 z-labels text-xl">N↑</span>
          {pins.length > 0 && (
            <div className="absolute top-2 right-2 z-labels flex flex-col gap-2">
              <button
                className="display border-2 border-ink bg-paper px-2 py-1 text-sm"
                onClick={() => setFull((v) => !v)}
                aria-pressed={full}
              >
                {full ? "✕ Exit" : "⛶ Full screen"}
              </button>
              {showMap && ready && (
                <div className="ml-auto flex flex-col border-2 border-ink bg-paper">
                  <button className="display size-9 text-xl" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in">
                    +
                  </button>
                  <button className="display size-9 border-t-2 border-ink text-xl" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out">
                    −
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {moments.length > 0 && (
        <ol>
          {[...moments].reverse().map((mo) => {
            const cover = byId.get(mo.ids[0]);
            return (
              <li key={mo.id} className="border-b border-ink">
                <button onClick={() => openMoment(mo.ids)} className="grid w-full grid-cols-[3.5rem_1fr_auto] items-center gap-3 py-2 pr-3 pl-2 text-left">
                  <Thumb m={cover} className={`size-14 border-2 object-cover ${mo.center ? "border-ink" : "border-smoke opacity-60"}`} />
                  <span className="min-w-0">
                    <span className="display block truncate text-lg">{mo.label ?? "Untitled moment"}</span>
                    <span className="label">
                      {time(mo.start)}
                      {mo.end - mo.start > 60_000 ? `–${time(mo.end)}` : ""}
                      {mo.center ? "" : " · no location"}
                    </span>
                  </span>
                  <span className="label">{mo.ids.length} →</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Thumb({ m, className }: { m?: PublicMedia; className: string }) {
  if (!m) return <span className={`block bg-bone ${className}`} />;
  return m.kind === "image" ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={m.url} alt="" loading="lazy" className={className} />
  ) : (
    <video src={`${m.url}#t=0.1`} muted playsInline preload="metadata" className={className} />
  );
}

function Grid({
  pts,
  meters,
  onOpen,
}: {
  pts: { pin: { m: PublicMedia; k: number }; x: number; y: number }[];
  meters: number;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden>
        {Array.from({ length: 11 }, (_, i) => (
          <g key={i} stroke="#121212" strokeOpacity={i % 5 === 0 ? 0.35 : 0.12} strokeWidth={0.2}>
            <line x1={i * 10} y1={0} x2={i * 10} y2={100} />
            <line x1={0} y1={i * 10} x2={100} y2={i * 10} />
          </g>
        ))}
      </svg>
      {pts.map(({ pin, x, y }) => {
        const [dx, dy] = spread(pin.k, PIN_MIN);
        return (
          <button
            key={pin.m.id}
            onClick={() => onOpen(pin.m.id)}
            className={`absolute z-labels size-[34px] overflow-hidden border-2 bg-paper ${pin.m.reactions.fire > 0 ? "border-fire" : "border-ink"}`}
            style={{ left: `calc(${x}% + ${dx}px - 17px)`, top: `calc(${y}% + ${dy}px - 17px)` }}
            aria-label="Shot"
          >
            <Thumb m={pin.m} className="size-full object-cover" />
          </button>
        );
      })}
      <span className="label absolute right-2 bottom-2 z-labels bg-paper px-1">≈ {meters} m across</span>
    </>
  );
}

const hintKey = (guestId: string) => `dump:map-hint:${guestId}`;

/** Whether this sign-in has already seen the two-finger hint. Storage can be blocked; then it shows again. */
function hintSeen(guestId: string) {
  try {
    return localStorage.getItem(hintKey(guestId)) === "1";
  } catch {
    return false;
  }
}

function markHintSeen(guestId: string) {
  try {
    localStorage.setItem(hintKey(guestId), "1");
  } catch {}
}

/** Signing out starts over: the next sign-in sees the hint once again. */
export function resetMapHint(guestId: string) {
  try {
    localStorage.removeItem(hintKey(guestId));
  } catch {}
}
