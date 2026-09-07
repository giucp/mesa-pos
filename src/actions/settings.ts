"use server";

import { prisma } from "@/lib/db";
import { allowAction } from "@/lib/auth-guard";
import { requireMotivo } from "@/lib/permissions";
import { fetchRemoteRate } from "@/lib/bcv";
import { writeAudit, auditDetails } from "@/lib/audit";
import { revalidatePos } from "@/lib/revalidate";

export async function updateRestaurantAction(formData: FormData) {
  const auth = await allowAction("settings");
  if (!auth.ok) return { error: auth.error };
  const user = auth.user;
  const restaurant = await prisma.restaurant.findFirst();
  if (!restaurant) return { error: "Sin restaurante." };
  const motivoField = String(formData.get("motivo") || "");

  const name = String(formData.get("name") || "").trim();
  const rif = String(formData.get("rif") || "").trim();
  const address = String(formData.get("address") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const ivaRate = Number.parseFloat(String(formData.get("ivaRate") || "16"));
  const igtfBancarizadoRate = Number.parseFloat(String(formData.get("igtfBancarizadoRate") || "0"));
  const igtfForexRate = Number.parseFloat(String(formData.get("igtfForexRate") || "3"));
  const tipInTaxableBase = String(formData.get("tipInTaxableBase") || "") === "on";
  const bcvRate = Number.parseFloat(String(formData.get("bcvRate") || ""));

  if (!name || !rif) return { error: "Nombre y RIF son obligatorios." };
  if (!Number.isFinite(ivaRate) || ivaRate < 0 || ivaRate > 40) {
    return { error: "IVA inválido." };
  }
  if (!Number.isFinite(igtfBancarizadoRate) || igtfBancarizadoRate < 0 || igtfBancarizadoRate > 20) {
    return { error: "IGTF bancarizado inválido." };
  }
  if (!Number.isFinite(igtfForexRate) || igtfForexRate < 0 || igtfForexRate > 20) {
    return { error: "IGTF forex inválido." };
  }

  const data: {
    name: string;
    rif: string;
    address: string;
    phone: string;
    ivaRate: number;
    igtfBancarizadoRate: number;
    igtfForexRate: number;
    tipInTaxableBase: boolean;
    bcvRate?: number;
    bcvUpdatedAt?: Date;
    bcvSource?: string;
  } = {
    name,
    rif,
    address,
    phone,
    ivaRate,
    igtfBancarizadoRate,
    igtfForexRate,
    tipInTaxableBase,
  };

  const taxChanged =
    ivaRate !== restaurant.ivaRate ||
    igtfBancarizadoRate !== restaurant.igtfBancarizadoRate ||
    igtfForexRate !== restaurant.igtfForexRate;
  if (taxChanged) {
    const motivo = requireMotivo(motivoField);
    if (!motivo.ok) return { error: motivo.error };
  }

  if (Number.isFinite(bcvRate) && bcvRate > 0 && Math.abs(bcvRate - restaurant.bcvRate) > 0.0001) {
    data.bcvRate = bcvRate;
    data.bcvUpdatedAt = new Date();
    data.bcvSource = "manual";
    await prisma.rateLog.create({
      data: { rate: bcvRate, source: "manual" },
    });
    await writeAudit({
      action: "BCV_MANUAL",
      reason: requireMotivo(motivoField).ok ? motivoField.trim() : "Cambio manual de tasa BCV",
      userId: user.id,
      details: auditDetails({
        entity: "restaurant",
        entityId: restaurant.id,
        from: restaurant.bcvRate,
        to: bcvRate,
      }),
    });
  }
  if (taxChanged) {
    await writeAudit({
      action: "TAX_CHANGE",
      reason: motivoField.trim(),
      userId: user.id,
      details: auditDetails({
        entity: "restaurant",
        entityId: restaurant.id,
        from: {
          ivaRate: restaurant.ivaRate,
          igtfBancarizadoRate: restaurant.igtfBancarizadoRate,
          igtfForexRate: restaurant.igtfForexRate,
        },
        to: { ivaRate, igtfBancarizadoRate, igtfForexRate },
      }),
    });
  }

  await prisma.restaurant.update({ where: { id: restaurant.id }, data });
  revalidatePos();
  return { ok: true };
}

export async function refreshBcvAction() {
  const auth = await allowAction("settings");
  if (!auth.ok) return { error: auth.error };
  try {
    const remote = await fetchRemoteRate();
    if (!remote) {
      return {
        error:
          "No hay proveedor de tasa configurado. Carga la tasa a mano. No existe API REST oficial del BCV en esta fase.",
      };
    }
    const restaurant = await prisma.restaurant.findFirst();
    if (!restaurant) return { error: "Sin restaurante." };
    await prisma.restaurant.update({
      where: { id: restaurant.id },
      data: {
        bcvRate: remote.usdToVes,
        bcvUpdatedAt: remote.fetchedAt,
        bcvSource: remote.source,
      },
    });
    await prisma.rateLog.create({
      data: { rate: remote.usdToVes, source: remote.source, fetchedAt: remote.fetchedAt },
    });
    revalidatePos();
    return { ok: true, rate: remote.usdToVes };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Fallo al consultar la tasa." };
  }
}

export async function togglePaymentMethodAction(id: string, enabled: boolean) {
  const auth = await allowAction("settings");
  if (!auth.ok) return { error: auth.error };
  await prisma.paymentMethod.update({ where: { id }, data: { enabled } });
  revalidatePos();
}

export async function setMethodIgtfAction(id: string, igtfProfile: string) {
  const auth = await allowAction("settings");
  if (!auth.ok) return { error: auth.error };
  if (igtfProfile !== "BANCARIZADO" && igtfProfile !== "FOREX") {
    return { error: "Perfil IGTF inválido." };
  }
  await prisma.paymentMethod.update({ where: { id }, data: { igtfProfile } });
  revalidatePos();
  return { ok: true };
}
