"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bumpTicketAction, recallTicketAction } from "@/actions/kitchen";
import { runOrQueue } from "@/lib/offline-queue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { safeModifiers } from "@/lib/money";
import { paths } from "@/lib/paths";
import { checkPlaceLabel } from "@/lib/open-checks";
import Link from "next/link";

type Line = {
  id: string;
  checkId: string;
  name: string;
  qty: number;
  notes: string | null;
  modifiers: string;
  status: string;
  sentAt: string | null;
  stationId: string;
  eightySixed?: boolean;
  check: { folio: string; channel?: string; table: { number: string; zone?: string | null } | null };
};

type Station = { id: string; name: string; slug: string };

function ageMinutes(sentAt: string | null) {
  if (!sentAt) return 0;
  return Math.floor((Date.now() - new Date(sentAt).getTime()) / 60000);
}

export function KdsBoard({
  stations,
  lines,
  activeSlug,
}: {
  stations: Station[];
  lines: Line[];
  activeSlug?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showBumped, setShowBumped] = useState(false);

  const columns = useMemo(() => {
    const visible = activeSlug ? stations.filter((s) => s.slug === activeSlug) : stations;
    return visible.map((station) => {
      const relevant = lines.filter((l) => l.stationId === station.id);
      const visible = showBumped
        ? relevant.filter((l) => l.status === "BUMPED")
        : relevant.filter((l) => l.status === "FIRED");
      const grouped = new Map<string, Line[]>();
      for (const line of visible) {
        const list = grouped.get(line.checkId) ?? [];
        list.push(line);
        grouped.set(line.checkId, list);
      }
      return { station, tickets: Array.from(grouped.entries()) };
    });
  }, [stations, lines, showBumped, activeSlug]);

  const fired = lines.filter((l) => l.status === "FIRED").length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">Cocina</h1>
          <p className="text-sm text-muted-foreground">
            {fired} ítems en fuego · toca la comanda para marcar que salió
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={paths.kds}
            className={cn(
              "flex min-h-11 items-center rounded-xl px-3 text-sm font-medium",
              !activeSlug ? "bg-primary text-primary-foreground" : "bg-secondary",
            )}
          >
            Todas
          </Link>
          {stations.map((s) => (
            <Link
              key={s.id}
              href={paths.kdsStation(s.slug)}
              className={cn(
                "flex min-h-11 items-center rounded-xl px-3 text-sm font-medium",
                activeSlug === s.slug ? "bg-primary text-primary-foreground" : "bg-secondary",
              )}
            >
              {s.name}
            </Link>
          ))}
          <Button
            variant={showBumped ? "default" : "secondary"}
            className="min-h-11"
            title="Recuperar pedido"
            onClick={() => setShowBumped((v) => !v)}
          >
            {showBumped ? "Comandas" : "Recuperar"}
          </Button>
        </div>
      </div>

      {columns.every((c) => c.tickets.length === 0) ? (
        <div className="m-6 flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-border text-center">
          <p className="text-lg font-medium">
            {showBumped ? "No hay comandas recientes para recuperar." : "No hay comandas en fuego."}
          </p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Las comandas del salón aparecen aquí por estación. Un toque avisa que salió.
          </p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 md:grid-cols-3">
          {columns.map(({ station, tickets }) => (
            <section key={station.id} className="min-h-0">
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {station.name} · {tickets.length}
              </h2>
              <div className="space-y-3">
                {tickets.map(([checkId, group]) => {
                  const mins = ageMinutes(group[0]?.sentAt ?? null);
                  const hot = mins >= 12;
                  return (
                    <button
                      key={checkId}
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const action = showBumped ? "recall" : "bump";
                          await runOrQueue(
                            { kind: "kds", action, payload: { checkId, stationId: station.id } },
                            () =>
                              showBumped
                                ? recallTicketAction(checkId, station.id)
                                : bumpTicketAction(checkId, station.id),
                          );
                          router.refresh();
                        })
                      }
                      className={cn(
                        "kds-ticket min-h-[160px] w-full rounded-2xl border p-4 text-left",
                        showBumped
                          ? "border-border bg-muted/40"
                          : hot
                            ? "border-destructive/60 bg-destructive/10"
                            : "border-primary/30 bg-card",
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-2xl font-semibold">
                            {checkPlaceLabel({
                              channel: group[0]?.check.channel ?? "LOCAL",
                              table: group[0]?.check.table ?? null,
                            })}
                          </div>
                          <div className="text-xs text-muted-foreground">{group[0]?.check.folio}</div>
                        </div>
                        <Badge variant={hot ? "destructive" : "secondary"}>{mins} min</Badge>
                      </div>
                      <ul className="mt-3 space-y-2">
                        {group.map((line) => (
                          <li key={line.id}>
                            <div className="text-sm font-medium">
                              <span className="mr-2 tabular-nums text-primary">{line.qty}×</span>
                              {line.name}
                              {line.eightySixed ? (
                                <Badge variant="destructive" className="ml-2 text-[10px]">
                                  No disponible
                                </Badge>
                              ) : null}
                            </div>
                            {safeModifiers(line.modifiers).length ? (
                              <div className="pl-7 text-[11px] text-muted-foreground">
                                {safeModifiers(line.modifiers)
                                  .map((m) => m.name)
                                  .join(" · ")}
                              </div>
                            ) : null}
                            {line.notes ? (
                              <div className="pl-7 text-[11px] italic text-primary">{line.notes}</div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 text-[11px] text-muted-foreground">
                        {showBumped ? "Toca para devolver la comanda" : "Toca para marcar que salió"}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
