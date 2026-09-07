"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCategoryAction, createItemAction, updateItemAction } from "@/actions/menu";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CHANNELS,
  CHANNEL_LABEL,
  TAX_CODES,
  TAX_CODE_LABEL,
  parseChannels,
  type Channel,
} from "@/lib/fiscal";
import { parseAmountToCents } from "@/lib/money";

type Station = { id: string; name: string };
type Category = { id: string; name: string };

export type MenuItemDraft = {
  id: string;
  name: string;
  description: string | null;
  priceUsd: number;
  categoryId: string;
  stationId: string;
  taxCode: string;
  channels: string;
  available: boolean;
};

export function MenuCreateButtons({
  categories,
  stations,
}: {
  categories: Category[];
  stations: Station[];
}) {
  const [itemOpen, setItemOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="h-11" onClick={() => setItemOpen(true)}>
          Nuevo plato
        </Button>
        <Button type="button" variant="outline" className="h-11" onClick={() => setCategoryOpen(true)}>
          Nueva categoría
        </Button>
      </div>
      <ItemFormDialog
        key={`new:${categories.map((category) => category.id).join(",")}`}
        open={itemOpen}
        onOpenChange={setItemOpen}
        categories={categories}
        stations={stations}
      />
      <NewCategoryDialog open={categoryOpen} onOpenChange={setCategoryOpen} />
    </>
  );
}

export function ItemFormDialog({
  open,
  onOpenChange,
  categories,
  stations,
  item,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  stations: Station[];
  item?: MenuItemDraft | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(item ? (item.priceUsd / 100).toFixed(2) : "");
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? categories[0]?.id ?? "");
  const [stationId, setStationId] = useState(item?.stationId ?? stations[0]?.id ?? "");
  const [taxCode, setTaxCode] = useState<(typeof TAX_CODES)[number]>(
    item ? asTax(item.taxCode) : "IVA16",
  );
  const [channels, setChannels] = useState<Channel[]>(
    item ? parseChannels(item.channels) : ["LOCAL", "BARRA", "TAKEAWAY"],
  );
  const [available, setAvailable] = useState(item?.available ?? true);
  const [reason, setReason] = useState("");
  const editing = Boolean(item);

  function resetBlank() {
    setError(null);
    setName("");
    setDescription("");
    setPrice("");
    setCategoryId(categories[0]?.id ?? "");
    setStationId(stations[0]?.id ?? "");
    setTaxCode("IVA16");
    setChannels(["LOCAL", "BARRA", "TAKEAWAY"]);
    setAvailable(true);
  }

  function toggleChannel(channel: Channel, checked: boolean) {
    setChannels((prev) => {
      if (checked) return CHANNELS.filter((c) => c === channel || prev.includes(c));
      return prev.filter((c) => c !== channel);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !editing) resetBlank();
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar plato" : "Nuevo plato"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Nombre, descripción, categoría, estación, canales, precio e IVA."
              : "Queda disponible en el menú de salón al guardar. Puedes marcarlo no disponible después."}
          </DialogDescription>
        </DialogHeader>
        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Primero crea una categoría con «Nueva categoría».
          </p>
        ) : stations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay estaciones de cocina. Ejecuta el seed del local.
          </p>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const cents = parseAmountToCents(price);
              if (cents == null) {
                setError("Precio inválido.");
                return;
              }
              start(async () => {
                const payload = {
                  name,
                  description,
                  priceUsd: cents,
                  categoryId,
                  stationId,
                  taxCode,
                  channels,
                  available,
                  reason,
                };
                const res = item
                  ? await updateItemAction(item.id, payload)
                  : await createItemAction(payload);
                if (res.error) {
                  setError(res.error);
                  return;
                }
                toast.success(item ? "Plato actualizado." : "Plato guardado.");
                if (!item) resetBlank();
                onOpenChange(false);
                router.refresh();
              });
            }}
          >
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="item-name">Nombre</Label>
              <Input
                id="item-name"
                className="h-11"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Arepa pelúa"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-desc">Descripción (opcional)</Label>
              <Textarea
                id="item-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Carne mechada y queso amarillo"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-price">Precio USD</Label>
              <Input
                id="item-price"
                className="h-11"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="4.50"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-category">Categoría</Label>
              <select
                id="item-category"
                className="h-11 w-full rounded-lg border border-border bg-background px-2 text-sm"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-station">Estación de cocina</Label>
              <select
                id="item-station"
                className="h-11 w-full rounded-lg border border-border bg-background px-2 text-sm"
                value={stationId}
                onChange={(e) => setStationId(e.target.value)}
              >
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-tax">Código de impuesto</Label>
              <select
                id="item-tax"
                className="h-11 w-full rounded-lg border border-border bg-background px-2 text-sm"
                value={taxCode}
                onChange={(e) => setTaxCode(e.target.value as (typeof TAX_CODES)[number])}
              >
                {TAX_CODES.map((c) => (
                  <option key={c} value={c}>
                    {TAX_CODE_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <Checkbox checked={available} onCheckedChange={(v) => setAvailable(v === true)} />
              {available ? "Disponible" : "Agotado"}
            </label>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Disponible en</legend>
              <div className="grid gap-2">
                {CHANNELS.map((channel) => (
                  <label key={channel} className="flex min-h-11 items-center gap-3 text-sm">
                    <Checkbox
                      checked={channels.includes(channel)}
                      onCheckedChange={(v) => toggleChannel(channel, v === true)}
                    />
                    {CHANNEL_LABEL[channel]}
                  </label>
                ))}
              </div>
            </fieldset>
            {editing ? (
              <div className="space-y-1.5">
                <Label htmlFor="item-motivo">Motivo (precio / IVA)</Label>
                <Textarea
                  id="item-motivo"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Obligatorio si cambias precio o IVA"
                />
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="h-11" disabled={pending}>
                {pending ? "Guardando…" : editing ? "Guardar cambios" : "Guardar plato"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewCategoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName("");
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>Nueva categoría</DialogTitle>
          <DialogDescription>Agrupa platos en el menú de salón y en administración.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await createCategoryAction(name);
              if (res.error) {
                setError(res.error);
                return;
              }
              toast.success("Categoría guardada.");
              setName("");
              setError(null);
              onOpenChange(false);
              router.refresh();
            });
          }}
        >
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Nombre</Label>
            <Input
              id="cat-name"
              className="h-11"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sopas"
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" className="h-11" disabled={pending}>
              {pending ? "Guardando…" : "Guardar categoría"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function asTax(value: string): (typeof TAX_CODES)[number] {
  return (TAX_CODES as readonly string[]).includes(value)
    ? (value as (typeof TAX_CODES)[number])
    : "IVA16";
}
