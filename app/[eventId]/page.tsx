import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Room } from "@/components/room/Room";
import { getLiveDumpster } from "@/lib/dumpsters";
import { roomState } from "@/lib/serialize";
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

export default async function RoomPage({ params, searchParams }: Props) {
  const [{ eventId }, sp] = await Promise.all([params, searchParams]);
  const d = await getLiveDumpster(eventId);
  if (!d) notFound();
  const state = await roomState(d, await viewerId());
  void tiger.engagement(d._id, "view");
  return <Room initial={state} isNew={sp.new === "1"} showMine={sp.me === "1"} />;
}
