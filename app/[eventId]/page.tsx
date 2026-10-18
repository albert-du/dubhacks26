import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DumpsterView } from "@/components/dumpster/DumpsterView";
import { getLiveDumpster } from "@/lib/dumpsters";
import { dumpsterState } from "@/lib/serialize";
import { initialTab } from "@/lib/tabs";
import { tiger } from "@/lib/tiger";
import { viewerId } from "@/lib/viewer";

type Props = {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await getLiveDumpster((await params).eventId);
  return { title: d ? d.name : "Burned", robots: { index: false } };
}

export default async function DumpsterPage({ params, searchParams }: Props) {
  const [{ eventId }, sp] = await Promise.all([params, searchParams]);
  const d = await getLiveDumpster(eventId);
  if (!d) notFound();
  const state = await dumpsterState(d, await viewerId());
  void tiger.engagement(d._id, "view");
  return (
    <DumpsterView
      initial={state}
      showMine={sp.me === "1"}
      tab={initialTab({
        requested: sp.tab,
        showMine: sp.me === "1",
        isNew: sp.new === "1",
        hasMedia: state.media.length > 0,
      })}
    />
  );
}
