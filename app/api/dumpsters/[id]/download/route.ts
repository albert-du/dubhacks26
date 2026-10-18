import { getLiveDumpster } from "@/lib/dumpsters";
import { cols } from "@/lib/mongo";
import { storage } from "@/lib/storage";
import { zipStream } from "@/lib/zip";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

const MAX_FILES = 300;

/**
 * Multi-select download: a ZIP of the chosen shots. Posted as a plain form
 * (ids=...&ids=...) so the browser saves the response natively instead of
 * buffering it in page memory.
 */
export async function POST(req: Request, { params }: Ctx) {
  const d = await getLiveDumpster((await params).id);
  if (!d) return new Response("gone", { status: 410 });

  const form = await req.formData();
  const ids = [...new Set(form.getAll("ids").map(String))].slice(0, MAX_FILES);
  if (!ids.length) return new Response("Pick at least one shot", { status: 400 });

  const { media } = await cols();
  const list = await media
    .find({ _id: { $in: ids }, dumpsterId: d._id, status: "ready", publicKey: { $exists: true } }, { projection: { publicKey: 1, createdAt: 1, takenAt: 1 } })
    .sort({ createdAt: 1 })
    .toArray();

  const stream = zipStream(
    list.map((m, i) => ({
      name: `${String(i + 1).padStart(3, "0")}-${m.publicKey!.split("/").pop()}`,
      date: m.takenAt ?? m.createdAt,
      read: () => storage.get(m.publicKey!),
    })),
  );
  const slug = d.name.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "dump";
  return new Response(stream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${slug}.zip"`,
      "cache-control": "no-store",
    },
  });
}
