"use server";

import { prisma } from "@/lib/db";
import { allowAction } from "@/lib/auth-guard";
import { updateItemPriceOp, updateItemTaxOp } from "@/lib/ops";
import { requireMotivo } from "@/lib/permissions";
import { writeAudit, auditDetails } from "@/lib/audit";
import { TAX_CODE_RATE, asTaxCode, serializeChannels } from "@/lib/fiscal";
import { revalidatePos } from "@/lib/revalidate";

export async function toggleItem86Action(itemId: string, available: boolean) {
  const auth = await allowAction("menu");
  if (!auth.ok) return { error: auth.error };
  await prisma.item.update({ where: { id: itemId }, data: { available } });
  revalidatePos();
}

export async function updateItemTaxAction(itemId: string, taxCode: string, reason = "") {
  const auth = await allowAction("menu");
  if (!auth.ok) return { error: auth.error };
  const res = await updateItemTaxOp(prisma, auth.user, { itemId, taxCode, reason });
  if (!res.ok) return { error: res.error };
  revalidatePos();
  return { ok: true };
}

export async function updateItemPriceAction(itemId: string, priceUsd: number, reason = "") {
  const auth = await allowAction("menu");
  if (!auth.ok) return { error: auth.error };
  const res = await updateItemPriceOp(prisma, auth.user, { itemId, priceUsd, reason });
  if (!res.ok) return { error: res.error };
  revalidatePos();
  return { ok: true };
}

export async function createCategoryAction(name: string) {
  const auth = await allowAction("menu");
  if (!auth.ok) return { error: auth.error };
  const trimmed = name.trim();
  if (!trimmed) return { error: "Escribe el nombre de la categoría." };
  if (trimmed.length > 80) return { error: "El nombre es demasiado largo." };
  const last = await prisma.category.findFirst({ orderBy: { sortOrder: "desc" } });
  const category = await prisma.category.create({
    data: { name: trimmed, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  revalidatePos();
  return { ok: true, id: category.id };
}

export async function createItemAction(input: {
  name: string;
  description?: string;
  priceUsd: number;
  categoryId: string;
  stationId: string;
  taxCode: string;
  channels: string[];
  available?: boolean;
}) {
  const auth = await allowAction("menu");
  if (!auth.ok) return { error: auth.error };
  const name = input.name.trim();
  if (!name) return { error: "Escribe el nombre del plato." };
  if (name.length > 120) return { error: "El nombre es demasiado largo." };
  if (!Number.isFinite(input.priceUsd) || input.priceUsd < 0) {
    return { error: "Precio inválido." };
  }
  const description = input.description?.trim() || null;
  if (description && description.length > 280) {
    return { error: "La descripción es demasiado larga." };
  }
  const [category, station] = await Promise.all([
    prisma.category.findUnique({ where: { id: input.categoryId } }),
    prisma.station.findUnique({ where: { id: input.stationId } }),
  ]);
  if (!category) return { error: "Elige una categoría." };
  if (!station) return { error: "Elige la estación de cocina." };
  const channels = serializeChannels(input.channels);
  if (!channels) return { error: "Marca al menos un canal (salón, barra o para llevar)." };
  const last = await prisma.item.findFirst({
    where: { categoryId: category.id },
    orderBy: { sortOrder: "desc" },
  });
  const taxCode = asTaxCode(input.taxCode);
  const item = await prisma.item.create({
    data: {
      name,
      description,
      priceUsd: Math.round(input.priceUsd),
      categoryId: category.id,
      stationId: station.id,
      taxCode,
      ivaRate: TAX_CODE_RATE[taxCode],
      channels,
      available: true,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
  revalidatePos();
  return { ok: true, id: item.id };
}

export async function updateItemAction(
  itemId: string,
  input: {
    name: string;
    description?: string;
    priceUsd: number;
    categoryId: string;
    stationId: string;
    taxCode: string;
    channels: string[];
    available?: boolean;
    reason?: string;
  },
) {
  const auth = await allowAction("menu");
  if (!auth.ok) return { error: auth.error };
  const existing = await prisma.item.findUnique({ where: { id: itemId } });
  if (!existing) return { error: "Ese plato ya no existe." };
  const priceUsd = Math.round(input.priceUsd);
  const taxChanged = asTaxCode(input.taxCode) !== existing.taxCode;
  const priceChanged = priceUsd !== existing.priceUsd;
  if (priceChanged || taxChanged) {
    const motivo = requireMotivo(input.reason);
    if (!motivo.ok) return { error: motivo.error };
  }
  const name = input.name.trim();
  if (!name) return { error: "Escribe el nombre del plato." };
  if (name.length > 120) return { error: "El nombre es demasiado largo." };
  if (!Number.isFinite(input.priceUsd) || input.priceUsd < 0) {
    return { error: "Precio inválido." };
  }
  const description = input.description?.trim() || null;
  if (description && description.length > 280) {
    return { error: "La descripción es demasiado larga." };
  }
  const [category, station] = await Promise.all([
    prisma.category.findUnique({ where: { id: input.categoryId } }),
    prisma.station.findUnique({ where: { id: input.stationId } }),
  ]);
  if (!category) return { error: "Elige una categoría." };
  if (!station) return { error: "Elige la estación de cocina." };
  const channels = serializeChannels(input.channels);
  if (!channels) return { error: "Marca al menos un canal (salón, barra o para llevar)." };
  const taxCode = asTaxCode(input.taxCode);
  await prisma.item.update({
    where: { id: itemId },
    data: {
      name,
      description,
      priceUsd,
      categoryId: category.id,
      stationId: station.id,
      taxCode,
      ivaRate: TAX_CODE_RATE[taxCode],
      channels,
      available: input.available ?? existing.available,
    },
  });
  if (priceChanged || taxChanged) {
    await writeAudit({
      action: priceChanged ? "PRICE_CHANGE" : "TAX_CHANGE",
      reason: (input.reason ?? "").trim(),
      userId: auth.user.id,
      details: auditDetails({
        entity: "item",
        entityId: itemId,
        itemName: name,
        from: { priceUsd: existing.priceUsd, taxCode: existing.taxCode },
        to: { priceUsd, taxCode },
      }),
    });
  }
  revalidatePos();
  return { ok: true, id: itemId };
}
