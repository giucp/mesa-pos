"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { splitItemsAction } from "@/actions/tables";
import { DualMoney } from "@/components/pos/money-label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { lineNetUsd } from "@/lib/money";
import { paths } from "@/lib/paths";

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

export function SplitDesk({
  check,
  rate,
}: {
  check: {
    id: string;
    folio: string;
    status: string;
    table: { id: string; number: string } | null;
    lines: Line[];
  };
  rate: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [splitIds, setSplitIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const closed = ["PAID", "CLOSED", "VOID"].includes(check.status);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col p-4">
      <h1 className="text-lg font-semibold">Separar · {check.folio}</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Marca ítems para otra cuenta. El resto se queda aquí. Pago parcial = otro método en Cobrar.
      </p>
      <div className="space-y-2 overflow-auto">
        {check.lines
          .filter((l) => l.status !== "VOID")
          .map((line) => (
            <label key={line.id} className="flex min-h-14 items-center gap-3 rounded-xl border border-border p-3">
              <Checkbox
                checked={splitIds.includes(line.id)}
                onCheckedChange={(v) =>
                  setSplitIds((prev) => (v ? [...prev, line.id] : prev.filter((x) => x !== line.id)))
                }
              />
              <span className="flex-1 text-sm">
                {line.qty}× {line.name}
              </span>
              <DualMoney usdCents={lineNetUsd(line)} rate={rate} size="sm" />
            </label>
          ))}
      </div>
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
        <Button variant="secondary" className="min-h-12" onClick={() => router.push(paths.pay(check.id))}>
          Volver a cobrar
        </Button>
        <Button
          className="min-h-12"
          disabled={!splitIds.length || pending || closed}
          onClick={() =>
            start(async () => {
              const res = await splitItemsAction(check.id, splitIds);
              if (res.error) setError(res.error);
              else if (res.checkId) router.push(paths.pay(res.checkId));
            })
          }
        >
          Separar y cobrar
        </Button>
      </div>
    </div>
  );
}
