/**
 * Renders the source brand SVGs (repo root) into small, trimmed, page-ready assets.
 * The sources embed large rasters (0.6–4.9MB), so the app never serves them directly.
 *
 *   npm run brand
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(__dirname, "..");
const out = path.join(root, "public", "brand");
const INK = "#121212";
const GREEN = "#46a65a";
const PAPER = "#f1eee4";

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Trimmed RGBA render of an SVG. */
async function load(file: string) {
  return sharp(path.join(root, file), { density: 144, limitInputPixels: false }).trim({ threshold: 1 }).png().toBuffer();
}

/** Keep the alpha (the drawing), replace every color with one brand color. */
async function recolor(png: Buffer, color: string) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [r, g, b] = hex(color);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function webp(png: Buffer, height: number, name: string) {
  await sharp(png).resize({ height, withoutEnlargement: true }).webp({ quality: 90, alphaQuality: 100 }).toFile(path.join(out, name));
}

/** Square app icon: mark centered on a solid field. */
async function icon(mark: Buffer, size: number, bg: string, scale: number, file: string) {
  const inner = await sharp(mark)
    .resize({ width: Math.round(size * scale), height: Math.round(size * scale), fit: "inside" })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: inner, gravity: "center" }])
    .png()
    .toFile(path.join(root, "public", file));
}

async function main() {
  await mkdir(out, { recursive: true });
  const mark = await load("dump_no_word.svg");
  const logo = await load("dump.svg");
  const fire = await load("dumpster_fire.svg");

  const markGreen = await recolor(mark, GREEN);
  const markInk = await recolor(mark, INK);
  // Header mark (shown ~40px tall) and hero logo (~200px tall), rendered at 3x.
  await webp(markGreen, 144, "mark-green.webp");
  await webp(markInk, 144, "mark-ink.webp");
  await webp(await recolor(logo, INK), 600, "logo-ink.webp");
  await webp(await recolor(logo, GREEN), 600, "logo-green.webp");
  // Reaction icon (shown 22–56px tall), full color.
  await webp(fire, 168, "fire.webp");

  await icon(markGreen, 512, INK, 0.62, "icon-512.png");
  await icon(markGreen, 192, INK, 0.66, "icon-192.png");
  await icon(markGreen, 180, INK, 0.66, "apple-touch-icon.png");
  await icon(markInk, 64, PAPER, 0.84, "favicon.png");
  console.log("brand assets written to public/brand and public/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
