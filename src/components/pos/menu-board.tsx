"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleItem86Action, updateItemPriceAction, updateItemTaxAction } from "@/actions/menu";
import { ItemFormDialog, MenuCreateButtons, type MenuItemDraft } from "@/components/pos/menu-create-dialogs";
import { DualMoney } from "@/components/pos/money-label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { parseAmountToCents } from "@/lib/money";
import { TAX_CODES, TAX_CODE_LABEL, channelLabels } from "@/lib/fiscal";
import { stockBadge } from "@/lib/stock";
import { ISOLATED_DEMO } from "@/lib/isolated-demo";
import { paths } from "@/lib/paths";
import Link from "next/link";

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
  taxCode: string;
  ivaRate: number;
  channels: string;
  categoryId: string;
  station: { id: string; name: string };
};

export function MenuBoard({
  categories,
  stations,
  rate,
}: {
  categories: { id: string; name: string; items: Item[] }[];
  stations: { id: string; name: string }[];
  rate: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [availability, setAvailability] = useState<"all" | "available" | "hidden">("all");
  const [editing, setEditing] = useState<MenuItemDraft | null>(null);
  const [motivo, setMotivo] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return categories
      .map((cat) => ({
        ...cat,
        items: cat.items.filter((item) => {
          if (availability === "available" && !item.available) return false;
          if (availability === "hidden" && item.available) return false;
          if (!needle) return true;
          return (
            item.name.toLowerCase().includes(needle) ||
            (item.description ?? "").toLowerCase().includes(needle) ||
            item.station.name.toLowerCase().includes(needle)
          );
        }),
      }))
      .filter((cat) => needle || availability !== "all" ? cat.items.length > 0 : true);
  }, [categories, query, availability]);

  const totalVisible = filtered.reduce((n, c) => n + c.items.length, 0);

  return (
    <div className="space-y-6 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Administrar menú</h1>
          <p className="text-sm text-muted-foreground">
            Crea y edita platos: nombre, descripción, categoría, estación, canales, precio e IVA.
            El bolívar sale de la tasa BCV.
            {ISOLATED_DEMO ? " El 86 manual no es lo mismo que quedarse sin existencias." : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <MenuCreateButtons
            categories={categories.map((c) => ({ id: c.id, name: c.name }))}
            stations={stations}
          />
          {ISOLATED_DEMO ? (
            <Button type="button" variant="outline" className="h-11" asChild>
              <Link href={paths.inventario}>Inventario</Link>
            </Button>
          ) : null}
        </div>
        <Input
          className="h-11 min-w-[220px] sm:max-w-sm"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Motivo para precio / IVA (obligatorio)"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar plato, estación o descripción"
          className="h-11 min-w-[220px] flex-1 sm:max-w-sm"
        />
        {(
          [
            ["all", "Todos"],
            ["available", "Disponibles"],
            ["hidden", "Agotados"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            type="button"
            variant={availability === key ? "default" : "secondary"}
            className="h-11"
            onClick={() => setAvailability(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {categories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          No hay categorías. Crea una con «Nueva categoría» y luego un plato.
        </div>
      ) : totalVisible === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          Ningún plato coincide con la búsqueda o el filtro.
        </div>
      ) : (
        filtered.map((cat) => (
          <section key={cat.id}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {cat.name}
            </h2>
            {cat.items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                Sin platos en esta categoría. Usa «Nuevo plato».
              </div>
            ) : (
              <div className="space-y-2">
                {cat.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3"
                  >
                    <div className="min-w-[180px] flex-1">
                      <div className="text-sm font-medium">{item.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.station.name}
                        {item.description ? ` · ${item.description}` : ""}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {channelLabels(item.channels).join(" · ")}
                      </div>
                    </div>
                    <DualMoney usdCents={item.priceUsd} rate={rate} size="sm" />
                    <select
                      className="h-11 rounded-lg border border-border bg-background px-2 text-sm"
                      defaultValue={item.taxCode}
                      disabled={pending}
                      onChange={(e) =>
                        start(async () => {
                          await updateItemTaxAction(item.id, e.target.value, motivo);
                          router.refresh();
                        })
                      }
                    >
                      {TAX_CODES.map((c) => (
                        <option key={c} value={c}>
                          {TAX_CODE_LABEL[c]}
                        </option>
                      ))}
                    </select>
                    <Input
                      className="h-11 w-24"
                      defaultValue={(item.priceUsd / 100).toFixed(2)}
                      disabled={pending}
                      onBlur={(e) => {
                        const cents = parseAmountToCents(e.target.value);
                        if (cents == null) return;
                        start(async () => {
                          await updateItemPriceAction(item.id, cents, motivo);
                          router.refresh();
                        });
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      onClick={() =>
                        setEditing({
                          id: item.id,
                          name: item.name,
                          description: item.description,
                          priceUsd: item.priceUsd,
                          categoryId: item.categoryId,
                          stationId: item.station.id,
                          taxCode: item.taxCode,
                          channels: item.channels,
                          available: item.available,
                        })
                      }
                    >
                      Editar
                    </Button>
                    <div className="flex items-center gap-2 text-sm">
                      {ISOLATED_DEMO && stockBadge(item).label ? (
                        <span className="text-xs text-muted-foreground">{stockBadge(item).label}</span>
                      ) : null}
                      <span className="text-muted-foreground">
                        {item.available ? "Disponible" : "Agotado (86)"}
                      </span>
                      <Switch
                        checked={item.available}
                        onCheckedChange={(v) =>
                          start(async () => {
                            await toggleItem86Action(item.id, v);
                            router.refresh();
                          })
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))
      )}

      <ItemFormDialog
        open={Boolean(editing)}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        stations={stations}
        item={editing}
      />
    </div>
  );
}
