import type { StyleSpecification } from "maplibre-gl";

/**
 * Paper-and-ink map for the scene tab. Vector tiles and glyphs come from
 * OpenFreeMap; the style itself stays in the app so the colors match dump.
 * Water is blue. Grass is the working green. Motorways, including the
 * bridges drawn with them, are ink. Parks and woods stay a green washed
 * into the paper. Everything else is ink, bone, or smoke.
 */
export const MAP_COLORS = {
  paper: "#f1eee4",
  ink: "#121212",
  bone: "#e3dece",
  smoke: "#77736a",
  green: "#46a65a",
  park: "#d7ead9",
  water: "#2a78d0",
  waterDeep: "#123a66",
  residential: "#e6e0d0",
  farmland: "#e7e1d2",
} as const;

export const MAP_TILES = "https://tiles.openfreemap.org/planet";
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

const POLY = ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false];
const LINE = ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false];

function roads(classes: string[]) {
  return ["all", LINE, ["match", ["get", "class"], classes, true, false], ["!=", ["get", "brunnel"], "tunnel"]];
}

const PLACE = ["coalesce", ["get", "name_en"], ["get", "name"]];

export function dumpMapStyle(): StyleSpecification {
  return {
    version: 8,
    name: "dump",
    sources: {
      openmaptiles: { type: "vector", url: MAP_TILES },
    },
    glyphs: GLYPHS,
    layers: [
      { id: "background", type: "background", paint: { "background-color": MAP_COLORS.paper } },
      {
        id: "landuse_residential",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landuse",
        maxzoom: 16,
        filter: ["all", POLY, ["==", ["get", "class"], "residential"]],
        paint: { "fill-color": MAP_COLORS.residential },
      },
      {
        id: "landuse_farmland",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landuse",
        filter: ["all", POLY, ["==", ["get", "class"], "farmland"]],
        paint: { "fill-color": MAP_COLORS.farmland },
      },
      {
        id: "landcover_grass",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["all", POLY, ["==", ["get", "class"], "grass"]],
        paint: { "fill-color": MAP_COLORS.green },
      },
      {
        id: "landcover_wood",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        minzoom: 8,
        filter: ["all", POLY, ["==", ["get", "class"], "wood"]],
        paint: { "fill-color": MAP_COLORS.park },
      },
      {
        id: "park",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "park",
        filter: POLY,
        paint: { "fill-color": MAP_COLORS.park },
      },
      {
        id: "water",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "water",
        filter: ["all", POLY, ["!=", ["get", "brunnel"], "tunnel"]],
        paint: { "fill-color": MAP_COLORS.water, "fill-antialias": true },
      },
      {
        id: "waterway",
        type: "line",
        source: "openmaptiles",
        "source-layer": "waterway",
        filter: LINE,
        paint: {
          "line-color": MAP_COLORS.water,
          "line-width": ["interpolate", ["exponential", 1.3], ["zoom"], 8, 0.6, 16, 3],
        },
      },
      {
        id: "building",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 13,
        paint: {
          "fill-color": MAP_COLORS.bone,
          "fill-outline-color": MAP_COLORS.ink,
          "fill-antialias": true,
        },
      },
      {
        id: "highway_path",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 14,
        filter: roads(["path"]),
        layout: { "line-cap": "butt", "line-join": "miter" },
        paint: {
          "line-color": MAP_COLORS.smoke,
          "line-dasharray": [1.5, 1.5],
          "line-width": ["interpolate", ["exponential", 1.2], ["zoom"], 14, 0.6, 18, 2],
        },
      },
      {
        id: "highway_minor",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 12,
        filter: roads(["minor", "service", "track"]),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": MAP_COLORS.smoke,
          "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 12, 0.4, 14, 1.2, 18, 8],
        },
      },
      {
        id: "highway_major_low",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        maxzoom: 11,
        filter: roads(["primary", "secondary", "tertiary", "trunk"]),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": MAP_COLORS.ink, "line-width": 1.1 },
      },
      {
        id: "highway_major_casing",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 11,
        filter: roads(["primary", "secondary", "tertiary", "trunk"]),
        layout: { "line-cap": "butt", "line-join": "miter" },
        paint: {
          "line-color": MAP_COLORS.ink,
          "line-width": ["interpolate", ["exponential", 1.3], ["zoom"], 11, 2.2, 16, 10, 20, 22],
        },
      },
      {
        id: "highway_major_inner",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 11,
        filter: roads(["primary", "secondary", "tertiary", "trunk"]),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": MAP_COLORS.paper,
          "line-width": ["interpolate", ["exponential", 1.3], ["zoom"], 11, 1, 16, 7, 20, 16],
        },
      },
      {
        id: "highway_motorway_low",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        maxzoom: 8,
        filter: roads(["motorway"]),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": MAP_COLORS.ink, "line-width": 1.4 },
      },
      {
        id: "highway_motorway_casing",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 8,
        filter: roads(["motorway"]),
        layout: { "line-cap": "butt", "line-join": "miter" },
        paint: {
          "line-color": MAP_COLORS.ink,
          "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 8, 2, 12, 6, 18, 28],
        },
      },
      {
        id: "highway_motorway_inner",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 8,
        filter: roads(["motorway"]),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": MAP_COLORS.ink,
          "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 8, 1, 12, 3.5, 18, 20],
        },
      },
      {
        id: "railway",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 13,
        filter: roads(["rail"]),
        paint: {
          "line-color": MAP_COLORS.ink,
          "line-dasharray": [2, 2],
          "line-width": 1.2,
        },
      },
      {
        id: "boundary",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
        paint: {
          "line-color": MAP_COLORS.smoke,
          "line-dasharray": [2, 1],
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 8, 1.6],
        },
      },
      {
        id: "water_label_point",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "water_name",
        minzoom: 6,
        filter: ["match", ["geometry-type"], ["MultiPoint", "Point"], true, false],
        layout: {
          "text-field": PLACE,
          "text-font": ["Noto Sans Regular"],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.14,
          "text-size": ["interpolate", ["linear"], ["zoom"], 6, 10, 14, 14],
          "text-max-width": 6,
        },
        paint: {
          "text-color": MAP_COLORS.paper,
          "text-halo-color": MAP_COLORS.waterDeep,
          "text-halo-width": 1.2,
        },
      },
      {
        id: "water_label_line",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "water_name",
        minzoom: 10,
        filter: LINE,
        layout: {
          "text-field": PLACE,
          "text-font": ["Noto Sans Regular"],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.14,
          "text-size": 12,
          "symbol-placement": "line",
          "text-max-width": 6,
        },
        paint: {
          "text-color": MAP_COLORS.paper,
          "text-halo-color": MAP_COLORS.waterDeep,
          "text-halo-width": 1.2,
        },
      },
      {
        id: "road_label",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "transportation_name",
        minzoom: 15,
        filter: ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk", "minor", "motorway"], true, false],
        layout: {
          "text-field": PLACE,
          "text-font": ["Noto Sans Regular"],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.08,
          "text-size": 11,
          "symbol-placement": "line",
          "text-rotation-alignment": "map",
          "text-max-width": 8,
          "text-padding": 8,
        },
        paint: {
          "text-color": MAP_COLORS.ink,
          "text-halo-color": MAP_COLORS.paper,
          "text-halo-width": 1.4,
        },
      },
      {
        id: "place_neighbourhood",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        minzoom: 13,
        filter: ["match", ["get", "class"], ["neighbourhood", "suburb"], true, false],
        layout: {
          "text-field": PLACE,
          "text-font": ["Noto Sans Regular"],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.12,
          "text-size": 11,
          "text-max-width": 8,
        },
        paint: {
          "text-color": MAP_COLORS.ink,
          "text-halo-color": MAP_COLORS.paper,
          "text-halo-width": 1.2,
        },
      },
      {
        id: "place_town",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        minzoom: 8,
        filter: ["match", ["get", "class"], ["town", "village"], true, false],
        layout: {
          "text-field": PLACE,
          "text-font": ["Noto Sans Bold"],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.08,
          "text-size": ["interpolate", ["linear"], ["zoom"], 8, 11, 14, 16],
          "text-max-width": 8,
        },
        paint: {
          "text-color": MAP_COLORS.ink,
          "text-halo-color": MAP_COLORS.paper,
          "text-halo-width": 1.4,
        },
      },
      {
        id: "place_city",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        minzoom: 4,
        filter: ["match", ["get", "class"], ["city"], true, false],
        layout: {
          "text-field": PLACE,
          "text-font": ["Noto Sans Bold"],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.06,
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 12, 10, 22],
          "text-max-width": 8,
        },
        paint: {
          "text-color": MAP_COLORS.ink,
          "text-halo-color": MAP_COLORS.paper,
          "text-halo-width": 1.6,
        },
      },
      {
        id: "place_country",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        maxzoom: 8,
        filter: ["==", ["get", "class"], "country"],
        layout: {
          "text-field": PLACE,
          "text-font": ["Noto Sans Bold"],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.16,
          "text-size": ["interpolate", ["linear"], ["zoom"], 2, 10, 6, 16],
          "text-max-width": 6,
        },
        paint: {
          "text-color": MAP_COLORS.ink,
          "text-halo-color": MAP_COLORS.paper,
          "text-halo-width": 1.4,
        },
      },
    ],
  } as StyleSpecification;
}
