"use client";

import Link from "next/link";
import { DualMoney } from "@/components/pos/money-label";
import { Badge } from "@/components/ui/badge";
import { checkTotals } from "@/lib/money";
import { checkPlaceLabel } from "@/lib/open-checks";
import { confirmedPaymentUsd } from "@/lib/payment-status";

type Row = {
  id: string;
  folio: string;
  status: string;
  tipUsd: number;
  createdAt: string;
  channel?: string;
  table: { number: string } | null;
  lines: { qty: number; priceUsd: number; modifiers: string; status: string; ivaRate?: number; discountUsd?: number; courtesy?: boolean }[];
  payments: { amountUsd: number; confirmed: boolean }[];
};

export function CashList({
  checks,
  ivaRate,
  rate,
}: {
  checks: Row[];
  ivaRate: number;
  rate: number;
}) {
  if (!checks.length) {
    return (
      <div className="m-6 flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-border py-20 text-center">
        <p className="text-lg font-medium">No hay cuentas abiertas</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Abre una mesa en el salón o espera a que un mesero envíe a caja.
        </p>
        <Link href="/floor" className="mt-4 text-sm font-medium text-primary underline">
          Ir al salón
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
      {checks.map((c) => {
        const t = checkTotals(c.lines, c.tipUsd, ivaRate);
        const paid = confirmedPaymentUsd(c.payments);
        return (
          <Link
            key={c.id}
            href={`/pay/${c.id}`}
            className="rounded-2xl border border-border bg-card p-4 transition hover:border-primary/50"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-2xl font-semibold">
                  {checkPlaceLabel({ channel: c.channel ?? "LOCAL", table: c.table })}
                </div>
                <div className="text-xs text-muted-foreground">{c.folio}</div>
              </div>
              <Badge variant="secondary">
                {c.status === "PARTIAL" ? "Pago parcial" : "Por cobrar"}
              </Badge>
            </div>
            <div className="mt-4 flex items-end justify-between">
              <div className="text-xs text-muted-foreground">
                Pagado {((paid / 100) || 0).toFixed(2)} USD
              </div>
              <DualMoney usdCents={Math.max(0, t.totalUsd - paid)} rate={rate} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
