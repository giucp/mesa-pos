"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DualMoney } from "@/components/pos/money-label";
import { Input } from "@/components/ui/input";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";

type Item = {
  id: string;
  name: string;
  description: string | null;
  priceUsd: number;
  station: string;
};

export function MenuPanel({
  categories,
  rate,
}: {
  categories: { id: string; name: string; items: Item[] }[];
  rate: number;
}) {
  const [search, setSearch] = useState("");
  const [catId, setCatId] = useState(categories[0]?.id ?? "");
  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const pool = needle ? categories.flatMap((c) => c.items) : (categories.find((c) => c.id === catId)?.items ?? []);
    if (!needle) return pool;
    return pool.filter(
      (i) => i.name.toLowerCase().includes(needle) || (i.description ?? "").toLowerCase().includes(needle),
    );
  }, [categories, catId, search]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Menú</h1>
        <p className="text-sm text-muted-foreground">
          Consulta de salón. Los platos no disponibles no aparecen. Para pedir, abre una mesa.
        </p>
      </div>
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
              "min-h-11 shrink-0 rounded-full px-4 text-sm font-medium",
              catId === c.id ? "bg-primary text-primary-foreground" : "bg-secondary",
            )}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-2 gap-2 overflow-auto p-3 md:grid-cols-3 xl:grid-cols-4">
        {items.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
            No hay platos visibles. Revisa disponibilidad en Administrar menú o cambia de categoría.
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="flex min-h-[88px] flex-col rounded-2xl border border-border bg-card p-2.5">
              <div className="text-sm font-semibold">{item.name}</div>
              <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{item.description}</div>
              <div className="mt-auto pt-2 text-[11px] text-muted-foreground">{item.station}</div>
              <DualMoney usdCents={item.priceUsd} rate={rate} size="sm" align="start" />
            </div>
          ))
        )}
      </div>
      <div className="border-t border-border p-3">
        <Link href={paths.floor} className="flex min-h-11 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground">
          Ir al salón para abrir mesa
        </Link>
      </div>
    </div>
  );
}
