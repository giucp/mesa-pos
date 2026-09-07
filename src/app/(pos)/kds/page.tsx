import { KdsBoard } from "@/components/pos/kds-board";
import { PollRefresh } from "@/components/pos/poll-refresh";
import { requireAction } from "@/lib/auth-guard";
import { getKdsLines, getKdsStations } from "@/lib/kds-data";

export default async function KdsPage() {
  await requireAction("kitchen");
  const [stations, lines] = await Promise.all([getKdsStations(), getKdsLines()]);

  return (
    <>
      <PollRefresh seconds={2} />
      <KdsBoard
        stations={stations.map((s) => ({ id: s.id, name: s.name, slug: s.slug }))}
        lines={lines}
      />
    </>
  );
}
