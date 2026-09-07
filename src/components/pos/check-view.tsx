"use client";

import Link from "next/link";
import { DualMoney } from "@/components/pos/money-label";
import { PrintStub } from "@/components/pos/print-stub";
import { ticketFromCheck } from "@/lib/print-tickets";
import { Badge } from "@/components/ui/badge";
import { fiscalTotals, TAX_CODE_LABEL } from "@/lib/fiscal";
import { formatUsd, lineNetUsd } from "@/lib/money";
import { paths } from "@/lib/paths";
import { checkPlaceLabel } from "@/lib/open-checks";
import { confirmedPaymentUsd } from "@/lib/payment-status";

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

export function CheckView({
  check,
  restaurant,
  rate,
  canPay,
}: {
  check: {
    id: string;
    folio: string;
    status: string;
    tipUsd: number;
    channel: string;
    table: { id: string; number: string } | null;
    lines: Line[];
    payments: { id: string; methodLabel: string; amountUsd: number; currency: string; amountCents: number; confirmed: boolean }[];
  };
  restaurant: { ivaRate: number; tipInTaxableBase: boolean };
  rate: number;
  canPay: boolean;
}) {
  const totals = fiscalTotals(check.lines, check.tipUsd, restaurant.ivaRate, rate, restaurant.tipInTaxableBase);
  const paid = confirmedPaymentUsd(check.payments);
  const remaining = Math.max(0, totals.totalUsd - paid);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">
            Cuenta · {checkPlaceLabel({ channel: check.channel, table: check.table })}
          </h1>
          <p className="text-sm text-muted-foreground">{check.folio}</p>
        </div>
        <Badge>{check.status === "PARTIAL" ? "Pago parcial" : "Abierta"}</Badge>
      </div>

      <div className="space-y-2 overflow-auto">
        {check.lines.filter((l) => l.status !== "VOID").length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            Esta cuenta no tiene líneas.
          </div>
        ) : (
          check.lines
            .filter((l) => l.status !== "VOID")
            .map((line) => (
              <div key={line.id} className="rounded-xl border border-border bg-card px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    <span className="mr-2 tabular-nums text-muted-foreground">{line.qty}×</span>
                    {line.name}
                  </div>
                  <DualMoney usdCents={lineNetUsd(line)} rate={rate} size="sm" />
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {TAX_CODE_LABEL[line.taxCode as keyof typeof TAX_CODE_LABEL] ?? line.taxCode}
                  {line.courtesy ? " · cortesía" : ""}
                  {line.discountUsd ? ` · dto ${formatUsd(line.discountUsd)}` : ""}
                </div>
              </div>
            ))
        )}
      </div>

      <div className="mt-auto space-y-3 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold">Total</span>
          <DualMoney usdCents={totals.totalUsd} rate={rate} size="lg" />
        </div>
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Saldo</span>
          <span>{formatUsd(remaining)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {check.table ? (
            <Link href={paths.table(check.table.id)} className="flex min-h-12 items-center justify-center rounded-xl bg-secondary text-sm font-semibold">
              Mesa
            </Link>
          ) : (
            <Link href={paths.floor} className="flex min-h-12 items-center justify-center rounded-xl bg-secondary text-sm font-semibold">
              Salón
            </Link>
          )}
          {canPay ? (
            <Link href={paths.pay(check.id)} className="flex min-h-12 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground">
              Cobrar
            </Link>
          ) : (
            <div className="flex min-h-12 items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">
              Pide caja
            </div>
          )}
        </div>
        {canPay ? (
          <Link href={paths.split(check.id)} className="flex min-h-11 items-center justify-center text-sm font-medium text-primary">
            Separar / parcial
          </Link>
        ) : null}
        <PrintStub
          label="Imprimir precuenta"
          ticket={ticketFromCheck("precuenta", check, {
            totalLabel: `Total ${formatUsd(totals.totalUsd)} · saldo ${formatUsd(remaining)}`,
          })}
        />
      </div>
    </div>
  );
}
