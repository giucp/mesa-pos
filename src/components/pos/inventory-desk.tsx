"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordStockMoveAction, setItemStockControlAction } from "@/actions/stock";
import { stockBadge } from "@/lib/stock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

export type InventoryItem = {
  id: string;
  name: string;
  available: boolean;
  stockControlled: boolean;
  stockQty: number;
  stockUnit: string;
  stockMinAlert: number;
};

export type InventoryMove = {
  id: string;
  type: string;
  qty: number;
  unit: string;
  motivo: string;
  userName: string | null;
  createdAt: string;
  itemName: string;
};

const TYPE_LABEL: Record<string, string> = {
  ENTRADA: "Entrada",
  AJUSTE: "Ajuste",
  MERMA: "Merma",
  RESERVE: "Reserva de venta",
  RELEASE: "Liberación",
};

export function InventoryDesk({
  items,
  moves,
}: {
  items: InventoryItem[];
  moves: InventoryMove[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(items.find((i) => i.stockControlled)?.id ?? items[0]?.id ?? "");
  const [qty, setQty] = useState("1");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => !needle || item.name.toLowerCase().includes(needle));
  }, [items, query]);

  const current = items.find((i) => i.id === picked);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }

  function runMove(type: "ENTRADA" | "AJUSTE" | "MERMA") {
    if (!current) return;
    const n = Number(qty.replace(",", "."));
    start(async () => {
      setError(null);
      const res = await recordStockMoveAction({
        itemId: current.id,
        type,
        qty: n,
        motivo,
      });
      if (res.error) setError(res.error);
      else {
        setMotivo("");
        flash(
          type === "ENTRADA"
            ? `Entrada registrada. Quedan ${res.stockQty} ${current.stockUnit}.`
            : type === "MERMA"
              ? `Merma registrada. Quedan ${res.stockQty} ${current.stockUnit}.`
              : `Ajuste registrado. Quedan ${res.stockQty} ${current.stockUnit}.`,
        );
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-lg font-semibold">Inventario de producto terminado</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Control opcional por plato: cantidad, unidad y mínimo de alerta. Sin recetas, insumos ni
          compras. La venta reserva al agregar; si se anula después de enviar a cocina, la comida
          preparada no vuelve sola al inventario.
        </p>
      </div>

      {error ? <div className="rounded-xl bg-destructive/15 px-3 py-2 text-sm text-destructive">{error}</div> : null}
      {toast ? <div className="rounded-xl bg-free/15 px-3 py-2 text-sm">{toast}</div> : null}

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar plato…"
        className="h-11 max-w-sm"
      />

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          No hay platos. Crea el menú primero.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => {
            const badge = stockBadge(item);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setPicked(item.id)}
                className={`flex w-full flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-left ${
                  picked === item.id ? "border-primary bg-primary/5" : "border-border bg-card"
                }`}
              >
                <div className="min-w-[160px] flex-1">
                  <div className="text-sm font-medium">{item.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.stockControlled
                      ? `${item.stockQty} ${item.stockUnit} · alerta ${item.stockMinAlert}`
                      : "Sin control — se vende como hoy"}
                  </div>
                </div>
                {badge.label ? (
                  <Badge variant={badge.kind === "out" || badge.kind === "eighty6" ? "destructive" : "secondary"}>
                    {badge.label}
                  </Badge>
                ) : (
                  <Badge variant="secondary">Sin control</Badge>
                )}
                {!item.available ? <span className="text-xs text-muted-foreground">86 manual</span> : null}
              </button>
            );
          })}
        </div>
      )}

      {current ? (
        <section className="grid gap-6 rounded-2xl border border-border bg-card p-4 lg:grid-cols-2">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">{current.name}</h2>
            <div className="flex items-center justify-between gap-3">
              <Label>Controlar existencias</Label>
              <Switch
                checked={current.stockControlled}
                disabled={pending}
                onCheckedChange={(v) =>
                  start(async () => {
                    const res = await setItemStockControlAction({
                      itemId: current.id,
                      stockControlled: v,
                      stockQty: current.stockQty,
                      stockUnit: current.stockUnit,
                      stockMinAlert: current.stockMinAlert,
                      motivo: v ? "Activar control de existencias" : "Quitar control de existencias",
                    });
                    if (res.error) setError(res.error);
                    router.refresh();
                  })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="stock-unit">Unidad</Label>
                <Input
                  id="stock-unit"
                  defaultValue={current.stockUnit}
                  className="h-11"
                  onBlur={(e) => {
                    const unit = e.target.value.trim();
                    if (!unit || unit === current.stockUnit) return;
                    start(async () => {
                      const res = await setItemStockControlAction({
                        itemId: current.id,
                        stockControlled: current.stockControlled,
                        stockUnit: unit,
                        motivo: "Cambiar unidad de inventario",
                      });
                      if (res.error) setError(res.error);
                      router.refresh();
                    });
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="stock-min">Mínimo de alerta</Label>
                <Input
                  id="stock-min"
                  type="number"
                  min={0}
                  defaultValue={current.stockMinAlert}
                  className="h-11"
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n) || n === current.stockMinAlert) return;
                    start(async () => {
                      const res = await setItemStockControlAction({
                        itemId: current.id,
                        stockControlled: current.stockControlled,
                        stockMinAlert: n,
                        motivo: "Cambiar mínimo de alerta",
                      });
                      if (res.error) setError(res.error);
                      router.refresh();
                    });
                  }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              El 86 del menú (desactivar plato) es distinto de «sin existencias». El 86 es manual;
              quedarse en cero es del inventario.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Movimiento (no es una venta)</h2>
            <div className="space-y-1">
              <Label htmlFor="stock-qty">Cantidad</Label>
              <Input
                id="stock-qty"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="h-11"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="stock-motivo">Motivo y responsable (obligatorio)</Label>
              <Textarea
                id="stock-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej. Entrada de tanda de la mañana — Ana"
                className="min-h-20"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button type="button" className="h-11" disabled={pending || !current.stockControlled} onClick={() => runMove("ENTRADA")}>
                Entrada
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-11"
                disabled={pending || !current.stockControlled}
                onClick={() => runMove("AJUSTE")}
              >
                Ajuste
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={pending || !current.stockControlled}
                onClick={() => runMove("MERMA")}
              >
                Merma
              </Button>
            </div>
            {!current.stockControlled ? (
              <p className="text-xs text-muted-foreground">Activa el control para registrar movimientos.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Historial</h2>
        {moves.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            Aún no hay entradas, ajustes, mermas ni reservas.
          </div>
        ) : (
          <div className="space-y-2">
            {moves.map((move) => (
              <div key={move.id} className="rounded-xl border border-border px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {TYPE_LABEL[move.type] ?? move.type} · {move.qty > 0 ? "+" : ""}
                    {move.qty} {move.unit}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(move.createdAt).toLocaleString("es-VE", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  {move.itemName}
                  {move.userName ? ` · ${move.userName}` : ""}
                </p>
                <p className="text-xs">{move.motivo}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
