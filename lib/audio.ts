import { spawn } from "node:child_process";
import { Readable } from "node:stream";

const EXTRACT_MS = 60_000;

/**
 * Speech track as 16 kHz mono WAV. Speaches decodes wav reliably; phone .mov/.mp4
 * containers often come back 415, so the video would publish with nothing to search.
 * The wav is not stored. A missing ffmpeg or a clip with no audio track rejects.
 */
export function extractSpeechWav(video: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", "pipe:1"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };
    timer = setTimeout(() => {
      ff.kill();
      fail(new Error("ffmpeg timed out"));
    }, EXTRACT_MS);
    ff.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    ff.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    ff.stdin.on("error", () => {});
    ff.on("error", (err) => fail(err));
    ff.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `ffmpeg exited ${code}`));
        return;
      }
      const wav = Buffer.concat(stdout);
      if (wav.length < 45 || wav.subarray(0, 4).toString() !== "RIFF") {
        reject(new Error("no audio"));
        return;
      }
      resolve(wav);
    });
    const input = Readable.from(video);
    input.on("error", () => {});
    input.pipe(ff.stdin);
  });
}
