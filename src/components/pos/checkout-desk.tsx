"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addPaymentAction,
  confirmPaymentAction,
  overrideTicketRateAction,
  reopenCheckAction,
  setPayerProfileAction,
  setTipAction,
  verifyPaymentStatusAction,
} from "@/actions/payments";
import { runOrQueue } from "@/lib/offline-queue";
import { offlineBlockMessage, planMutation } from "@/lib/sync-state";
import { ticketFromCheck } from "@/lib/print-tickets";
import { splitItemsAction } from "@/actions/tables";
import { applyCourtesyAction, applyLineDiscountAction } from "@/actions/adjust";
import { DualMoney } from "@/components/pos/money-label";
import { FiscalBanner } from "@/components/pos/fiscal-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  formatUsd,
  formatVes,
  lineNetUsd,
  lineTotalUsd,
  parseAmountToCents,
  usdToVesCents,
} from "@/lib/money";
import {
  CHANNEL_LABEL,
  FISCAL_COPY,
  displayControlNumber,
  documentKindLabel,
  documentStatusLabel,
  isInternalFiscalDoc,
  mediaStatusSummary,
  PAYER_LABEL,
  TAX_CODE_LABEL,
  fiscalTotals,
  igtfOn,
  resolveFiscalDocStatus,
  resolveIgtfRate,
  type Channel,
  type PayerProfile,
} from "@/lib/fiscal";
import { cn } from "@/lib/utils";
import { paths } from "@/lib/paths";
import { sourceLabel } from "@/lib/bcv-label";
import { PrintStub } from "@/components/pos/print-stub";
import { DIGITAL_TENDERS, PENDING_PAY_INTEGRATIONS } from "@/lib/pagos";
import { describePaymentSettle, parseSettleNote } from "@/lib/caja";
import { confirmedPaymentUsd } from "@/lib/payment-status";
import { ISOLATED_DEMO } from "@/lib/isolated-demo";

type Method = {
  key: string;
  label: string;
  currency: string;
  enabled: boolean;
  hint: string | null;
  igtfProfile: string;
};

function newPaymentOpId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `pay-${Date.now()}`;
}

type Line = {
  id: string;
  name: string;
  qty: number;
  priceUsd: number;
  modifiers: string;
  status: string;
  taxCode: string;
  ivaRate: number;
  discountUsd: number;
  courtesy: boolean;
};

type Pay = {
  id: string;
  methodLabel: string;
  currency: string;
  amountCents: number;
  amountUsd: number;
  amountVes: number;
  igtfUsd: number;
  igtfRate: number;
  bcvRate: number;
  reference: string | null;
  confirmed?: boolean;
  note?: string | null;
};

export function CheckoutDesk({
  check,
  methods,
  restaurant,
  rate,
  rateSource,
  rateAt,
  canAdjust,
}: {
  check: {
    id: string;
    folio: string;
    status: string;
    tipUsd: number;
    channel: string;
    payerProfile: string;
    igtfCustomRate: number;
    bcvRateUsed: number | null;
    bcvSource?: string | null;
    bcvFetchedAt?: string | null;
    buyerName: string | null;
    buyerRif: string | null;
    buyerCi: string | null;
    table: { id?: string; number: string } | null;
    lines: Line[];
    payments: Pay[];
    fiscal: {
      controlNumber: string;
      invoiceNumber: string;
      documentType: string;
      ticketType?: string;
      homologation: string;
      customerName?: string | null;
      customerRif?: string | null;
      customerCi?: string | null;
      ivaBreakdown?: string;
      ivaUsd?: number;
      igtfUsd?: number;
      totalUsd?: number;
      bcvRate?: number;
      bcvSource?: string;
      emitterRif?: string;
    } | null;
  };
  methods: Method[];
  restaurant: {
    name?: string;
    ivaRate: number;
    igtfBancarizadoRate: number;
    igtfForexRate: number;
    tipInTaxableBase: boolean;
    rif: string;
    fiscalAdapterMf?: string;
    fiscalAdapterDigital?: string;
  };
  rate: number;
  rateSource?: string;
  rateAt?: string;
  canAdjust: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [methodKey, setMethodKey] = useState(methods.find((m) => m.enabled)?.key ?? "");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [rif, setRif] = useState(check.buyerRif ?? "");
  const [ci, setCi] = useState(check.buyerCi ?? "");
  const [customer, setCustomer] = useState(check.buyerName ?? "");
  const [profile, setProfile] = useState(check.payerProfile);
  const [customIgtf, setCustomIgtf] = useState(String(check.igtfCustomRate));
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [splitIds, setSplitIds] = useState<string[]>([]);
  const [adjLine, setAdjLine] = useState<Line | null>(null);
  const [adjReason, setAdjReason] = useState("");
  const [adjAmt, setAdjAmt] = useState("");
  const [verified, setVerified] = useState(false);
  const [rateEdit, setRateEdit] = useState("");
  const [rateReason, setRateReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const paying = useRef(false);
  const payKey = useRef<string | null>(null);

  const frozen = check.bcvRateUsed || rate;
  const totals = fiscalTotals(
    check.lines,
    check.tipUsd,
    restaurant.ivaRate,
    frozen,
    restaurant.tipInTaxableBase,
  );
  const paidUsd = confirmedPaymentUsd(check.payments);
  const receivedUsd = paidUsd;
  const igtfPaid = check.payments.reduce((s, p) => s + (p.confirmed ? p.igtfUsd : 0), 0);
  const remainingUsd = Math.max(0, totals.totalUsd - paidUsd);
  const method = methods.find((m) => m.key === methodKey);
  const currency = method?.currency ?? "USD";
  const closed = ["PAID", "CLOSED"].includes(check.status);
  const needsRef = (DIGITAL_TENDERS as readonly string[]).includes(methodKey);
  const docStatus = resolveFiscalDocStatus({
    adapterMf: restaurant.fiscalAdapterMf,
    adapterDigital: restaurant.fiscalAdapterDigital,
    stored: check.fiscal?.homologation,
  });
  const internalDoc = isInternalFiscalDoc(docStatus);
  const controlShown = displayControlNumber(docStatus, check.fiscal?.controlNumber);

  const nextIgtf = resolveIgtfRate({
    methodProfile: method?.igtfProfile ?? "BANCARIZADO",
    checkProfile: profile,
    customRate: Number.parseFloat(customIgtf) || 0,
    bancarizadoRate: restaurant.igtfBancarizadoRate,
    forexRate: restaurant.igtfForexRate,
  });
  const nextIgtfUsd = igtfOn(remainingUsd, nextIgtf);
  const collectUsd = remainingUsd + nextIgtfUsd;
  const ivaLines = (() => {
    if (!check.fiscal?.ivaBreakdown) return totals.breakdown;
    try {
      const parsed = JSON.parse(check.fiscal.ivaBreakdown) as {
        taxCode: string;
        rate: number;
        baseUsd: number;
        ivaUsd: number;
      }[];
      return Array.isArray(parsed) ? parsed : totals.breakdown;
    } catch {
      return totals.breakdown;
    }
  })();

  const vuelto = (() => {
    const cents = parseAmountToCents(amount);
    if (!cents || !method) return null;
    const asUsd = currency === "VES" ? Math.round((cents / 100 / frozen) * 100) : cents;
    const extra = asUsd - remainingUsd;
    if (extra <= 0) return null;
    return { usd: extra, ves: usdToVesCents(extra, frozen) };
  })();

  function fillRemaining() {
    if (currency === "VES") setAmount((usdToVesCents(remainingUsd, frozen) / 100).toFixed(2));
    else setAmount((remainingUsd / 100).toFixed(2));
  }

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[1fr_420px]">
      <div className="min-h-0 overflow-auto border-b border-border p-4 lg:border-b-0 lg:border-r">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">
              Cobro · {check.table ? `Mesa ${check.table.number}` : CHANNEL_LABEL[check.channel as Channel] || check.channel}
            </h1>
            <p className="text-sm text-muted-foreground">
              {check.folio} · {CHANNEL_LABEL[check.channel as Channel] ?? check.channel}
            </p>
            <Badge variant={internalDoc ? "secondary" : "outline"} className="mt-2">
              {internalDoc ? FISCAL_COPY.statusInternal : FISCAL_COPY.statusValidated}
            </Badge>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {mediaStatusSummary(restaurant.fiscalAdapterMf, restaurant.fiscalAdapterDigital)}
            </p>
          </div>
          <Badge>{closed ? "Pagada" : remainingUsd ? "Por cobrar" : "Cerrada"}</Badge>
        </div>

        <Tabs defaultValue="cuenta">
          <TabsList>
            <TabsTrigger value="cuenta">Cuenta</TabsTrigger>
            <TabsTrigger value="split">Separar ítems</TabsTrigger>
            <TabsTrigger value="fiscal">Comprobante</TabsTrigger>
          </TabsList>
          <TabsContent value="cuenta" className="space-y-3 pt-3">
            {check.lines
              .filter((l) => l.status !== "VOID")
              .map((line) => (
                <div key={line.id} className="rounded-xl bg-card px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm">
                      <span className="mr-2 tabular-nums text-muted-foreground">{line.qty}×</span>
                      {line.name}
                      {line.courtesy ? (
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          Cortesía
                        </Badge>
                      ) : null}
                    </div>
                    <DualMoney usdCents={lineNetUsd(line)} rate={frozen} size="sm" />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {TAX_CODE_LABEL[line.taxCode as keyof typeof TAX_CODE_LABEL] ?? line.taxCode}
                      {line.discountUsd ? ` · dto ${formatUsd(line.discountUsd)}` : ""}
                    </span>
                    {canAdjust && !closed ? (
                      <button type="button" className="text-primary" onClick={() => setAdjLine(line)}>
                        Dto / cortesía
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            <div className="space-y-1 rounded-xl border border-border p-3 text-sm">
              {totals.breakdown.map((b) => (
                <div key={`${b.taxCode}-${b.rate}`} className="flex justify-between">
                  <span className="text-muted-foreground">
                    Base {b.taxCode} ({b.rate}%)
                  </span>
                  <span>
                    {formatUsd(b.baseUsd)} · IVA {formatUsd(b.ivaUsd)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Propina</span>
                <span>{formatUsd(totals.tipUsd)}</span>
              </div>
            </div>
            {check.payments.length ? (
              <div className="space-y-2 pt-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Pagos
                </div>
                {check.payments.map((p) => {
                  const settle = parseSettleNote(p.note);
                  const br = describePaymentSettle(p);
                  return (
                  <div key={p.id} className="flex items-start justify-between gap-2 text-sm">
                    <span>
                      {p.methodLabel}
                      {p.reference ? ` · ${p.reference}` : ""}
                      {p.igtfUsd ? ` · IGTF ${p.igtfRate}%` : ""}
                      {settle.changeCents ? ` · vuelto ${br.changeLabel}` : ""}
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        {p.confirmed ? "Verificado" : "Sin verificar — no entra a caja"}
                      </span>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {p.confirmed
                          ? `Entregó ${br.handedLabel} · aplicado al saldo ${br.appliedToBalanceLabel} · vuelto ${br.changeLabel} · caja ${br.cajaNetLabel}`
                          : `Registrado pendiente ${br.registeredLabel} · ${br.appliedToBalanceLabel} · caja ${br.cajaNetLabel}`}
                      </div>
                      {!p.confirmed ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="ml-2 mt-1 h-8"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              const gate = planMutation({
                                online: typeof navigator === "undefined" ? true : navigator.onLine,
                                action: "confirmPayment",
                              });
                              if (gate.kind === "block") {
                                setError(gate.error);
                                return;
                              }
                              const res = await confirmPaymentAction(p.id);
                              if (res.error) setError(res.error);
                              else router.refresh();
                            })
                          }
                        >
                          Confirmar
                        </Button>
                      ) : null}
                    </span>
                    <DualMoney usdCents={p.amountUsd} rate={p.bcvRate || frozen} size="sm" />
                  </div>
                  );
                })}
              </div>
            ) : null}
          </TabsContent>
          <TabsContent value="split" className="space-y-3 pt-3">
            <p className="text-sm text-muted-foreground">
              Marca ítems para crear otra cuenta (mismo canal).
            </p>
            {check.lines
              .filter((l) => l.status !== "VOID")
              .map((line) => (
                <label key={line.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                  <Checkbox
                    checked={splitIds.includes(line.id)}
                    onCheckedChange={(v) =>
                      setSplitIds((prev) => (v ? [...prev, line.id] : prev.filter((x) => x !== line.id)))
                    }
                  />
                  <span className="flex-1 text-sm">
                    {line.qty}× {line.name}
                  </span>
                </label>
              ))}
            <Button
              className="h-12 w-full"
              disabled={!splitIds.length || pending || closed}
              onClick={() =>
                start(async () => {
                  const res = await splitItemsAction(check.id, splitIds);
                  if (res.error) setError(res.error);
                  else if (res.checkId) router.push(paths.pay(res.checkId));
                })
              }
            >
              Separar y cobrar esa cuenta
            </Button>
          </TabsContent>
          <TabsContent value="fiscal" className="space-y-3 pt-3">
            <FiscalBanner />
            <div className="space-y-1 rounded-xl border border-border p-3 text-sm">
              <p className="font-medium">
                {check.fiscal
                  ? `${documentKindLabel(check.fiscal.documentType, check.fiscal.ticketType, check.fiscal.homologation)} · ${
                      check.fiscal.ticketType === "CONTRIBUYENTE" ? "contribuyente" : "consumidor final"
                    }`
                  : FISCAL_COPY.headerInternal}
              </p>
              <div>
                Emisor: <strong>{restaurant.name ?? "Café Ávila"}</strong> · RIF {restaurant.rif}
              </div>
              <div>Folio de caja: {check.folio}</div>
              {check.fiscal ? (
                <>
                  <div>
                    Documento: <strong>{check.fiscal.invoiceNumber}</strong>
                  </div>
                  {controlShown ? (
                    <div>
                      N° control: <strong>{controlShown}</strong>
                    </div>
                  ) : null}
                  <div>
                    Estado: <strong>{documentStatusLabel(check.fiscal.homologation)}</strong>
                  </div>
                  <div>
                    Comprador: {check.fiscal.customerName ?? check.buyerName ?? "Consumidor final"} ·{" "}
                    {check.fiscal.customerRif ?? check.buyerRif ?? "V-00000000-0"}
                    {check.fiscal.customerCi || check.buyerCi
                      ? ` · CI ${check.fiscal.customerCi ?? check.buyerCi}`
                      : ""}
                  </div>
                  <div>
                    IVA: {formatUsd(check.fiscal.ivaUsd ?? totals.ivaUsd)} · IGTF:{" "}
                    {formatUsd(check.fiscal.igtfUsd ?? igtfPaid)}
                  </div>
                  {ivaLines.length ? (
                    <ul className="mt-1 text-xs text-muted-foreground">
                      {ivaLines.map((b) => (
                        <li key={`${b.taxCode}-${b.rate}`}>
                          {b.taxCode} {b.rate}% · base {formatUsd(b.baseUsd)} · IVA {formatUsd(b.ivaUsd)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div>
                    Tasa BCV: {check.fiscal.bcvRate?.toFixed(4) ?? frozen.toFixed(4)}
                    {check.fiscal.bcvSource ? ` · ${check.fiscal.bcvSource}` : ""}
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">
                  Al cerrar se registra {FISCAL_COPY.headerInternal.toLowerCase()} con RIF, desglose de
                  IVA e IGTF y tasa BCV. {FISCAL_COPY.footerInternal}
                </div>
              )}
              <div className="mt-2 text-xs text-muted-foreground">{FISCAL_COPY.mediaHelp}</div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <div className="min-h-0 overflow-auto p-4">
        <div className="rounded-2xl border border-primary/30 bg-card p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Tasa BCV {check.bcvRateUsed ? "congelada en el ticket" : "del día"} · {frozen.toFixed(2)}{" "}
            Bs/USD · {sourceLabel(check.bcvSource || rateSource || "other")}
            {(check.bcvFetchedAt || rateAt)
              ? ` · ${new Date(check.bcvFetchedAt || rateAt || "").toLocaleString("es-VE", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
          </div>
          <div className="mt-2 flex justify-between text-sm">
            <span className="text-muted-foreground">Total (base+IVA+propina)</span>
            <DualMoney usdCents={totals.totalUsd} rate={frozen} />
          </div>
          <div className="mt-1 flex justify-between text-sm">
            <span className="text-muted-foreground">Recibido</span>
            <DualMoney usdCents={receivedUsd} rate={frozen} />
          </div>
          <div className="mt-1 flex justify-between text-sm">
            <span className="text-muted-foreground">Pendiente</span>
            <DualMoney usdCents={remainingUsd} rate={frozen} />
          </div>
          <div className="mt-1 flex justify-between text-sm">
            <span className="text-muted-foreground">IGTF cobrado</span>
            <span>{formatUsd(igtfPaid)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="font-semibold">Saldo del comprobante</span>
            <DualMoney usdCents={remainingUsd} rate={frozen} size="lg" />
          </div>
          {!closed ? (
            <p className="mt-2 text-xs text-muted-foreground">
              IGTF estimado este método ({nextIgtf}%): {formatUsd(nextIgtfUsd)}. A cobrar ahora{" "}
              {formatUsd(collectUsd)} / {formatVes(usdToVesCents(collectUsd, frozen))}.
            </p>
          ) : null}
        </div>

        {closed ? (
          <div className="mt-4 space-y-3">
            <Alert>
              <AlertTitle>
                {check.fiscal
                  ? `${documentKindLabel(check.fiscal.documentType, check.fiscal.ticketType, check.fiscal.homologation)} generado`
                  : "Cuenta cobrada"}
              </AlertTitle>
              <AlertDescription>
                {check.fiscal
                  ? `${check.fiscal.invoiceNumber}${controlShown ? ` · N° control ${controlShown}` : ""}. ${documentStatusLabel(check.fiscal.homologation)}`
                  : FISCAL_COPY.statusInternal}{" "}
                Esta cuenta ya está cubierta. Un segundo cobro no registra otro pago.
              </AlertDescription>
            </Alert>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {canAdjust ? (
              <div className="space-y-2">
                <Label>Reabrir cuenta (solo Administración)</Label>
                <Input
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  placeholder="Motivo obligatorio"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full"
                  disabled={pending || reopenReason.trim().length < 3}
                  onClick={() =>
                    start(async () => {
                      setError(null);
                      const res = await reopenCheckAction(check.id, reopenReason);
                      if (res.error) setError(res.error);
                      else router.refresh();
                    })
                  }
                >
                  Reabrir cuenta cobrada
                </Button>
              </div>
            ) : null}
            {ISOLATED_DEMO ? (
              <Button
                variant="outline"
                className="h-12 w-full"
                disabled={pending}
                onClick={() => {
                  start(async () => {
                    setError(null);
                    const res = await addPaymentAction({
                      checkId: check.id,
                      methodKey: "CASH_USD",
                      amountCents: 100,
                      currency: "USD",
                      verified: true,
                      idempotencyKey: `retry-${Date.now()}`,
                    });
                    setError(res.error ?? "El cobro no debió aceptarse.");
                  });
                }}
              >
                Probar segundo cobro (no debe duplicar)
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <Label>Perfil IGTF del pagador</Label>
              <select
                className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-2 text-sm"
                value={profile}
                onChange={(e) => {
                  setProfile(e.target.value);
                  start(async () => {
                    await setPayerProfileAction(check.id, e.target.value, Number.parseFloat(customIgtf) || 0);
                  });
                }}
              >
                {(Object.keys(PAYER_LABEL) as PayerProfile[]).map((p) => (
                  <option key={p} value={p}>
                    {PAYER_LABEL[p]}
                  </option>
                ))}
              </select>
              {profile === "CUSTOM" ? (
                <Input
                  className="mt-2"
                  value={customIgtf}
                  onChange={(e) => setCustomIgtf(e.target.value)}
                  placeholder="% IGTF"
                />
              ) : null}
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Método
              </div>
              <div className="grid grid-cols-2 gap-2">
                {methods
                  .filter((m) => m.enabled)
                  .map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => {
                        setMethodKey(m.key);
                        setAmount("");
                        setVerified(!(DIGITAL_TENDERS as readonly string[]).includes(m.key));
                      }}
                      className={cn(
                        "min-h-14 rounded-xl border px-3 py-3 text-left text-sm font-medium",
                        methodKey === m.key
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-secondary/50",
                      )}
                    >
                      {m.label}
                      <div
                        className={cn(
                          "text-[10px] font-normal",
                          methodKey === m.key ? "text-primary-foreground/80" : "text-muted-foreground",
                        )}
                      >
                        {m.currency} · IGTF {m.igtfProfile === "FOREX" ? "forex" : "bancarizado"}
                      </div>
                    </button>
                  ))}
              </div>
            </div>

            <div>
              <Label>Propina</Label>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {[0, 5, 10, 15].map((pct) => (
                  <Button
                    key={pct}
                    type="button"
                    variant={check.tipUsd === Math.round((totals.subtotalUsd * pct) / 100) ? "default" : "secondary"}
                    className="min-h-11"
                    onClick={() =>
                      start(() =>
                        setTipAction(check.id, Math.round((totals.subtotalUsd * pct) / 100)).then(() =>
                          router.refresh(),
                        ),
                      )
                    }
                  >
                    {pct}%
                  </Button>
                ))}
              </div>
              <Input
                className="mt-2 min-h-11"
                defaultValue={(check.tipUsd / 100).toFixed(2)}
                onBlur={(e) => {
                  const cents = parseAmountToCents(e.target.value) ?? 0;
                  start(() => setTipAction(check.id, cents).then(() => router.refresh()));
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" className="min-h-11" onClick={fillRemaining}>
                Completar saldo
              </Button>
              <Button variant="secondary" className="min-h-11" onClick={() => router.push(paths.split(check.id))}>
                Separar / parcial
              </Button>
            </div>

            <div className="space-y-1">
              <Label>Monto documento en {currency === "VES" ? "bolívares" : "dólares"}</Label>
              <Input
                className="h-14 text-xl tabular-nums"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            {needsRef ? (
              <div className="space-y-1">
                <Label>Referencia / confirmación manual</Label>
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Nro. referencia o «OK caja»"
                />
                <p className="text-[11px] text-muted-foreground">
                  La referencia no confirma el cobro. Marca «verificado» solo cuando caja vea el
                  crédito.
                  {methodKey === "PAGO_MOVIL"
                    ? " El cobro automático C2P no está disponible en esta fase."
                    : ""}
                </p>
              </div>
            ) : null}

            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3">
              <Checkbox checked={verified} onCheckedChange={(v) => setVerified(Boolean(v))} />
              <span className="text-sm">Referencia / efectivo verificado</span>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>RIF comprador</Label>
                <Input value={rif} onChange={(e) => setRif(e.target.value)} placeholder="J-00000000-0" />
              </div>
              <div className="space-y-1">
                <Label>CI comprador</Label>
                <Input value={ci} onChange={(e) => setCi(e.target.value)} placeholder="V-12345678" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Razón social</Label>
                <Input
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  placeholder="Consumidor final"
                />
              </div>
            </div>

            {vuelto ? (
              <Alert>
                <AlertTitle>Vuelto</AlertTitle>
                <AlertDescription>
                  Se entrega {formatUsd(vuelto.usd)} · {formatVes(vuelto.ves)} y se descuenta del
                  efectivo de esta moneda. Tasa {frozen.toFixed(2)} Bs/USD.
                </AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {result ? (
              <Alert>
                <AlertDescription>{result}</AlertDescription>
              </Alert>
            ) : null}

            <Button
              className="h-14 w-full text-base font-semibold"
              disabled={pending}
              onClick={() => {
                if (paying.current || pending) return;
                if (!method) {
                  setError("Elige un método.");
                  return;
                }
                let raw = amount;
                if (!raw) {
                  raw =
                    currency === "VES"
                      ? (usdToVesCents(remainingUsd, frozen) / 100).toFixed(2)
                      : (remainingUsd / 100).toFixed(2);
                  setAmount(raw);
                }
                const cents = parseAmountToCents(raw);
                if (!cents) {
                  setError("Monto inválido.");
                  return;
                }
                paying.current = true;
                start(async () => {
                  setError(null);
                  const operationId = payKey.current ?? newPaymentOpId();
                  payKey.current = operationId;
                  const payload = {
                    checkId: check.id,
                    methodKey: method.key,
                    amountCents: cents,
                    currency: method.currency,
                    reference,
                    customerName: customer,
                    customerRif: rif,
                    customerCi: ci,
                    payerProfile: profile,
                    igtfCustomRate: Number.parseFloat(customIgtf) || 0,
                    verified,
                    idempotencyKey: operationId,
                  };
                  const res = await runOrQueue(
                    { id: operationId, kind: "cobro", action: "addPayment", payload },
                    () => addPaymentAction(payload),
                  );
                  paying.current = false;
                  if (res.unknown) {
                    const verify = await verifyPaymentStatusAction(check.id, operationId);
                    if (verify.status === "unknown") {
                      setResult(
                        "Por verificar — no está cobrado ni fallido. Se consulta el servidor antes de reenviar el mismo identificador.",
                      );
                      return;
                    }
                    if (verify.status === "pending" || verify.status === "paid") {
                      setResult(
                        verify.status === "paid"
                          ? "El servidor ya tenía este cobro. No se duplicó."
                          : "El servidor ya tenía este cobro pendiente. No se duplicó.",
                      );
                      router.refresh();
                      return;
                    }
                  }
                  if (res.queued) {
                    setAmount("");
                    setReference("");
                    setResult(
                      "Cobro en cola. No está cobrado hasta que el servidor lo confirme. Tener internet no basta.",
                    );
                    return;
                  }
                  if (res.blocked) {
                    setError(res.error ?? offlineBlockMessage("addPayment"));
                    return;
                  }
                  if (res.error) setError(res.error);
                  else {
                    payKey.current = null;
                    setAmount("");
                    setReference("");
                    const change =
                      res.changeUsd && res.changeUsd > 0
                        ? ` Vuelto ${formatUsd(res.changeUsd)} · ${formatVes(res.changeVes ?? 0)}.`
                        : "";
                    setResult(
                      res.closed
                        ? `Cuenta cerrada. ${FISCAL_COPY.statusInternal}.${change}`
                        : `Pago mixto. Saldo ${formatUsd(res.remainingUsd ?? 0)}. IGTF ${formatUsd(res.igtfUsd ?? 0)}.${change}`,
                    );
                    router.refresh();
                  }
                });
              }}
            >
              {FISCAL_COPY.checkoutCta}
            </Button>
          </div>
        )}

        {closed ? (
          <div className="mt-4">
            <PrintStub
              label="Imprimir comprobante"
              ticket={ticketFromCheck("recibo", check, {
                totalLabel: `Total ${formatUsd(check.fiscal?.totalUsd ?? totals.totalUsd)} · Recibido ${formatUsd(paidUsd)} · Tasa ${frozen.toFixed(2)} Bs/USD`,
              })}
            />
          </div>
        ) : null}

        {canAdjust && !check.payments.length && !closed ? (
          <div className="mt-4 space-y-2 rounded-xl border border-border p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Corregir tasa del ticket (admin)
            </div>
            <Input
              className="min-h-11"
              placeholder="Nueva tasa BCV"
              value={rateEdit}
              onChange={(e) => setRateEdit(e.target.value)}
            />
            <Input
              className="min-h-11"
              placeholder="Motivo (bitácora)"
              value={rateReason}
              onChange={(e) => setRateReason(e.target.value)}
            />
            <Button
              variant="secondary"
              className="min-h-11 w-full"
              disabled={pending || !rateEdit || !rateReason.trim()}
              onClick={() =>
                start(async () => {
                  const res = await overrideTicketRateAction(check.id, Number.parseFloat(rateEdit), rateReason);
                  if (res.error) setError(res.error);
                  else {
                    setRateEdit("");
                    setRateReason("");
                    router.refresh();
                  }
                })
              }
            >
              Congelar tasa manual
            </Button>
          </div>
        ) : null}

        <div className="mt-4 space-y-1 rounded-xl border border-dashed border-border p-3 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">No disponibles en esta fase</p>
          {PENDING_PAY_INTEGRATIONS.map((s) => (
            <div key={s.key} className="opacity-70">
              {s.label}: {s.note}
            </div>
          ))}
        </div>

        <Button variant="ghost" className="mt-4 w-full" onClick={() => router.push(paths.floor)}>
          Volver al salón
        </Button>
      </div>

      {adjLine ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 md:items-center">
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-card p-4">
            <h2 className="font-semibold">Ajuste · {adjLine.name}</h2>
            <p className="text-xs text-muted-foreground">
              Requiere Administración y motivo. Queda en bitácora inmutable.
            </p>
            <Input
              placeholder="Motivo obligatorio"
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
            />
            <Input
              placeholder="Descuento USD"
              value={adjAmt}
              onChange={(e) => setAdjAmt(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button
                disabled={!adjReason.trim() || pending}
                onClick={() =>
                  start(async () => {
                    const cents = parseAmountToCents(adjAmt) ?? 0;
                    const res = await applyLineDiscountAction({
                      lineId: adjLine.id,
                      discountUsd: cents,
                      reason: adjReason,
                    });
                    if (res.error) setError(res.error);
                    else {
                      setAdjLine(null);
                      router.refresh();
                    }
                  })
                }
              >
                Aplicar dto
              </Button>
              <Button
                variant="secondary"
                disabled={!adjReason.trim() || pending}
                onClick={() =>
                  start(async () => {
                    const res = await applyCourtesyAction({ lineId: adjLine.id, reason: adjReason });
                    if (res.error) setError(res.error);
                    else {
                      setAdjLine(null);
                      router.refresh();
                    }
                  })
                }
              >
                Cortesía
              </Button>
            </div>
            <Button variant="ghost" className="w-full" onClick={() => setAdjLine(null)}>
              Cancelar
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Precio línea {formatUsd(lineTotalUsd(adjLine.qty, adjLine.priceUsd, adjLine.modifiers))}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
