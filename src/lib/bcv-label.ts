export type RateSource = "turepo" | "manual" | "other";

export function normalizeRateSource(source: string): RateSource {
  const s = source.trim().toLowerCase();
  if (s === "turepo") return "turepo";
  if (s === "manual") return "manual";
  return "other";
}

export function inferFeedSource(url: string, payload?: unknown): RateSource {
  if (payload && typeof payload === "object") {
    const raw = (payload as { source?: unknown }).source;
    if (typeof raw === "string") return normalizeRateSource(raw);
  }
  if (url.toLowerCase().includes("turepo")) return "turepo";
  return "other";
}

export function sourceLabel(source: string) {
  const n = normalizeRateSource(source);
  if (source === "turepo" || n === "turepo") return "turepo";
  if (source === "manual" || n === "manual") return "manual";
  if (source === "seed") return "Semilla demo";
  if (source === "bcv_url") return "Proveedor BCV (URL)";
  return "other";
}
