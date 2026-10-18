"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { dumpMapStyle } from "@/lib/mapStyle";
import { groupMoments } from "@/lib/moments";
import type { PublicMedia } from "@/lib/types";

/**
 * The scene: moments with a location, on an OpenFreeMap drawn in Dump's
 * paper and ink. Pins are numbered by moment (same time, same place).
 * Tile requests cover the area already shown on the pins. The style is ours.
 * If the phone has no WebGL, the same pins fall back to the local grid.
 */
export function EventMap({
  media,
  onOpen,
  onVenue,
}: {
  media: PublicMedia[];
  onOpen: (list: PublicMedia[], id: string) => void;
  onVenue: (venue: string) => void;
}) {
  const byId = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const moments = useMemo(
    () =>
      groupMoments(media.map((m) => ({ id: m.id, t: Date.parse(m.takenAt ?? m.createdAt), gps: m.gps, venue: m.venue, tags: m.tags }))),
    [media],
  );

  const pins = useMemo(() => {
    return moments.flatMap((mo, i) => {
      if (!mo.center) return [];
      return [
        {
          id: mo.id,
          n: i + 1,
          lng: mo.center.lng,
          lat: mo.center.lat,
          fire: mo.ids.some((id) => (byId.get(id)?.reactions.fire ?? 0) > 0),
          count: mo.ids.length,
          ids: mo.ids,
        },
      ];
    });
  }, [moments, byId]);

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

  const venues = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of media) if (m.venue) counts.set(m.venue, (counts.get(m.venue) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [media]);

  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const mediaRef = useRef(media);
  mediaRef.current = media;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const fittedRef = useRef(false);
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const [engine, setEngine] = useState<"map" | "grid">("map");
  const [ready, setReady] = useState(false);
  const showMap = engine === "map" && pins.length > 0;

  useEffect(() => {
    if (!showMap) return;
    const el = containerRef.current;
    if (!el) return;
    let map: MlMap | undefined;
    let cancelled = false;

    void import("maplibre-gl").then((ml) => {
      if (cancelled || !containerRef.current) return;
      try {
        const first = pinsRef.current[0];
        map = new ml.Map({
          container: containerRef.current,
          style: dumpMapStyle(),
          center: [first?.lng ?? 0, first?.lat ?? 0],
          zoom: 14,
          attributionControl: { compact: false },
          cooperativeGestures: true,
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
        if (/webgl/i.test(message) && !cancelled) setEngine("grid");
      });
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      map.addControl(new ml.ScaleControl({ maxWidth: 72, unit: "metric" }), "bottom-left");
      mapRef.current = map;
      map.once("load", () => {
        if (cancelled) return;
        map?.resize();
        setReady(true);
      });
    });

    return () => {
      cancelled = true;
      setReady(false);
      fittedRef.current = false;
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      map?.remove();
      mapRef.current = null;
    };
  }, [showMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let cancelled = false;

    void import("maplibre-gl").then((ml) => {
      if (cancelled || mapRef.current !== map) return;
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = pins.map((pin) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = pin.fire
          ? "dump-pin display grid size-8 place-items-center border-2 border-ink bg-fire text-sm"
          : "dump-pin display grid size-8 place-items-center border-2 border-ink bg-green text-sm";
        button.textContent = String(pin.n);
        button.setAttribute("aria-label", `Moment ${pin.n}, ${pin.count} shots`);
        button.addEventListener("click", () => {
          const current = new Map(mediaRef.current.map((item) => [item.id, item]));
          const list = pin.ids.map((id) => current.get(id)).filter((item): item is PublicMedia => !!item);
          if (list.length) onOpenRef.current(list, list[0].id);
        });
        return new ml.Marker({ element: button, anchor: "center" }).setLngLat([pin.lng, pin.lat]).addTo(map);
      });

      if (!fittedRef.current && pins.length) {
        const bounds = new ml.LngLatBounds();
        for (const pin of pins) bounds.extend([pin.lng, pin.lat]);
        map.fitBounds(bounds, { padding: { top: 44, bottom: 52, left: 28, right: 28 }, maxZoom: 16, duration: 0 });
        fittedRef.current = true;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [ready, pins]);

  const openMoment = (ids: string[]) => {
    const list = ids.map((id) => byId.get(id)).filter((item): item is PublicMedia => !!item);
    if (list.length) onOpen(list, list[0].id);
  };
  const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const number = new Map(moments.map((mo, i) => [mo.id, i + 1]));

  return (
    <section>
      <div className="flex items-baseline justify-between border-b-3 border-ink px-4 pt-5 pb-3">
        <h2 className="display text-4xl">The scene</h2>
        <span className="label">{moments.length} moments</span>
      </div>

      <div className="relative aspect-square overflow-hidden border-b-3 border-ink bg-paper">
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
          proj && <Grid pts={proj.pts} meters={proj.meters} onOpen={openMoment} />
        )}
        <span className="display pointer-events-none absolute top-2 left-3 z-labels text-xl">N↑</span>
      </div>

      {moments.length > 0 && (
        <ol>
          {[...moments].reverse().map((mo) => (
            <li key={mo.id} className="border-b border-ink">
              <button onClick={() => openMoment(mo.ids)} className="grid w-full grid-cols-[2.75rem_1fr_auto] items-center gap-3 py-2 pr-3 text-left">
                <span className={`display grid h-full place-items-center border-r border-ink text-lg ${mo.center ? "" : "text-smoke"}`}>
                  {number.get(mo.id)}
                </span>
                <span className="min-w-0">
                  <span className="display block truncate text-lg">{mo.label ?? "Untitled moment"}</span>
                  <span className="label">
                    {time(mo.start)}
                    {mo.end - mo.start > 60_000 ? `–${time(mo.end)}` : ""}
                  </span>
                </span>
                <span className="label">{mo.ids.length} →</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="px-4 pt-5 pb-2">
        <h3 className="display text-2xl">Venue board</h3>
        <p className="text-sm">Places named on signs and landmarks in the shots.</p>
      </div>
      {venues.length ? (
        <ul className="border-t border-ink">
          {venues.map(([v, n]) => (
            <li key={v} className="border-b border-ink">
              <button onClick={() => onVenue(v)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                <span className="display min-w-0 truncate text-lg">{v}</span>
                <span className="label shrink-0">{n} shots →</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="label px-4 pb-6 text-smoke">No places spotted yet.</p>
      )}
    </section>
  );
}

function Grid({
  pts,
  meters,
  onOpen,
}: {
  pts: { pin: { id: string; n: number; fire: boolean; count: number; ids: string[] }; x: number; y: number }[];
  meters: number;
  onOpen: (ids: string[]) => void;
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
      {pts.map(({ pin, x, y }) => (
        <button
          key={pin.id}
          onClick={() => onOpen(pin.ids)}
          className={`display absolute z-labels grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center border-2 border-ink text-sm ${
            pin.fire ? "bg-fire" : "bg-green"
          }`}
          style={{ left: `${x}%`, top: `${y}%` }}
          aria-label={`Moment ${pin.n}, ${pin.count} shots`}
        >
          {pin.n}
        </button>
      ))}
      <span className="label absolute right-2 bottom-2 z-labels bg-paper px-1">≈ {meters} m across</span>
    </>
  );
}
