import { NextResponse } from "next/server";
import { getLiveDumpster } from "@/lib/dumpsters";
import { notFound, route } from "@/lib/http";
import { cols } from "@/lib/mongo";
import { tiger } from "@/lib/tiger";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/** Upload velocity (TigerData continuous metrics, Mongo fallback) + room totals for the stage display. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  const { media, guests, clusters } = await cols();

  let velocity = await tiger.velocity(d._id, 15);
  if (!velocity) {
    const rows = await media
      .aggregate<{ _id: Date; n: number }>([
        { $match: { dumpsterId: d._id, createdAt: { $gt: new Date(Date.now() - 15 * 60_000) } } },
        { $group: { _id: { $dateTrunc: { date: "$createdAt", unit: "minute" } }, n: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();
    velocity = rows.map((r) => ({ t: r._id.toISOString(), n: r.n }));
  }

  const [photos, people, faces] = await Promise.all([
    media.countDocuments({ dumpsterId: d._id, status: "ready" }),
    guests.countDocuments({ dumpsterId: d._id }),
    clusters.countDocuments({ dumpsterId: d._id, n: { $gt: 0 } }),
  ]);
  return NextResponse.json({ velocity, photos, people, faces, source: tiger.enabled() ? "tigerdata" : "mongo" });
});
