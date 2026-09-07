import { notFound } from "next/navigation";
import { KdsBoard } from "@/components/pos/kds-board";
import { PollRefresh } from "@/components/pos/poll-refresh";
import { requireAction } from "@/lib/auth-guard";
import { getKdsLines, getKdsStations } from "@/lib/kds-data";

export default async function KdsStationPage({
  params,
}: {
  params: Promise<{ station: string }>;
}) {
  await requireAction("kitchen");
  const { station } = await params;
  const [stations, lines] = await Promise.all([getKdsStations(), getKdsLines()]);
  const match = stations.find((s) => s.slug === station);
  if (!match) notFound();

  return (
    <>
      <PollRefresh seconds={2} />
      <KdsBoard
        activeSlug={station}
        stations={stations.map((s) => ({ id: s.id, name: s.name, slug: s.slug }))}
        lines={lines.filter((l) => l.stationId === match.id)}
      />
    </>
  );
}
