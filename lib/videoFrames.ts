import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bestIdentity } from "./faces";
import type { Box } from "./types";

/** How many frames a clip contributes. Spread across the whole clip, not just the opening. */
export const MAX_VIDEO_FRAMES = 8;

export interface SampledFrame {
  jpeg: Buffer;
  width: number;
  height: number;
}

export interface VideoFace {
  box: Box;
  embedding: number[];
  score: number;
  /** Index into the sampled frames. The box is on this frame. */
  frame: number;
}

/**
 * Evenly spaced timestamps inside the clip. A failed probe (duration 0) still
 * tries the first frame. One short clip yields a single frame near its middle.
 */
export function sampleTimestamps(durationSec: number, maxFrames = MAX_VIDEO_FRAMES): number[] {
  const duration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  if (duration <= 0) return [0];
  const count = Math.min(maxFrames, Math.max(1, Math.ceil(duration)));
  if (count === 1) return [Math.min(duration / 2, Math.max(0, duration - 0.05))];
  const pad = Math.min(0.25, duration * 0.05);
  const start = pad;
  const end = Math.max(start, duration - pad);
  return Array.from({ length: count }, (_, i) => start + ((end - start) * i) / (count - 1));
}

/** SOF width and height. ffmpeg's mjpeg frames have no EXIF, so this is the pixel size. */
export function jpegSize(jpeg: Buffer): { width: number; height: number } | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < jpeg.length) {
    if (jpeg[i] !== 0xff) return null;
    const marker = jpeg[i + 1];
    if (marker === 0xd9) return null;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (i + 3 >= jpeg.length) return null;
    const len = jpeg.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > jpeg.length) return null;
    // Start of scan: the rest is entropy-coded, and the SOF is already past if we got here.
    if (marker === 0xda) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (len < 7) return null;
      const height = jpeg.readUInt16BE(i + 5);
      const width = jpeg.readUInt16BE(i + 7);
      if (width < 1 || height < 1) return null;
      return { width, height };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * One face per person in the clip. The same person shows up on many frames;
 * counting each frame would inflate "N shots". Keep the clearer, larger face
 * so the gallery crop is a real face.
 */
export function uniqueVideoFaces(
  frames: { faces: { box: Box; embedding: number[]; score: number }[] }[],
  threshold: number,
): VideoFace[] {
  const kept: VideoFace[] = [];
  const area = (box: Box) => Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
  for (let frame = 0; frame < frames.length; frame++) {
    for (const face of frames[frame].faces) {
      if (!face.embedding?.length) continue;
      const i = bestIdentity(
        kept.map((person) => ({ centroid: person.embedding })),
        face.embedding,
        threshold,
      );
      if (i < 0) {
        kept.push({ box: face.box, embedding: face.embedding, score: face.score, frame });
        continue;
      }
      const prev = kept[i];
      const clearer = face.score > prev.score + 0.05;
      const larger = face.score >= prev.score - 0.05 && area(face.box) > area(prev.box);
      if (clearer || larger) kept[i] = { box: face.box, embedding: face.embedding, score: face.score, frame };
    }
  }
  return kept;
}

const FRAME_MS = 20_000;

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error(`${cmd} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", fail);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
      });
    });
  });
}

/**
 * Up to 8 JPEG frames spread across the clip, scaled so the long edge is at most 960.
 * The file is written to a temp path because phone movies keep the index at the end
 * and cannot be seeked from a pipe. Frames stay in memory; the caller stores only
 * the stills it needs for the face gallery. A missing ffmpeg rejects.
 */
export async function extractVideoFrames(video: Buffer): Promise<SampledFrame[]> {
  const dir = await mkdtemp(join(tmpdir(), "dump-frames-"));
  try {
    const file = join(dir, "clip");
    await writeFile(file, video);
    let duration = 0;
    try {
      const probed = await run(
        "ffprobe",
        ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
        FRAME_MS,
      );
      if (probed.code === 0) duration = Number(probed.stdout.toString("utf8").trim());
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw err;
    }
    const frames: SampledFrame[] = [];
    for (const t of sampleTimestamps(duration)) {
      let shot: { code: number; stdout: Buffer };
      try {
        shot = await run(
          "ffmpeg",
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            t.toFixed(3),
            "-i",
            file,
            "-frames:v",
            "1",
            "-vf",
            "scale='min(960,iw)':-2",
            "-q:v",
            "4",
            "-f",
            "mjpeg",
            "pipe:1",
          ],
          FRAME_MS,
        );
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") throw err;
        continue;
      }
      if (shot.code !== 0 || shot.stdout.length < 4) continue;
      const size = jpegSize(shot.stdout);
      if (!size) continue;
      frames.push({ jpeg: shot.stdout, ...size });
    }
    return frames;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
