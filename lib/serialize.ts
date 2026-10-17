import { cols } from "./mongo";
import type {
  Cluster,
  Dumpster,
  Guest,
  Media,
  PublicCluster,
  PublicDumpster,
  PublicMedia,
  PublicSticker,
  RoomState,
  Sticker,
} from "./types";

/*
 * The ONLY functions allowed to shape data for browsers. They drop face vectors,
 * phone numbers, and raw storage keys.
 */

export const fileUrl = (key: string) => `/api/files/${key}`;

export function publicDumpster(d: Dumpster): PublicDumpster {
  return {
    id: d._id,
    name: d.name,
    ttlHours: d.ttlHours,
    createdAt: d.createdAt.toISOString(),
    expiresAt: d.expiresAt.toISOString(),
    settings: d.settings,
  };
}

export function publicMedia(m: Media, voted: boolean): PublicMedia {
  return {
    id: m._id,
    kind: m.kind,
    // Version param busts caches when a re-render (e.g. after a guest consents) replaces the file.
    url: m.publicKey ? `${fileUrl(m.publicKey)}?v=${m.updatedAt.getTime()}` : "",
    width: m.width,
    height: m.height,
    // ~11 m precision: enough to map the party, not enough to pinpoint someone's front door.
    gps: m.gps && { lat: Math.round(m.gps.lat * 1e4) / 1e4, lng: Math.round(m.gps.lng * 1e4) / 1e4 },
    venue: m.venue,
    caption: m.caption,
    tags: m.tags,
    aiFire: m.aiFire,
    fireReason: m.fireReason,
    votes: m.votes,
    voted,
    faces: m.faces.map((f) => ({ box: f.box, clusterId: f.clusterId })),
    text: m.text.map((t) => ({ box: t.box, text: t.text })),
    subjects: m.subjects,
    transcript: m.transcript,
    mentions: m.mentions,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
  };
}

export function publicSticker(s: Sticker): PublicSticker {
  return { id: s._id, mediaId: s.mediaId, label: s.label, url: s.publicKey ? fileUrl(s.publicKey) : undefined, status: s.status };
}

/** Face gallery: every person detected in the room, largest groups first. Names come from guests who enrolled. */
export async function publicClusters(d: Dumpster): Promise<PublicCluster[]> {
  const { clusters, guests, media } = await cols();
  const list = await clusters.find({ dumpsterId: d._id }, { projection: { centroid: 0 } }).toArray();
  const guestIds = [...new Set(list.map((c) => c.guestId).filter(Boolean))] as string[];
  const names = new Map(
    (await guests.find({ _id: { $in: guestIds } }, { projection: { name: 1 } }).toArray()).map((g) => [g._id, g.name]),
  );
  const coverIds = list.map((c) => c.cover?.mediaId).filter(Boolean) as string[];
  const covers = new Map(
    (
      await media
        .find(
          { _id: { $in: coverIds }, status: "ready" },
          { projection: { publicKey: 1, width: 1, height: 1, updatedAt: 1 } },
        )
        .toArray()
    ).map((m) => [m._id, m]),
  );
  return list
    .map((c: Omit<Cluster, "centroid">) => {
      const m = c.cover ? covers.get(c.cover.mediaId) : undefined;
      return {
        id: c._id,
        name: c.guestId ? names.get(c.guestId) : undefined,
        count: c.n,
        cover:
          m?.publicKey && c.cover
            ? { url: `${fileUrl(m.publicKey)}?v=${m.updatedAt.getTime()}`, box: c.cover.box, w: m.width ?? 1, h: m.height ?? 1 }
            : undefined,
      };
    })
    .filter((c) => c.count > 0 || c.name)
    .sort((a, b) => b.count - a.count);
}

export async function roomState(d: Dumpster, viewer: string): Promise<RoomState> {
  const { media, stickers, votes, guests, clusters } = await cols();
  const cursor = new Date();
  const list = await media
    .find({ dumpsterId: d._id, status: "ready" }, { projection: { "faces.embedding": 0 } })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray();
  const myVotes = new Set(
    (await votes.find({ dumpsterId: d._id, viewerId: viewer }).toArray()).map((v) => v.mediaId),
  );
  const me: Guest | null = await guests.findOne({ dumpsterId: d._id, viewerId: viewer });
  const myClusters = me ? await clusters.find({ dumpsterId: d._id, guestId: me._id }, { projection: { _id: 1 } }).toArray() : [];
  return {
    dumpster: publicDumpster(d),
    media: list.map((m) => publicMedia(m, myVotes.has(m._id))),
    clusters: await publicClusters(d),
    stickers: (await stickers.find({ dumpsterId: d._id }).sort({ createdAt: -1 }).toArray()).map(publicSticker),
    me: me ? { guestId: me._id, name: me.name, clusterIds: myClusters.map((c) => c._id) } : undefined,
    cursor: cursor.toISOString(),
  };
}
