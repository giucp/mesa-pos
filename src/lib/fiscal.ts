import { lineNetUsd, usdToVesCents } from "@/lib/money";

export const TAX_CODES = ["IVA16", "IVA8", "IVA31", "EXENTO"] as const;
export type TaxCode = (typeof TAX_CODES)[number];

export const TAX_CODE_RATE: Record<TaxCode, number> = {
  IVA16: 16,
  IVA8: 8,
  IVA31: 31,
  EXENTO: 0,
};

export const TAX_CODE_LABEL: Record<TaxCode, string> = {
  IVA16: "IVA 16%",
  IVA8: "IVA 8%",
  IVA31: "IVA 31%",
  EXENTO: "Exento",
};

/** Canonical menu/ops channels. ONLINE is a legacy alias of DELIVERY — never an orphan label. */
export const CHANNELS = ["LOCAL", "BARRA", "TAKEAWAY", "DELIVERY"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  LOCAL: "Salón / terraza",
  BARRA: "Barra",
  TAKEAWAY: "Para llevar",
  DELIVERY: "Delivery",
};

export function canonicalizeChannel(value: string): Channel | null {
  const v = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!v) return null;
  if (v === "ONLINE" || v === "EN_LINEA" || v === "EN_LÍNEA") return "DELIVERY";
  if (v === "PARA_LLEVAR" || v === "TAKE_AWAY") return "TAKEAWAY";
  if (v === "BAR") return "BARRA";
  if (v === "SALON" || v === "TERRAZA" || v === "MESA") return "LOCAL";
  return (CHANNELS as readonly string[]).includes(v) ? (v as Channel) : null;
}

export function asChannel(value: string): Channel | null {
  return canonicalizeChannel(value);
}

export function parseChannels(raw: string | null | undefined): Channel[] {
  const seen = new Set<Channel>();
  for (const part of (raw ?? "").split(",")) {
    const channel = canonicalizeChannel(part);
    if (channel) seen.add(channel);
  }
  return seen.size ? CHANNELS.filter((c) => seen.has(c)) : ["LOCAL"];
}

export function serializeChannels(values: string[]): string | null {
  const seen = new Set<Channel>();
  for (const value of values) {
    const channel = canonicalizeChannel(value);
    if (channel) seen.add(channel);
  }
  if (!seen.size) return null;
  return CHANNELS.filter((c) => seen.has(c)).join(",");
}

export function channelLabels(raw: string | null | undefined): string[] {
  return parseChannels(raw).map((c) => CHANNEL_LABEL[c]);
}

export function sameChannelSet(a: string | null | undefined, b: string | null | undefined) {
  return serializeChannels(parseChannels(a)) === serializeChannels(parseChannels(b));
}

export function itemOnChannel(raw: string | null | undefined, channel: Channel) {
  const set = parseChannels(raw);
  const want = canonicalizeChannel(channel) ?? channel;
  if (want === "BARRA") return set.includes("BARRA") || set.includes("LOCAL");
  if (want === "TAKEAWAY") return set.includes("TAKEAWAY") || set.includes("LOCAL");
  if (want === "DELIVERY") return set.includes("DELIVERY") || set.includes("LOCAL");
  return set.includes(want);
}

export const PAYER_PROFILES = ["AUTO", "BANCARIZADO", "FOREX_CONSUMER", "CUSTOM"] as const;
export type PayerProfile = (typeof PAYER_PROFILES)[number];

export const PAYER_LABEL: Record<PayerProfile, string> = {
  AUTO: "Auto (según método)",
  BANCARIZADO: "Bancarizado",
  FOREX_CONSUMER: "Consumidor forex / no bancarizado",
  CUSTOM: "Tasa IGTF manual",
};

export const FISCAL_DOC_STATUSES = ["internal", "fiscal_mf", "fiscal_digital"] as const;
export type FiscalDocStatus = (typeof FISCAL_DOC_STATUSES)[number];

export const FISCAL_COPY = {
  statusInternal: "Comprobante interno — no es documento fiscal SENIAT",
  statusValidated: "Documento fiscal emitido por medio autorizado",
  mediaTitle: "Medios de emisión SENIAT",
  mediaHelp:
    "La validez fiscal depende del supuesto de tu local (máquina fiscal, medio digital con imprenta digital autorizada, u otros previstos por SENIAT). Sin ese medio, Mesa solo genera comprobantes internos.",
  mfLabel: "Máquina fiscal conectada",
  mfHelp: "Obligatoria o aplicable según tu caso (SNAT/2018/0141). No es opcional en abstracto.",
  digitalLabel: "Medio digital / imprenta digital",
  digitalHelp:
    "Para canal web/apps u operaciones por medios digitales (SNAT/2024/000102). El N° de control lo asigna la imprenta digital autorizada.",
  headerInternal: "COMPROBANTE INTERNO",
  footerInternal: "Este documento no constituye factura ni documento fiscal válido ante SENIAT.",
  checkoutCta: "Cobrar y generar comprobante",
  bookTitle: "Export libro de ventas (desde Mesa)",
  bookHelp: "Para tu contador. Revisa el estado de cada operación (interno vs fiscal).",
} as const;

export const FISCAL_BANNER = FISCAL_COPY.statusInternal;

export const FISCAL_SOURCE = FISCAL_COPY.mediaHelp;

export const TIP_POLICY_NOTE =
  "Propinas vs servicio: Regl. LIVA art. 39. Por defecto la propina queda fuera de la base imponible (sin IVA). Si tu local trata un cargo de servicio como gravado, actívalo en Ajustes. Zona gris: configurable, no es un dictamen legal.";

export const IGTF_POLICY_NOTE =
  "IGTF % es un ajuste de caja (Ajustes), no un dictamen legal. Default operativo: 0% bancarizado y 3% forex / no bancarizado. Cámbialo con tu asesor.";

export const BCV_BOOKS_NOTE =
  "Los libros en bolívares usan la tasa BCV del ticket (congelada: fuente + fecha). Sin esa tasa no se liquidan bolívares.";

export const WITHHOLDING_NOTE =
  "Retenciones de IVA: no disponibles en esta fase. No se calculan ni se descuentan en caja.";

export const DOCUMENT_STATUS: FiscalDocStatus = "internal";
/** @deprecated use DOCUMENT_STATUS — kept so old rows still map */
export const ADAPTER_STATUS = DOCUMENT_STATUS;

const DISCONNECTED = new Set(["", "DESCONECTADO", "ADAPTER_DESCONECTADO", "OPCIONAL", "SIN_CONECTAR"]);

const LEGACY_INTERNAL = new Set([
  "internal",
  "PENDIENTE_HOMOLOGACION",
  "ADAPTER_DESCONECTADO",
  "ADAPTER_PENDIENTE",
  "EMITIDO",
]);

export function mediaConnected(code?: string | null) {
  return Boolean(code && !DISCONNECTED.has(code.toUpperCase()));
}

export function resolveFiscalDocStatus(input: {
  adapterMf?: string | null;
  adapterDigital?: string | null;
  stored?: string | null;
}): FiscalDocStatus {
  if (input.stored === "fiscal_mf" || input.stored === "fiscal_digital") return input.stored;
  if (mediaConnected(input.adapterMf)) return "fiscal_mf";
  if (mediaConnected(input.adapterDigital)) return "fiscal_digital";
  return "internal";
}

export function isInternalFiscalDoc(status?: string | null) {
  return !status || LEGACY_INTERNAL.has(status) || status === "internal";
}

export function documentStatusLabel(code: string) {
  if (code === "fiscal_mf" || code === "fiscal_digital") return FISCAL_COPY.statusValidated;
  if (LEGACY_INTERNAL.has(code)) return FISCAL_COPY.statusInternal;
  return FISCAL_COPY.statusInternal;
}

export const homologationLabel = documentStatusLabel;

export function mediaConnectionLabel(code?: string | null) {
  return mediaConnected(code) ? "conectada" : "sin conectar";
}

export function mediaStatusSummary(mf?: string | null, digital?: string | null) {
  return `${FISCAL_COPY.mfLabel}: ${mediaConnectionLabel(mf)} · ${FISCAL_COPY.digitalLabel}: ${mediaConnectionLabel(digital)}`;
}

export function displayControlNumber(status?: string | null, control?: string | null) {
  if (isInternalFiscalDoc(status) || !control?.trim()) return "";
  return control.trim();
}

/** @deprecated use mediaConnectionLabel */
export const optionalHardwareLabel = mediaConnectionLabel;

export function documentKindLabel(
  documentType?: string | null,
  ticketType?: string | null,
  status?: string | null,
) {
  if (!isInternalFiscalDoc(status) && (documentType === "FACTURA" || ticketType === "CONTRIBUYENTE")) {
    return "Factura (medio autorizado)";
  }
  if (!isInternalFiscalDoc(status)) return "Ticket (medio autorizado)";
  return FISCAL_COPY.headerInternal;
}

export function documentKind(buyerRif?: string | null) {
  const rif = buyerRif?.trim() ?? "";
  const finalConsumer =
    !rif ||
    rif.toUpperCase() === "CONSUMIDOR FINAL" ||
    rif === "V-00000000-0" ||
    rif === "V-00.000.000-0";
  return finalConsumer
    ? { documentType: "TICKET", ticketType: "CONSUMIDOR_FINAL" }
    : { documentType: "FACTURA", ticketType: "CONTRIBUYENTE" };
}

export type TaxableLine = {
  qty: number;
  priceUsd: number;
  modifiers: string;
  status: string;
  ivaRate?: number | null;
  taxCode?: string | null;
  discountUsd?: number | null;
  courtesy?: boolean | null;
};

export { lineNetUsd };

export type IvaBucket = {
  taxCode: string;
  rate: number;
  baseUsd: number;
  ivaUsd: number;
  baseVes: number;
  ivaVes: number;
};

export function fiscalTotals(
  lines: TaxableLine[],
  tipUsd: number,
  defaultIvaRate: number,
  bcvRate = 0,
  tipInTaxableBase = false,
) {
  const buckets = new Map<string, { taxCode: string; rate: number; baseUsd: number; ivaUsd: number }>();
  let subtotalUsd = 0;
  for (const line of lines) {
    const net = lineNetUsd(line);
    subtotalUsd += net;
    const rate = line.ivaRate ?? defaultIvaRate;
    const taxCode = line.taxCode ?? guessTaxCode(rate);
    const iva = Math.round(net * (rate / 100));
    const key = `${taxCode}:${rate}`;
    const bucket = buckets.get(key) ?? { taxCode, rate, baseUsd: 0, ivaUsd: 0 };
    bucket.baseUsd += net;
    bucket.ivaUsd += iva;
    buckets.set(key, bucket);
  }
  let ivaUsd = [...buckets.values()].reduce((sum, b) => sum + b.ivaUsd, 0);
  if (tipInTaxableBase && tipUsd > 0) {
    ivaUsd += Math.round(tipUsd * (defaultIvaRate / 100));
  }
  const totalUsd = subtotalUsd + ivaUsd + tipUsd;
  const breakdown: IvaBucket[] = [...buckets.values()].map((b) => ({
    ...b,
    baseVes: usdToVesCents(b.baseUsd, bcvRate),
    ivaVes: usdToVesCents(b.ivaUsd, bcvRate),
  }));
  return {
    subtotalUsd,
    ivaUsd,
    tipUsd,
    totalUsd,
    breakdown,
    subtotalVes: usdToVesCents(subtotalUsd, bcvRate),
    ivaVes: usdToVesCents(ivaUsd, bcvRate),
    tipVes: usdToVesCents(tipUsd, bcvRate),
    totalVes: usdToVesCents(totalUsd, bcvRate),
  };
}

export function guessTaxCode(rate: number): TaxCode {
  if (rate <= 0) return "EXENTO";
  if (rate <= 8) return "IVA8";
  if (rate >= 30) return "IVA31";
  return "IVA16";
}

export function resolveIgtfRate(input: {
  methodProfile: string;
  checkProfile: string;
  customRate?: number;
  bancarizadoRate: number;
  forexRate: number;
}) {
  if (input.checkProfile === "CUSTOM") return Math.max(0, input.customRate ?? 0);
  if (input.checkProfile === "BANCARIZADO") return input.bancarizadoRate;
  if (input.checkProfile === "FOREX_CONSUMER") return input.forexRate;
  return input.methodProfile === "FOREX" ? input.forexRate : input.bancarizadoRate;
}

export function igtfOn(amountUsd: number, ratePct: number) {
  return Math.round(amountUsd * (ratePct / 100));
}

export function asTaxCode(value: string): TaxCode {
  return (TAX_CODES as readonly string[]).includes(value) ? (value as TaxCode) : "IVA16";
}
