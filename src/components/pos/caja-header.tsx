"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { openChannelCheckAction } from "@/actions/tables";
import { Button } from "@/components/ui/button";
import { paths } from "@/lib/paths";

export function CajaHeader() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div>
        <h1 className="text-lg font-semibold">Caja</h1>
        <p className="text-sm text-muted-foreground">Cuentas abiertas · cobro mixto USD / Bs · canales</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          className="pos-touch"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await openChannelCheckAction("TAKEAWAY");
              if (res.checkId) router.push(paths.cuenta(res.checkId));
            })
          }
        >
          Para llevar
        </Button>
        <div>
          <Button variant="secondary" className="pos-touch opacity-60" disabled>
            Delivery
          </Button>
          <p className="text-[11px] text-muted-foreground">Delivery no está disponible en esta fase.</p>
        </div>
      </div>
    </div>
  );
}
