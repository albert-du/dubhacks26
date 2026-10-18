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
  const frameAt = html.indexOf("min(60dvh, calc(100cqw * 900 / 1600))");
  assert.ok(frameAt > 0);
  const frame = html.slice(frameAt, html.indexOf(">01<"));
  assert.match(frame, /src="\/api\/files\/top\?s=960"/);
  assert.match(frame, /loading="eager"/);
  assert.doesNotMatch(frame, /loading="lazy"/);
  assert.match(frame, /fetchpriority="high"/i);
  assert.match(frame, /object-fit:cover/);
  assert.match(html, /container-type:inline-size/);
});
