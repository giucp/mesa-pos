"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, Send, Banknote, StickyNote, Ban, Users } from "lucide-react";
import {
  addItemAction,
  changeQtyAction,
  removeLineAction,
  sendToKitchenAction,
  updateLineNotesAction,
  voidCheckAction,
} from "@/actions/orders";
import { updateGuestsAction } from "@/actions/tables";
import { DualMoney } from "@/components/pos/money-label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { checkTotals, lineTotalUsd, safeModifiers, formatUsd } from "@/lib/money";
import { can, type Role } from "@/lib/roles";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { listJobs, QUEUE_EVENT, runOrQueue, type QueueJob } from "@/lib/offline-queue";
import { queueAndPrint } from "@/lib/print-tickets";
import { SyncConflictDialog } from "@/components/pos/sync-conflict";
import type { ServerCheckSnapshot } from "@/lib/sync-state";
import { stockBadge } from "@/lib/stock";

type Item = {
  id: string;
  name: string;
  description: string | null;
  priceUsd: number;
  available: boolean;
  stockControlled?: boolean;
  stockQty?: number;
  stockUnit?: string;
  stockMinAlert?: number;
  station: { name: string };
  modifiers: { id: string; name: string; priceUsd: number }[];
};

type Category = { id: string; name: string; items: Item[] };

type Line = {
  id: string;
  name: string;
  qty: number;
  priceUsd: number;
  notes: string | null;
  modifiers: string;
  status: string;
};

export function OrderEntry({
  placeLabel,
  check,
  categories,
  ivaRate,
  rate,
  role,
}: {
  placeLabel: string;
  check: {
    id: string;
    folio: string;
    guestCount: number;
    notes: string | null;
    tipUsd: number;
    status: string;
    updatedAt: string;
    lines: Line[];
  };
  categories: Category[];
  ivaRate: number;
  rate: number;
  role: Role;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [catId, setCatId] = useState(categories[0]?.id ?? "");
  const [picked, setPicked] = useState<Item | null>(null);
  const [mods, setMods] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [lineNote, setLineNote] = useState<Line | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [queuedLines, setQueuedLines] = useState<QueueJob[]>([]);
  const [kitchenQueued, setKitchenQueued] = useState(false);
  const [knownLineIds, setKnownLineIds] = useState(check.lines.map((l) => l.id));
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(check.updatedAt);
  const [conflict, setConflict] = useState<{
    local: { name: string; qty: number; notes?: string | null };
    server: ServerCheckSnapshot;
    retry: () => void;
  } | null>(null);

  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const pool = needle
      ? categories.flatMap((c) => c.items)
      : (categories.find((c) => c.id === catId)?.items ?? []);
    return pool.filter((i) => {
      if (!i.available) return false;
      if (!needle) return true;
      return i.name.toLowerCase().includes(needle) || (i.description ?? "").toLowerCase().includes(needle);
    });
  }, [categories, catId, search]);
  const totals = checkTotals(check.lines, check.tipUsd, ivaRate);
  const held = check.lines.filter((l) => l.status === "HELD").length;
  const canPay = can(role, "checkout");
  const canVoid = can(role, "void");

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  useEffect(() => {
    setKnownLineIds(check.lines.map((l) => l.id));
    setBaseUpdatedAt(check.updatedAt);
  }, [check.id, check.updatedAt, check.lines]);

  useEffect(() => {
    const load = async () => {
      const jobs = await listJobs();
      setQueuedLines(jobs.filter((j) => j.action === "addItem" && j.payload.checkId === check.id));
      setKitchenQueued(jobs.some((j) => j.action === "sendKitchen" && j.payload.checkId === check.id));
    };
    load().catch(() => undefined);
    window.addEventListener(QUEUE_EVENT, load);
    return () => window.removeEventListener(QUEUE_EVENT, load);
  }, [check.id]);

  function add(item: Item, modifierIds: string[], notes: string) {
    start(async () => {
      const clientOpId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `item-${Date.now()}`;
      const payload = {
        checkId: check.id,
        itemId: item.id,
        itemName: item.name,
        qty: 1,
        modifierIds,
        notes,
        placeLabel,
        clientOpId,
        knownLineIds,
        baseUpdatedAt,
      };
      const send = (ids: string[], updatedAt: string) =>
        addItemAction(check.id, item.id, modifierIds, notes, {
          qty: 1,
          clientOpId,
          knownLineIds: ids,
          baseUpdatedAt: updatedAt,
        });
      const res = await runOrQueue(
        {
          id: clientOpId,
          kind: "pedido",
          action: "addItem",
          payload,
          requiresStockConfirm: Boolean(item.stockControlled),
        },
        () => send(knownLineIds, baseUpdatedAt),
      );
      if (res.queued) {
        flash("Plato en cola. No está en cocina hasta que el servidor lo confirme.");
        setPicked(null);
        setMods([]);
        setNote("");
        return;
      }
      if ("conflict" in res && res.conflict && res.server) {
        setConflict({
          local: { name: item.name, qty: 1, notes },
          server: res.server,
          retry: () => {
            start(async () => {
              const again = await send(res.server.lineIds, res.server.updatedAt);
              if (again.error) setError(again.error);
              else {
                if (again.lineId) setKnownLineIds((prev) => [...prev, again.lineId!]);
                if (again.updatedAt) setBaseUpdatedAt(again.updatedAt);
                setConflict(null);
                router.refresh();
              }
            });
          },
        });
        return;
      }
      if (res.error) setError(res.error);
      else {
        if (res.lineId) setKnownLineIds((prev) => [...prev, res.lineId!]);
        if (res.updatedAt) setBaseUpdatedAt(res.updatedAt);
        setPicked(null);
        setMods([]);
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col-reverse lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-t border-border bg-card lg:w-[380px] lg:border-t-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold">{placeLabel}</h1>
            <p className="text-xs text-muted-foreground">
              {check.folio} · {held} por enviar
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="icon"
              className="size-11"
              disabled={pending || check.guestCount <= 1}
              onClick={() =>
                start(() => updateGuestsAction(check.id, check.guestCount - 1).then(() => router.refresh()))
              }
            >
              <Minus className="size-4" />
            </Button>
            <div className="flex items-center gap-1 text-sm">
              <Users className="size-4 text-muted-foreground" />
              {check.guestCount}
            </div>
            <Button
              variant="secondary"
              size="icon"
              className="size-11"
              disabled={pending}
              onClick={() =>
                start(() => updateGuestsAction(check.id, check.guestCount + 1).then(() => router.refresh()))
              }
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
        {error ? <div className="bg-destructive/15 px-4 py-2 text-sm text-destructive">{error}</div> : null}
        {toast ? <div className="bg-free/15 px-4 py-2 text-sm">{toast}</div> : null}
        <ScrollArea className="flex-1">
          <div className="space-y-2 p-3">
            {kitchenQueued ? (
              <div className="rounded-xl border border-busy/40 bg-busy/10 px-3 py-2 text-xs">
                Envío a cocina en cola. No se muestra «Enviado a cocina» hasta que el servidor
                confirme.
              </div>
            ) : null}
            {queuedLines.map((job) => (
              <div
                key={job.id}
                className="rounded-xl border border-dashed border-border bg-background/40 p-3"
              >
                <div className="text-sm font-medium">{String(job.payload.itemName ?? "Plato")}</div>
                <div className="text-[11px] text-muted-foreground">
                  {Number(job.payload.qty ?? 1)}× · {placeLabel}
                  {job.payload.notes ? ` · ${String(job.payload.notes)}` : ""}
                </div>
                <Badge variant="secondary" className="mt-2 text-[10px]">
                  En cola · no enviado a cocina
                </Badge>
              </div>
            ))}
            {check.lines.length === 0 && queuedLines.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                Toca un plato (1) · extra si tiene (1) · ENVIAR COCINA. Cocina no ve nada hasta
                que el servidor confirme el envío.
              </div>
            ) : check.lines.length === 0 ? null : (
              check.lines.map((line) => (
                <div key={line.id} className="rounded-xl border border-border bg-background/40 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{line.name}</div>
                      {safeModifiers(line.modifiers).length ? (
                        <div className="text-[11px] text-muted-foreground">
                          {safeModifiers(line.modifiers)
                            .map((m) => m.name)
                            .join(" · ")}
                        </div>
                      ) : null}
                      {line.notes ? (
                        <div className="text-[11px] italic text-primary">{line.notes}</div>
                      ) : null}
                    </div>
                    <DualMoney
                      usdCents={lineTotalUsd(line.qty, line.priceUsd, line.modifiers)}
                      rate={rate}
                      size="sm"
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <Badge variant="secondary" className="text-[10px]">
                      {line.status === "HELD"
                        ? "Nuevo"
                        : line.status === "FIRED"
                          ? "En cocina"
                          : line.status === "BUMPED"
                            ? "Listo"
                            : line.status}
                    </Badge>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="secondary"
                        className="size-11"
                        disabled={pending || line.status !== "HELD"}
                        onClick={() =>
                          start(async () => {
                            await changeQtyAction(line.id, -1);
                            router.refresh();
                          })
                        }
                      >
                        <Minus className="size-3.5" />
                      </Button>
                      <span className="w-6 text-center text-sm tabular-nums">{line.qty}</span>
                      <Button
                        size="icon"
                        variant="secondary"
                        className="size-11"
                        disabled={pending || line.status !== "HELD"}
                        onClick={() =>
                          start(async () => {
                            await changeQtyAction(line.id, 1);
                            router.refresh();
                          })
                        }
                      >
                        <Plus className="size-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="size-11" onClick={() => setLineNote(line)}>
                        <StickyNote className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
        <div className="sticky bottom-0 space-y-3 border-t border-border bg-card p-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatUsd(totals.subtotalUsd)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">IVA</span>
            <span>{formatUsd(totals.ivaUsd)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Total</span>
            <DualMoney usdCents={totals.totalUsd} rate={rate} size="md" />
          </div>
          <Button
            className="min-h-14 w-full text-base font-semibold"
            disabled={pending || held === 0}
            onClick={() =>
              start(async () => {
                const heldLines = check.lines.filter((l) => l.status === "HELD");
                const res = await runOrQueue(
                  {
                    kind: "pedido",
                    action: "sendKitchen",
                    payload: {
                      checkId: check.id,
                      folio: check.folio,
                      placeLabel,
                      lines: heldLines.map((l) => ({
                        qty: l.qty,
                        name: l.name,
                        notes: l.notes,
                      })),
                    },
                  },
                  () => sendToKitchenAction(check.id),
                );
                if (res.queued) {
                  flash("Envío en cola. Cocina no lo ve hasta que el servidor confirme.");
                  return;
                }
                if (res.error) {
                  setError(res.error);
                  return;
                }
                await queueAndPrint({
                  type: "comanda",
                  folio: check.folio,
                  table: placeLabel,
                  lines: heldLines.map((l) => ({
                    qty: l.qty,
                    name: l.name,
                    extras: safeModifiers(l.modifiers).map((m) => m.name).join(" · "),
                    notes: l.notes,
                  })),
                  footer: "Comanda cocina · cola de impresión Mesa (no es máquina fiscal).",
                });
                flash(`Enviados ${res.count ?? held} a cocina`);
                router.refresh();
              })
            }
          >
            <Send className="mr-1 size-4" />
            ENVIAR COCINA
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className="min-h-11" onClick={() => router.push(paths.check(check.id))}>
              Cuenta
            </Button>
            <Button
              variant="secondary"
              className="min-h-11"
              disabled={!canPay}
              onClick={() => router.push(paths.pay(check.id))}
            >
              <Banknote className="mr-1 size-4" />
              Cobrar
            </Button>
          </div>
          {canVoid ? (
            <Button variant="ghost" className="w-full text-destructive" onClick={() => setVoidOpen(true)}>
              <Ban className="mr-1 size-4" />
              Anular cuenta
            </Button>
          ) : null}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="border-b border-border px-3 py-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar plato…"
            className="min-h-11"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto border-b border-border px-3 py-2">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCatId(c.id)}
              className={cn(
                "pos-touch shrink-0 rounded-full px-4 text-sm font-medium",
                catId === c.id ? "bg-primary text-primary-foreground" : "bg-secondary",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>

        <ScrollArea className="flex-1">
          <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-3 xl:grid-cols-4">
            {items.length === 0 ? (
              <div className="col-span-full rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
                No hay platos en esta categoría (o están no disponibles). Cambia de pestaña o busca.
              </div>
            ) : null}
            {items.map((item) => {
              const badge = stockBadge(item);
              return (
              <button
                key={item.id}
                type="button"
                disabled={!item.available || !badge.sellable || pending}
                onClick={() => {
                  if (!badge.sellable) return;
                  if (item.modifiers.length) {
                    setPicked(item);
                    setMods([]);
                    setNote("");
                  } else {
                    add(item, [], "");
                  }
                }}
                className={cn(
                  "flex min-h-[96px] flex-col rounded-2xl border border-border bg-card p-2.5 text-left active:scale-[0.98]",
                  (!item.available || !badge.sellable) && "opacity-40",
                )}
              >
                <div className="text-sm font-semibold leading-snug">{item.name}</div>
                <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                  {!item.available
                    ? "Agotado (86)"
                    : badge.kind === "out"
                      ? "Sin existencias"
                      : item.description}
                </div>
                {badge.label && badge.kind !== "eighty6" ? (
                  <div className="mt-1 text-[10px] font-medium text-primary">{badge.label}</div>
                ) : null}
                <div className="mt-auto pt-2">
                  <DualMoney usdCents={item.priceUsd} rate={rate} size="sm" align="start" />
                </div>
              </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      <Dialog open={Boolean(picked)} onOpenChange={() => setPicked(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{picked?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Un toque al extra lo agrega a la cuenta.</p>
            {picked?.modifiers.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={pending}
                onClick={() => picked && add(picked, [m.id], note)}
                className="flex min-h-12 w-full items-center justify-between rounded-xl border border-border px-4 text-left"
              >
                <span className="text-sm font-medium">{m.name}</span>
                <span className="text-xs text-muted-foreground">
                  {m.priceUsd ? `+${formatUsd(m.priceUsd)}` : "Sin cargo"}
                </span>
              </button>
            ))}
            <div className="space-y-1">
              <Label>Nota para cocina</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Poco sal, sin cebolla…" />
            </div>
            <Button
              className="h-12 w-full"
              disabled={!picked || pending}
              onClick={() => picked && add(picked, mods, note)}
            >
              Agregar sin extra
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(lineNote)} onOpenChange={() => setLineNote(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nota · {lineNote?.name}</DialogTitle>
          </DialogHeader>
          <Textarea
            defaultValue={lineNote?.notes ?? ""}
            id="line-note"
            placeholder="Instrucción para cocina"
          />
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => {
                const el = document.getElementById("line-note") as HTMLTextAreaElement | null;
                if (lineNote) {
                  start(async () => {
                    await updateLineNotesAction(lineNote.id, el?.value ?? "");
                    setLineNote(null);
                    router.refresh();
                  });
                }
              }}
            >
              Guardar
            </Button>
            {lineNote?.status === "HELD" ? (
              <Button
                variant="destructive"
                onClick={() => {
                  if (!lineNote) return;
                  start(async () => {
                    await removeLineAction(lineNote.id);
                    setLineNote(null);
                    router.refresh();
                  });
                }}
              >
                Quitar
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular {check.folio}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Queda registrado en el reporte del día. Requiere permiso de caja o admin.
          </p>
          <Textarea
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Motivo (cliente se retiró, error de mesa…)"
          />
          <Button
            variant="destructive"
            className="h-12"
            disabled={!voidReason.trim() || pending}
            onClick={() =>
              start(async () => {
                const res = await voidCheckAction(check.id, voidReason);
                if (res.error) setError(res.error);
                else router.push(paths.floor);
              })
            }
          >
            Confirmar anulación
          </Button>
        </DialogContent>
      </Dialog>

      <SyncConflictDialog
        open={Boolean(conflict)}
        local={{
          name: conflict?.local.name ?? "",
          qty: conflict?.local.qty ?? 1,
          notes: conflict?.local.notes,
          placeLabel,
        }}
        server={conflict?.server ?? null}
        onUseServer={() => {
          setConflict(null);
          router.refresh();
        }}
        onSendMine={() => conflict?.retry()}
      />
    </div>
  );
}
