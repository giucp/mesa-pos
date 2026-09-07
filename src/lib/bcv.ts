import "server-only";
import { prisma } from "@/lib/db";
import { inferFeedSource, sourceLabel } from "@/lib/bcv-label";

export { sourceLabel };

export type RateQuote = {
  usdToVes: number;
  source: string;
  fetchedAt: Date;
};

function pickRate(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const rec = data as Record<string, unknown>;
  const candidates = [rec.rate, rec.promedio, rec.oficial, rec.usdToVes];
  for (const c of candidates) {
    if (typeof c === "number" && c > 0) return c;
    if (typeof c === "string" && Number.parseFloat(c) > 0) return Number.parseFloat(c);
  }
  const usd = rec.usd;
  if (usd && typeof usd === "object") {
    const nested = usd as Record<string, unknown>;
    const n = nested.oficial ?? nested.rate ?? nested.promedio;
    if (typeof n === "number" && n > 0) return n;
    if (typeof n === "string" && Number.parseFloat(n) > 0) return Number.parseFloat(n);
  }
  return null;
}

export async function fetchRemoteRate(): Promise<RateQuote | null> {
  const url = process.env.BCV_RATE_URL;
  if (!url) return null;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`El proveedor de tasa respondió ${res.status}.`);
  const data = await res.json();
  const rate = pickRate(data);
  if (!rate) throw new Error("No se pudo leer la tasa del JSON remoto");
  const ts =
    typeof (data as { timestamp?: string }).timestamp === "string"
      ? new Date((data as { timestamp: string }).timestamp)
      : new Date();
  return { usdToVes: rate, source: inferFeedSource(url, data), fetchedAt: ts };
}

export async function getBcvRate(): Promise<RateQuote> {
  const restaurant = await prisma.restaurant.findFirst();
  try {
    const remote = await fetchRemoteRate();
    if (remote && restaurant) {
      const drifted = Math.abs(remote.usdToVes - restaurant.bcvRate) > 0.0001;
      if (drifted || restaurant.bcvSource !== "bcv_url") {
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
      }
      return remote;
    }
  } catch {
    // silent fallback — UI shows last stored rate
  }

  if (!restaurant) {
    return { usdToVes: 148.52, source: "seed", fetchedAt: new Date("2026-09-06T08:00:00-04:00") };
  }

  return {
    usdToVes: restaurant.bcvRate,
    source: restaurant.bcvSource,
    fetchedAt: restaurant.bcvUpdatedAt,
  };
}
