"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users, ArrowRightLeft, Merge, Plus } from "lucide-react";
import { openTableAction, moveCheckAction, mergeChecksAction, openChannelCheckAction } from "@/actions/tables";
import { DualMoney } from "@/components/pos/money-label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { checkTotals } from "@/lib/money";
import { paths, TABLE_STATE_LABEL, tableUiState } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { runOrQueue } from "@/lib/offline-queue";
import { OpenChecksList, type OpenCheckRow } from "@/components/pos/open-checks-list";
import { isInactiveLong } from "@/lib/open-checks";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type FloorTable = {
  id: string;
  number: string;
  seats: number;
  zone: string;
  status: string;
  checks: {
    id: string;
    folio: string;
    status: string;
    guestCount: number;
    createdAt: string;
    updatedAt?: string | null;
    sentAt?: string | null;
    waiter?: { name: string } | null;
    tipUsd: number;
    lines: {
      qty: number;
      priceUsd: number;
      modifiers: string;
      status: string;
      createdAt?: string | null;
      sentAt?: string | null;
    }[];
    payments: { amountUsd: number; createdAt?: string | null }[];
  }[];
};

export function FloorPlan({
  tables,
  ivaRate,
  rate,
  kitchenWait,
  openChecks,
  cajaOpenCount,
  canCheckout = false,
}: {
  tables: FloorTable[];
  ivaRate: number;
  rate: number;
  kitchenWait: number;
  openChecks: OpenCheckRow[];
  cajaOpenCount: number;
  canCheckout?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"open" | "move" | "merge">("open");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [openList, setOpenList] = useState(false);

  const zones = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const map = new Map<string, FloorTable[]>();
    for (const t of tables) {
      if (needle && !t.number.toLowerCase().includes(needle) && !t.zone.toLowerCase().includes(needle)) {
        continue;
      }
      const list = map.get(t.zone) ?? [];
      list.push(t);
      map.set(t.zone, list);
    }
    return Array.from(map.entries());
  }, [tables, q]);

  const tableOpen = tables.filter((t) => tableUiState(t) !== "libre").length;

  function onTile(table: FloorTable) {
    setError(null);
    const open = table.checks[0];
    if (mode === "open") {
      if (open) {
        router.push(paths.table(table.id));
        return;
      }
      start(async () => {
        const res = await runOrQueue(
          { kind: "mesa", action: "openTable", payload: { tableId: table.id, guestCount: 2 } },
          () => openTableAction(table.id, 2),
        );
        if (res.queued) {
          setError("Mesa en cola offline. Al volver la red se abre en el servidor.");
          return;
        }
        if (res.error) setError(res.error);
        else router.push(paths.table(table.id));
      });
      return;
    }
    if (mode === "move") {
      if (!sourceId) {
        if (!open) {
          setError("Elige primero una mesa ocupada para mover.");
          return;
        }
        setSourceId(open.id);
        return;
      }
      start(async () => {
        const res = await moveCheckAction(sourceId, table.id);
        if (res.error) setError(res.error);
        setSourceId(null);
        setMode("open");
        router.refresh();
      });
      return;
    }
    if (mode === "merge") {
      if (!sourceId) {
        if (!open) {
          setError("Elige la mesa que se une (se vacía).");
          return;
        }
        setSourceId(open.id);
        return;
      }
      if (!open) {
        setError("El destino debe tener cuenta abierta.");
        return;
      }
      start(async () => {
        const res = await mergeChecksAction(sourceId, open.id);
        if (res.error) setError(res.error);
        setSourceId(null);
        setMode("open");
        router.refresh();
      });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">Salón</h1>
          <p className="text-sm text-muted-foreground">Toca una mesa libre para abrir · 1 toque</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={mode === "open" ? "default" : "secondary"} className="min-h-11" onClick={() => { setMode("open"); setSourceId(null); }}>
            <Plus className="mr-1 size-4" />
            Abrir
          </Button>
          <Button variant={mode === "move" ? "default" : "secondary"} className="min-h-11" onClick={() => { setMode("move"); setSourceId(null); }}>
            <ArrowRightLeft className="mr-1 size-4" />
            Mover
          </Button>
          <Button variant={mode === "merge" ? "default" : "secondary"} className="min-h-11" onClick={() => { setMode("merge"); setSourceId(null); }}>
            <Merge className="mr-1 size-4" />
            Unir
          </Button>
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await openChannelCheckAction("BARRA");
                if (res.error) setError(res.error);
                else if (res.checkId) router.push(paths.cuenta(res.checkId));
              })
            }
          >
            Barra
          </Button>
          <div className="flex flex-col justify-center">
            <Button variant="secondary" className="min-h-11 opacity-60" disabled>
              Delivery
            </Button>
            <p className="max-w-[11rem] text-[11px] text-muted-foreground">
              Delivery no está disponible en esta fase.
            </p>
          </div>
        </div>
      </div>

      {mode !== "open" ? (
        <div className="bg-primary/10 px-4 py-2 text-sm">
          {sourceId
            ? mode === "move"
              ? "Toca la mesa destino (debe estar libre)."
              : "Toca la mesa que se queda con la cuenta unida."
            : mode === "move"
              ? "Toca la mesa ocupada que vas a mover."
              : "Toca la mesa que se vacía (su cuenta se une a otra)."}
        </div>
      ) : null}
      {error ? <div className="bg-destructive/15 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="flex-1 space-y-6 overflow-auto p-4">
        {zones.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border px-4 py-16 text-center">
            <p className="text-lg font-medium">No hay mesas en esta búsqueda.</p>
            <p className="mt-1 text-sm text-muted-foreground">Limpia el filtro o pide a admin que siembre el salón.</p>
          </div>
        ) : null}
        {zones.map(([zone, list]) => (
          <section key={zone}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {zone}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {list.map((table) => {
                const open = table.checks[0];
                const state = tableUiState(table);
                const totals = open ? checkTotals(open.lines, open.tipUsd, ivaRate) : null;
                const selected = open && sourceId === open.id;
                const stale = open ? isInactiveLong(open) : false;
                return (
                  <button
                    key={table.id}
                    type="button"
                    disabled={pending}
                    onClick={() => onTile(table)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (open) router.push(paths.check(open.id));
                    }}
                    className={cn(
                      "table-tile flex min-h-[148px] min-w-[44px] flex-col rounded-2xl border-2 p-3 text-left",
                      state === "libre" && "border-free/40 bg-card hover:border-free",
                      state === "ocupada" && "border-busy/70 bg-busy/10",
                      state === "cuenta" && "border-cuenta/70 bg-cuenta/10",
                      selected && "ring-2 ring-primary",
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="text-3xl font-semibold tracking-tight">{table.number}</div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "text-[10px]",
                            state === "libre" && "bg-free text-free-foreground",
                            state === "ocupada" && "bg-busy text-busy-foreground",
                            state === "cuenta" && "bg-cuenta text-cuenta-foreground",
                          )}
                        >
                          {TABLE_STATE_LABEL[state]}
                        </Badge>
                        {stale ? (
                          <Badge variant="outline" className="border-amber-500/50 text-[10px] text-amber-800 dark:text-amber-200">
                            sin actividad
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="size-3.5" />
                      {open ? `${open.guestCount} cubiertos` : `${table.seats} puestos`}
                    </div>
                    {open && totals ? (
                      <div className="mt-auto pt-3">
                        <DualMoney usdCents={totals.totalUsd} rate={rate} size="sm" align="start" />
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {open.folio}
                          {open.waiter ? ` · ${open.waiter.name.split(" ")[0]}` : ""}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-auto pt-3 text-xs text-muted-foreground">Toca para abrir</div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-border bg-card px-4 py-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar mesa o zona"
          className="min-h-11 max-w-xs"
        />
        <button
          type="button"
          className="text-left text-sm font-medium underline-offset-4 hover:underline"
          onClick={() => setOpenList(true)}
        >
          {tableOpen} mesa{tableOpen === 1 ? "" : "s"}
          <span className="ml-1 font-normal text-muted-foreground">
            · {openChecks.length} cuenta{openChecks.length === 1 ? "" : "s"} de mesa
          </span>
        </button>
        <div className="text-sm text-muted-foreground">{kitchenWait} en cocina</div>
        {canCheckout ? (
          <div className="text-[11px] text-muted-foreground">
            Caja ve {cajaOpenCount} cuenta{cajaOpenCount === 1 ? "" : "s"} en todos los canales
          </div>
        ) : null}
      </footer>
      <Dialog open={openList} onOpenChange={setOpenList}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Mesas con cuenta</DialogTitle>
            <DialogDescription>
              Salón cuenta mesas (salón/terraza). Caja cuenta todas las cuentas abiertas (mesas, barra,
              para llevar, delivery) con ítems y saldo. No son el mismo número.
            </DialogDescription>
          </DialogHeader>
          <OpenChecksList checks={openChecks} rate={rate} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
