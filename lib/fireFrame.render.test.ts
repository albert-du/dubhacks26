import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Fire } from "../components/dumpster/Fire";
import type { PublicMedia } from "./types";

// tsx compiles the component with the classic JSX runtime. Next's own build uses the automatic one.
(globalThis as unknown as { React: typeof React }).React = React;

function shot(id: string, fire: number, w: number, h: number): PublicMedia {
  return {
    id,
    kind: "image",
    url: `/api/files/${id}`,
    width: w,
    height: h,
    tags: [],
    reactions: { fire, love: 0, lol: 0, wow: 0, cry: 0, clap: 0 },
    myReactions: [],
    faces: [],
    text: [],
    objects: [],
    mentions: [],
    status: "ready",
    createdAt: "2026-10-18T00:00:00.000Z",
  };
}

test("fire board: the winner's frame is reserved and loads immediately", () => {
  const html = renderToStaticMarkup(
    createElement(Fire, {
      media: [shot("low", 1, 800, 600), shot("top", 5, 1600, 900), shot("mid", 2, 400, 400)],
      onReact: () => {},
      onOpen: () => {},
    }),
  );
  const frame = html.indexOf("min(60dvh, calc(100cqw * 900 / 1600))");
  const eager = html.indexOf('loading="eager"');
  const firstLazy = html.indexOf('loading="lazy"');
  assert.ok(frame > 0);
  assert.ok(eager > frame);
  assert.equal(html.match(/loading="lazy"/g)?.length, 2);
  assert.ok(firstLazy > eager);
  assert.match(html, /fetchpriority="high"/i);
  assert.match(html, /container-type:inline-size/);
});
