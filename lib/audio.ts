import { spawn } from "node:child_process";
import { Readable } from "node:stream";

const EXTRACT_MS = 60_000;
const SAMPLE_RATE = 16_000;

/**
 * 16-bit mono PCM wrapped in a WAV header whose sizes match the samples.
 * ffmpeg cannot seek a pipe, so a WAV it writes there has an empty length and
 * Speaches often rejects it. Search then has no words. The header is built here.
 */
export function pcmToWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const samples = pcm.length % 2 === 0 ? pcm : pcm.subarray(0, pcm.length - 1);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

/**
 * Speech track as 16 kHz mono WAV. Speaches decodes wav reliably; phone .mov/.mp4
 * containers often come back 415, so the video would publish with nothing to search.
 * The wav is not stored. A missing ffmpeg or a clip with no audio track rejects.
 */
export function extractSpeechWav(video: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
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
      const pcm = Buffer.concat(stdout);
      const samples = pcm.length - (pcm.length % 2);
      // A killed or failed decode can still have delivered samples. Prefer those.
      if (samples >= 2) {
        resolve(pcmToWav(pcm.subarray(0, samples), SAMPLE_RATE));
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || (code ? `ffmpeg exited ${code}` : "no audio")));
    });
    const input = Readable.from(video);
    input.on("error", () => {});
    input.pipe(ff.stdin);
  });
}
