import { MongoClient, type Db } from "mongodb";
import { config } from "./config";
import type { Cluster, Dumpster, Guest, Media, Sticker, Vote } from "./types";

/**
 * Every collection that holds event data. Each one gets a TTL index on `expiresAt`
 * (dumpsters on `hardDeleteAt`) so Mongo deletes records even if the worker is down.
 * scripts/privacy-audit.ts checks that this list covers every collection used in lib/.
 */
export const EPHEMERAL_COLLECTIONS = {
  dumpsters: "hardDeleteAt",
  guests: "expiresAt",
  media: "expiresAt",
  clusters: "expiresAt",
  stickers: "expiresAt",
  votes: "expiresAt",
} as const;

const g = globalThis as unknown as { _dumpMongo?: Promise<MongoClient>; _dumpIdx?: Promise<void> };

async function ensureIndexes(d: Db) {
  for (const [name, field] of Object.entries(EPHEMERAL_COLLECTIONS)) {
    await d.collection(name).createIndex({ [field]: 1 }, { expireAfterSeconds: 0 });
  }
  await d.collection("media").createIndex({ dumpsterId: 1, updatedAt: 1 });
  await d.collection("media").createIndex({ status: 1, createdAt: 1 });
  await d.collection("clusters").createIndex({ dumpsterId: 1 });
  await d.collection("guests").createIndex({ dumpsterId: 1, viewerId: 1 });
  await d.collection("stickers").createIndex({ dumpsterId: 1, updatedAt: 1 });
  await d.collection("stickers").createIndex({ status: 1 });
  await d.collection("dumpsters").createIndex({ expiresAt: 1 });
}

export async function db(): Promise<Db> {
  if (!g._dumpMongo) {
    g._dumpMongo = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 5000 }).connect();
    g._dumpMongo.catch(() => (g._dumpMongo = undefined));
  }
  const d = (await g._dumpMongo).db(config.mongoDb);
  if (!g._dumpIdx) {
    g._dumpIdx = ensureIndexes(d);
    g._dumpIdx.catch(() => (g._dumpIdx = undefined));
  }
  await g._dumpIdx;
  return d;
}

export async function cols() {
  const d = await db();
  return {
    dumpsters: d.collection<Dumpster>("dumpsters"),
    guests: d.collection<Guest>("guests"),
    media: d.collection<Media>("media"),
    clusters: d.collection<Cluster>("clusters"),
    stickers: d.collection<Sticker>("stickers"),
    votes: d.collection<Vote>("votes"),
  };
}

export async function closeMongo() {
  if (g._dumpMongo) await (await g._dumpMongo).close();
  g._dumpMongo = undefined;
  g._dumpIdx = undefined;
}
