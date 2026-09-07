export function formatUsd(cents: number) {
  const n = cents / 100;
  return `USD ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)}`;
}

export function formatVes(cents: number) {
  const n = cents / 100;
  return `Bs ${new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)}`;
}

/** Half-up to `digits` decimals. Positive VE amounts only. */
export function roundHalfUp(value: number, digits = 2) {
  const f = 10 ** digits;
  return Math.round((value + Number.EPSILON) * f) / f;
}

export function usdToVesCents(usdCents: number, rate: number) {
  return Math.round(roundHalfUp((usdCents / 100) * rate, 2) * 100);
}

export function vesToUsdCents(vesCents: number, rate: number) {
  if (!rate) return 0;
  return Math.round(roundHalfUp(vesCents / 100 / rate, 2) * 100);
}

export function parseAmountToCents(raw: string) {
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function lineTotalUsd(
  qty: number,
  priceUsd: number,
  modifiersJson: string,
) {
  const mods = safeModifiers(modifiersJson);
  const extra = mods.reduce((sum, m) => sum + m.priceUsd, 0);
  return qty * (priceUsd + extra);
}

export function lineNetUsd(line: {
  qty: number;
  priceUsd: number;
  modifiers: string;
  status: string;
  discountUsd?: number | null;
  courtesy?: boolean | null;
}) {
  if (line.status === "VOID") return 0;
  if (line.courtesy) return 0;
  return Math.max(0, lineTotalUsd(line.qty, line.priceUsd, line.modifiers) - (line.discountUsd ?? 0));
}

export type ModifierSnap = { name: string; priceUsd: number };

export function safeModifiers(json: string): ModifierSnap[] {
  try {
    const parsed = JSON.parse(json) as ModifierSnap[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function checkTotals(
  lines: {
    qty: number;
    priceUsd: number;
    modifiers: string;
    status: string;
    ivaRate?: number | null;
    discountUsd?: number | null;
    courtesy?: boolean | null;
  }[],
  tipUsd: number,
  ivaRate: number,
) {
  let subtotalUsd = 0;
  let ivaUsd = 0;
  for (const line of lines) {
    const net = lineNetUsd(line);
    subtotalUsd += net;
    ivaUsd += Math.round(net * ((line.ivaRate ?? ivaRate) / 100));
  }
  return { subtotalUsd, ivaUsd, tipUsd, totalUsd: subtotalUsd + ivaUsd + tipUsd };
}
