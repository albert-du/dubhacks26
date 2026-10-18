import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { config } from "./config";

/**
 * Blob storage. Vultr Object Storage (S3-compatible) when configured, local disk otherwise.
 *
 * Key layout — everything for an event lives under one prefix so a purge is one prefix delete:
 *   {dumpsterId}/original/{mediaId}.{ext}   never served to browsers
 *   {dumpsterId}/public/{mediaId}.webp      metadata-stripped render, served via /api/files
 *   {dumpsterId}/public/sticker-{id}.png
 */

const LOCAL_ROOT = path.join(process.cwd(), ".data", "storage");
const s3 = config.s3.endpoint
  ? new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      credentials: { accessKeyId: config.s3.accessKeyId ?? "", secretAccessKey: config.s3.secretAccessKey ?? "" },
      forcePathStyle: true,
    })
  : null;

const Bucket = config.s3.bucket;

function localPath(key: string) {
  const p = path.normalize(path.join(LOCAL_ROOT, key));
  if (!p.startsWith(LOCAL_ROOT)) throw new Error("bad key");
  return p;
}

export function isPublicKey(key: string) {
  const parts = key.split("/");
  return parts.length === 3 && parts[1] === "public" && !parts.some((p) => p === ".." || p === "");
}

export const storage = {
  async put(key: string, body: Buffer, contentType: string) {
    if (s3) {
      await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
      return;
    }
    const p = localPath(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
  },

  async get(key: string): Promise<Buffer> {
    if (s3) {
      const r = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    }
    return readFile(localPath(key));
  },

  /** For S3: a short-lived presigned URL (S3 handles Range requests for iOS video). */
  async signedUrl(key: string): Promise<string | null> {
    if (!s3) return null;
    return getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: 120 });
  },

  /** Local-disk streaming with Range support (needed for Safari video playback). */
  async localStream(key: string, range: string | null) {
    const p = localPath(key);
    const { size } = await stat(p);
    const m = range?.match(/bytes=(\d*)-(\d*)/);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      const body = Readable.toWeb(createReadStream(p, { start, end })) as ReadableStream;
      return { body, size, start, end, partial: true };
    }
    return { body: Readable.toWeb(createReadStream(p)) as ReadableStream, size, start: 0, end: size - 1, partial: false };
  },

  async delete(key: string) {
    if (s3) {
      await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: [{ Key: key }] } }));
      return;
    }
    await rm(localPath(key), { force: true });
  },

  /** Deletes every object under `${prefix}/`. Returns the number of objects removed. */
  async deletePrefix(prefix: string): Promise<number> {
    if (!prefix || prefix.includes("/") || prefix.includes("..")) throw new Error("bad prefix");
    if (s3) {
      let removed = 0;
      let token: string | undefined;
      do {
        const list = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: `${prefix}/`, ContinuationToken: token }));
        const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
        if (keys.length) {
          await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys } }));
          removed += keys.length;
        }
        token = list.IsTruncated ? list.NextContinuationToken : undefined;
      } while (token);
      return removed;
    }
    const dir = localPath(prefix);
    const count = await countFiles(dir);
    await rm(dir, { recursive: true, force: true });
    return count;
  },

  /** Top-level prefixes (= dumpster ids) present in storage, for the orphan sweep. */
  async listPrefixes(): Promise<string[]> {
    if (s3) {
      const out: string[] = [];
      let token: string | undefined;
      do {
        const list = await s3.send(new ListObjectsV2Command({ Bucket, Delimiter: "/", ContinuationToken: token }));
        for (const p of list.CommonPrefixes ?? []) if (p.Prefix) out.push(p.Prefix.replace(/\/$/, ""));
        token = list.IsTruncated ? list.NextContinuationToken : undefined;
      } while (token);
      return out;
    }
    try {
      return (await readdir(LOCAL_ROOT, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
  },
};

async function countFiles(dir: string): Promise<number> {
  try {
    let n = 0;
    for (const e of await readdir(dir, { withFileTypes: true })) {
      n += e.isDirectory() ? await countFiles(path.join(dir, e.name)) : 1;
    }
    return n;
  } catch {
    return 0;
  }
}
