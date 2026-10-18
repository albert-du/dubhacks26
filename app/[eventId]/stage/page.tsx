import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Stage } from "@/components/Stage";
import { getLiveDumpster } from "@/lib/dumpsters";
import { dumpsterState } from "@/lib/serialize";
import { viewerId } from "@/lib/viewer";

type Props = { params: Promise<{ eventId: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await getLiveDumpster((await params).eventId);
  return { title: d ? `${d.name} · Stage` : "Burned", robots: { index: false } };
}

export default async function StagePage({ params }: Props) {
  const d = await getLiveDumpster((await params).eventId);
  if (!d) notFound();
  return <Stage initial={await dumpsterState(d, await viewerId())} />;
}
