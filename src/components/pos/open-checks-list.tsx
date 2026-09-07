"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DualMoney } from "@/components/pos/money-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  CHANNEL_GROUP_LABEL,
  CHANNEL_GROUPS,
  CHECK_STATUS_LABEL,
  groupOpenChecks,
  type OpenCheck,
} from "@/lib/open-checks";
import { paths } from "@/lib/paths";
import { voidCheckAction } from "@/actions/orders";
import { reassignCheckAction } from "@/actions/tables";
import { cn } from "@/lib/utils";

export type OpenCheckRow = OpenCheck;

export function OpenChecksList({
  checks,
  rate,
  grouped = false,
  manager = false,
  canVoid = false,
  staff = [],
}: {
  checks: OpenCheck[];
  rate: number;
  grouped?: boolean;
  manager?: boolean;
  canVoid?: boolean;
  staff?: { id: string; name: string }[];
}) {
  if (checks.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        No hay cuentas abiertas con ítems y saldo. Una mesa ocupada sin platos no entra en Caja.
      </div>
    );
  }

  if (!grouped) {
    return (
      <div className="space-y-2">
        {checks.map((check) => (
          <OpenCheckCard
            key={check.id}
            check={check}
            rate={rate}
            manager={manager}
            canVoid={canVoid}
            staff={staff}
          />
        ))}
      </div>
    );
  }

  const { abandoned, byGroup } = groupOpenChecks(checks);

  return (
    <div className="space-y-5">
      {abandoned.length ? (
        <section className="space-y-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3">
          <div>
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              Abandonadas / por revisar
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Sin ítem, envío o pago parcial por 4 horas, o del día anterior. Cobra, anula con
              motivo o reasigna.
            </p>
          </div>
          {abandoned.map((check) => (
            <OpenCheckCard
              key={check.id}
              check={check}
              rate={rate}
              manager={manager}
              canVoid={canVoid}
              staff={staff}
              amber
            />
          ))}
        </section>
      ) : null}
      {CHANNEL_GROUPS.map((group) => {
        const rows = byGroup[group];
        if (!rows.length) return null;
        return (
          <section key={group} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {CHANNEL_GROUP_LABEL[group]}
            </h3>
            {rows.map((check) => (
              <OpenCheckCard
                key={check.id}
                check={check}
                rate={rate}
                manager={manager}
                canVoid={canVoid}
                staff={staff}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function OpenCheckCard({
  check,
  rate,
  manager,
  canVoid,
  staff,
  amber,
}: {
  check: OpenCheck;
  rate: number;
  manager: boolean;
  canVoid: boolean;
  staff: { id: string; name: string }[];
  amber?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const href = check.channelGroup === "table" && check.tableNumber
    ? paths.check(check.id)
    : paths.cuenta(check.id);

  return (
    <div
      className={cn(
        "rounded-2xl border px-3 py-3",
        amber ? "border-amber-500/30 bg-background/70" : "border-border bg-card",
      )}
    >
      <Link href={href} className="flex min-h-12 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{check.folio}</span>
            <Badge variant={check.abandoned ? "destructive" : "secondary"}>
              {check.inactiveLong
                ? "sin actividad"
                : check.abandoned
                  ? "Por revisar"
                  : CHECK_STATUS_LABEL[check.status] ?? check.status}
            </Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {check.placeLabel}
            {" · "}
            {CHANNEL_GROUP_LABEL[check.channelGroup]}
            {" · "}
            {check.waiterName ?? "Sin responsable"}
          </div>
        </div>
        <DualMoney usdCents={check.remainingUsd} rate={rate} size="sm" />
      </Link>
      {manager ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="min-h-10"
              disabled={pending}
              onClick={() => router.push(paths.pay(check.id))}
            >
              Cobrar
            </Button>
            {canVoid ? (
              <Button
                size="sm"
                variant="secondary"
                className="min-h-10"
                disabled={pending}
                onClick={() => setVoidOpen((v) => !v)}
              >
                Anular
              </Button>
            ) : null}
            {staff.length ? (
              <select
                className="min-h-10 rounded-lg border border-border bg-background px-2 text-sm"
                defaultValue=""
                disabled={pending}
                onChange={(e) => {
                  const waiterId = e.target.value;
                  if (!waiterId) return;
                  start(async () => {
                    setError(null);
                    const res = await reassignCheckAction(check.id, waiterId);
                    if (res.error) setError(res.error);
                    else router.refresh();
                  });
                }}
              >
                <option value="">Reasignar…</option>
                {staff.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {voidOpen ? (
            <div className="space-y-2">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Motivo de anulación (obligatorio)"
              />
              <Button
                variant="destructive"
                className="min-h-10 w-full"
                disabled={pending || !reason.trim()}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const res = await voidCheckAction(check.id, reason);
                    if (res.error) setError(res.error);
                    else router.refresh();
                  })
                }
              >
                Confirmar anulación
              </Button>
            </div>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
